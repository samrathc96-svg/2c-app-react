-- =====================================================================
-- Code de retrait : sécurité de la remise de la commande par le fournisseur
-- À exécuter UNE FOIS dans Supabase > SQL Editor (relançable sans danger).
-- Prérequis : box_commande_prete.sql et securite_livraison.sql déjà exécutés.
-- =====================================================================
-- Principe :
--  * dès qu'un livreur prend une course, il reçoit un code à 4 chiffres PAR
--    fournisseur (affiché dans son application, jamais envoyé au fournisseur) ;
--  * à l'enlèvement, le livreur montre son code au fournisseur, qui le saisit
--    dans son espace (« Confirmer la remise ») : 5 essais maximum ;
--  * le fournisseur voit le nom du livreur qui a pris la course (ni téléphone
--    ni email) ;
--  * le livreur ne peut passer la course « En cours » (« Commande récupérée »)
--    qu'une fois la remise confirmée par TOUS les fournisseurs inscrits de la
--    commande. L'admin peut toujours corriger le statut (dépannage) ;
--  * une fois qu'un fournisseur a confirmé la remise, le livreur ne peut plus
--    libérer la course (la marchandise est partie avec lui) ;
--  * si la course change de livreur (libérée puis reprise), les codes non
--    utilisés sont refaits : l'ancien livreur ne peut rien en faire.
-- Retour en arrière : code_retrait_RETOUR.sql.
-- =====================================================================

-- 1) Table des codes (jamais lisible directement depuis le navigateur) ----------
create table if not exists codes_retrait (
  course_id text not null,
  fournisseur text not null,
  code text not null,
  tentatives int not null default 0,
  remis_le timestamptz,
  remis_par uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (course_id, fournisseur)
);

alter table codes_retrait enable row level security;
revoke all on codes_retrait from anon, authenticated;

-- 2) Création des codes quand un livreur prend la course ------------------------
create or replace function gerer_codes_retrait()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_detail jsonb;
  v_admin boolean := false;
begin
  if new.livreur_id is not distinct from old.livreur_id then
    return new;
  end if;

  if auth.uid() is not null then
    v_admin := exists (select 1 from profils where id = auth.uid() and role = 'admin');
  end if;

  -- Un fournisseur a déjà remis la commande : seul l'admin peut changer de livreur
  if not v_admin and auth.uid() is not null and exists (
    select 1 from codes_retrait where course_id = new.id::text and remis_le is not null
  ) then
    raise exception 'Un fournisseur a déjà remis cette commande : contacte 2C Delivery';
  end if;

  if v_admin then
    delete from codes_retrait where course_id = new.id::text;
  else
    delete from codes_retrait where course_id = new.id::text and remis_le is null;
  end if;

  if new.livreur_id is not null then
    select produits_detail into v_detail from commandes where id::text = new.commande_id::text;
    insert into codes_retrait (course_id, fournisseur, code)
    select new.id::text, f, lpad((floor(random() * 10000))::int::text, 4, '0')
    from _fournisseurs_commande(v_detail) as f
    on conflict (course_id, fournisseur) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_gerer_codes_retrait on courses;
create trigger trg_gerer_codes_retrait
before update of livreur_id on courses
for each row execute function gerer_codes_retrait();

-- Courses déjà prises avant cette mise en service : on leur crée leurs codes
insert into codes_retrait (course_id, fournisseur, code)
select c.id::text, f, lpad((floor(random() * 10000))::int::text, 4, '0')
from courses c
join commandes cm on cm.id::text = c.commande_id::text
cross join lateral _fournisseurs_commande(cm.produits_detail) as f
where c.livreur_id is not null and c.statut = 'À livrer'
on conflict (course_id, fournisseur) do nothing;

-- 3) Verrou : pas de « En cours » sans remise confirmée ---------------------------
create or replace function verifier_remise_avant_depart()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_detail jsonb;
  r text;
begin
  if new.statut = 'En cours' and old.statut is distinct from 'En cours' then
    -- Appels serveur (éditeur SQL, fonctions) : pas de blocage
    if auth.uid() is null then
      return new;
    end if;
    -- L'admin peut toujours corriger un statut
    if exists (select 1 from profils where id = auth.uid() and role = 'admin') then
      return new;
    end if;
    select produits_detail into v_detail from commandes where id::text = new.commande_id::text;
    for r in select f from _fournisseurs_commande(v_detail) as f loop
      if not exists (
        select 1 from codes_retrait
        where course_id = new.id::text and fournisseur = r and remis_le is not null
      ) then
        raise exception 'Le fournisseur doit d''abord confirmer la remise avec ton code de retrait (chez %)', r;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_verifier_remise_avant_depart on courses;
create trigger trg_verifier_remise_avant_depart
before update of statut on courses
for each row execute function verifier_remise_avant_depart();

-- 4) Le fournisseur confirme la remise avec le code du livreur ------------------------
create or replace function fournisseur_confirmer_remise(p_commande text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c fournisseur_comptes := _fournisseur_valide();
  v_detail jsonb;
  v_course courses;
  v_code codes_retrait;
  v_prete timestamptz;
begin
  select c.produits_detail into v_detail from commandes c where c.id::text = p_commande;
  if not found
     or jsonb_array_length(_lignes_commande_fournisseur(v_detail, v_c.nom_fournisseur)) = 0 then
    raise exception 'Commande introuvable';
  end if;

  select * into v_course from courses where commande_id::text = p_commande order by id limit 1 for update;
  if not found then
    raise exception 'Commande introuvable';
  end if;
  if v_course.statut in ('Annulée', 'Livrée') then
    return jsonb_build_object('ok', false, 'message', 'Cette commande est annulée ou déjà livrée.');
  end if;
  if v_course.livreur_id is null then
    return jsonb_build_object('ok', false, 'message', 'Aucun livreur n''a encore pris cette commande.');
  end if;

  select prepare_le into v_prete
  from commande_fournisseur_prepa where commande_id = p_commande and fournisseur = v_c.nom_fournisseur;
  if v_prete is null then
    return jsonb_build_object('ok', false, 'message', 'Marquez d''abord la commande « prête ».');
  end if;

  select * into v_code from codes_retrait
   where course_id = v_course.id::text and fournisseur = v_c.nom_fournisseur for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Aucun code pour cette commande : contactez 2C Delivery.');
  end if;

  if v_code.remis_le is not null then
    return jsonb_build_object('ok', true, 'deja', true);
  end if;
  if v_code.tentatives >= 5 then
    return jsonb_build_object('ok', false, 'message', 'Trop de tentatives. Contactez 2C Delivery.');
  end if;

  if trim(coalesce(p_code, '')) <> v_code.code then
    update codes_retrait set tentatives = tentatives + 1
     where course_id = v_course.id::text and fournisseur = v_c.nom_fournisseur;
    return jsonb_build_object(
      'ok', false,
      'message', 'Code incorrect. Il reste ' || greatest(4 - v_code.tentatives, 0) || ' essai(s).'
    );
  end if;

  update codes_retrait
     set remis_le = now(), remis_par = auth.uid()
   where course_id = v_course.id::text and fournisseur = v_c.nom_fournisseur;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function fournisseur_confirmer_remise(text, text) from public, anon;
grant execute on function fournisseur_confirmer_remise(text, text) to authenticated;

-- 5) Colis de chaque course : + code de retrait (livreur de la course) et remise ------
-- { "<id course>": { "colis": [ {fournisseur, prete, box, nb, code, remis_le} ], "pretes": n, "total": n } }
-- Le code n'est renvoyé qu'au livreur qui a la course, et seulement tant que la remise n'est pas faite.
create or replace function courses_colis()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := _role_courant();
begin
  if auth.uid() is null then
    raise exception 'Non connecté';
  end if;
  if v_role is null or v_role not in ('livreur', 'admin') then
    raise exception 'Accès refusé';
  end if;

  return coalesce((
    select jsonb_object_agg(
      c.id::text,
      jsonb_build_object(
        'colis', x.colis,
        'pretes', x.pretes,
        'total', x.total
      )
    )
    from courses c
    join commandes cm on cm.id::text = c.commande_id::text
    cross join lateral (
      select
        coalesce(jsonb_agg(
          jsonb_build_object(
            'fournisseur', f.nom,
            'prete', pr.prepare_le is not null,
            'box', pr.box_code,
            'nb', coalesce(pr.nb_colis, 1),
            'code', case when c.livreur_id = auth.uid() and cr.remis_le is null then cr.code else null end,
            'remis_le', case when v_role = 'admin' or c.livreur_id = auth.uid() then cr.remis_le else null end
          ) order by f.nom
        ), '[]'::jsonb) as colis,
        count(*) filter (where pr.prepare_le is not null)::int as pretes,
        count(*)::int as total
      from _fournisseurs_commande(cm.produits_detail) as f(nom)
      left join commande_fournisseur_prepa pr
        on pr.commande_id = c.commande_id::text and pr.fournisseur = f.nom
      left join codes_retrait cr
        on cr.course_id = c.id::text and cr.fournisseur = f.nom
    ) x
    where c.statut in ('À livrer', 'En cours')
      and (v_role = 'admin' or _livreur_voit_course(c.id, c.livreur_id, c.prete_le))
  ), '{}'::jsonb);
end;
$$;

-- 6) Commandes du fournisseur : + livreur et remise -------------------------------------
create or replace function fournisseur_mes_commandes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c fournisseur_comptes := _fournisseur_valide();
begin
  return coalesce((
    select jsonb_agg(x.ligne order by x.created_at desc)
    from (
      select
        c.created_at,
        jsonb_build_object(
          'id', c.id::text,
          'numero_suivi', c.numero_suivi,
          'created_at', c.created_at,
          'nom_client', c.nom_client,
          'entreprise', ent.nom,
          'chantier', c.chantier,
          'technicien', c.technicien,
          'adresse', c.adresse,
          'livraison_statut', (
            select co.statut from courses co where co.commande_id::text = c.id::text limit 1
          ),
          'course_prise', exists (
            select 1 from courses co where co.commande_id::text = c.id::text and co.livreur_id is not null
          ),
          'livreur_nom', (
            select nullif(trim(coalesce(p.nom, '')), '')
            from courses co
            join profils p on p.id = co.livreur_id
            where co.commande_id::text = c.id::text
            order by co.id limit 1
          ),
          'remis_le', (
            select cr.remis_le
            from courses co
            join codes_retrait cr on cr.course_id = co.id::text and cr.fournisseur = v_c.nom_fournisseur
            where co.commande_id::text = c.id::text
            order by co.id limit 1
          ),
          'prepare_le', pr.prepare_le,
          'box', pr.box_code,
          'nb_colis', coalesce(pr.nb_colis, 1),
          'prete_par_admin', coalesce(pr.par_admin, false),
          'rembourse', coalesce(c.rembourse, false),
          'lignes', l.lignes
        ) as ligne
      from commandes c
      cross join lateral (
        select _lignes_commande_fournisseur(c.produits_detail, v_c.nom_fournisseur) as lignes
      ) l
      left join commande_fournisseur_prepa pr
        on pr.commande_id = c.id::text and pr.fournisseur = v_c.nom_fournisseur
      left join lateral (
        select e.nom
        from entreprise_membres m
        join entreprises e on e.id = m.entreprise_id
        where c.user_id is not null and m.user_id = c.user_id
        limit 1
      ) ent on true
      where jsonb_array_length(l.lignes) > 0
      order by c.created_at desc
      limit 200
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function courses_colis() from public, anon;
revoke all on function fournisseur_mes_commandes() from public, anon;
grant execute on function courses_colis() to authenticated;
grant execute on function fournisseur_mes_commandes() to authenticated;

notify pgrst, 'reload schema';
