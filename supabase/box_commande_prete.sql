-- =====================================================================
-- Box, « Commande prête », libération d'une course, rappels
-- À exécuter UNE FOIS dans Supabase > SQL Editor (relançable sans danger).
-- Prérequis : espace_fournisseur.sql, commandes_fournisseur.sql,
-- securite_commandes_courses.sql et notifications_push.sql déjà exécutés.
-- =====================================================================
-- Principe :
--  * 2C fournit 5 box (XS, S, M, L, XL) : leurs dimensions sont dans la
--    table boxes_livraison (modifiable ici, sans toucher au code) ;
--  * le fournisseur prépare la commande, choisit la box utilisée (et le
--    nombre de colis) et clique « Commande prête » ;
--  * la course n'est visible des livreurs qu'à partir de ce moment (dès que
--    le premier fournisseur d'une commande est prêt) ;
--  * le livreur voit la taille des colis ; s'il constate sur place que ça ne
--    rentre pas, il libère la course : elle repart chez les autres livreurs
--    (et il ne peut pas la reprendre) ;
--  * un fournisseur qui tarde reçoit un rappel toutes les 10 minutes, l'admin
--    est prévenu après 20 minutes ;
--  * l'admin peut marquer une commande « prête » à la place d'un fournisseur
--    (dépannage, après l'avoir appelé).
-- Seuls les fournisseurs avec un compte validé comptent : une commande dont
-- aucun produit ne vient d'un fournisseur inscrit reste visible tout de suite
-- (comme avant).
-- Retour en arrière : box_commande_prete_RETOUR.sql.
-- =====================================================================

-- 1) Les 5 box ------------------------------------------------------------
create table if not exists boxes_livraison (
  code text primary key,
  rang int not null unique,
  longueur_cm numeric not null,
  largeur_cm numeric not null,
  hauteur_cm numeric not null
);

insert into boxes_livraison (code, rang, longueur_cm, largeur_cm, hauteur_cm) values
  ('XS', 1, 12, 9, 7),
  ('S', 2, 17.5, 13.5, 10.5),
  ('M', 3, 23, 18, 14),
  ('L', 4, 31, 24, 18),
  ('XL', 5, 39, 30, 23)
on conflict (code) do nothing;

alter table boxes_livraison enable row level security;
drop policy if exists boxes_livraison_lecture on boxes_livraison;
create policy boxes_livraison_lecture on boxes_livraison for select using (true);
revoke all on boxes_livraison from anon, authenticated;
grant select on boxes_livraison to anon, authenticated;

-- Date de mise en service (les rappels ne concernent que les commandes d'après)
create table if not exists box_config (
  cle text primary key,
  valeur text not null
);
alter table box_config enable row level security;
revoke all on box_config from anon, authenticated;
insert into box_config (cle, valeur) values ('depuis', now()::text) on conflict (cle) do nothing;

-- 2) Colonnes sur les courses ---------------------------------------------
-- prete_le : la course est visible des livreurs. Les courses déjà existantes
-- sont considérées comme prêtes (et déjà annoncées) : rien ne change pour
-- elles. Ce bloc ne refait rien si on relance le script.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'courses' and column_name = 'prete_le'
  ) then
    alter table courses add column prete_le timestamptz;
    alter table courses add column push_prete_le timestamptz;
    update courses set prete_le = coalesce(created_at, now()), push_prete_le = coalesce(created_at, now());
  end if;
end $$;

alter table courses add column if not exists push_prete_le timestamptz;
alter table courses add column if not exists relancee_le timestamptz;
alter table courses add column if not exists nb_liberations int not null default 0;

-- 3) Colonnes sur le suivi de préparation ---------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'commande_fournisseur_prepa' and column_name = 'notifie_le'
  ) then
    alter table commande_fournisseur_prepa add column notifie_le timestamptz;
    -- les commandes déjà préparées avant cette mise en service : déjà annoncées
    update commande_fournisseur_prepa set notifie_le = coalesce(prepare_le, now());
  end if;
end $$;

alter table commande_fournisseur_prepa add column if not exists box_code text;
alter table commande_fournisseur_prepa add column if not exists nb_colis int not null default 1;
alter table commande_fournisseur_prepa add column if not exists par_admin boolean not null default false;

-- 4) Libérations et rappels -------------------------------------------------
create table if not exists course_liberations (
  id bigint generated always as identity primary key,
  course_id bigint not null,
  commande_id text not null,
  livreur_id uuid references auth.users (id) on delete set null,
  motif text not null default 'trop_volumineux',
  cree_le timestamptz not null default now(),
  notifie_le timestamptz
);
create index if not exists course_liberations_course_idx on course_liberations (course_id, livreur_id);
alter table course_liberations enable row level security;
revoke all on course_liberations from anon, authenticated;

create table if not exists commande_fournisseur_rappels (
  commande_id text not null,
  fournisseur text not null,
  dernier_rappel_le timestamptz,
  nb_rappels int not null default 0,
  admin_alerte_le timestamptz,
  primary key (commande_id, fournisseur)
);
alter table commande_fournisseur_rappels enable row level security;
revoke all on commande_fournisseur_rappels from anon, authenticated;

-- 5) Outils internes ------------------------------------------------------------
create or replace function _role_courant()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profils where id = auth.uid()
$$;

-- Fournisseurs (avec compte validé) concernés par une commande
create or replace function _fournisseurs_commande(p_detail jsonb)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct p.fournisseur
  from jsonb_array_elements(
         case when jsonb_typeof(p_detail) = 'array' then p_detail else '[]'::jsonb end
       ) as l(elem)
  join produits p on p.id::text = l.elem ->> 'id'
  join fournisseur_comptes fc on fc.nom_fournisseur = p.fournisseur and fc.statut = 'valide'
  where p.fournisseur is not null
$$;

-- Un livreur voit : ses courses, et les courses prêtes que personne n'a prises
-- (sauf celles qu'il a lui-même libérées). L'admin voit tout (règle à part).
create or replace function _livreur_voit_course(p_id bigint, p_livreur uuid, p_prete timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profils p where p.id = auth.uid() and p.role = 'livreur')
    and (
      p_livreur = auth.uid()
      or (
        p_livreur is null
        and p_prete is not null
        and not exists (
          select 1 from course_liberations l where l.course_id = p_id and l.livreur_id = auth.uid()
        )
      )
    )
$$;

-- Les fonctions de ce fichier signalent qu'elles modifient elles-mêmes les
-- colonnes protégées (voir le verrou plus bas)
create or replace function _box_interne()
returns void
language sql
as $$
  select set_config('app.box_interne', '1', true)
$$;

revoke all on function _role_courant() from public, anon, authenticated;
revoke all on function _fournisseurs_commande(jsonb) from public, anon, authenticated;
revoke all on function _livreur_voit_course(bigint, uuid, timestamptz) from public, anon;
grant execute on function _livreur_voit_course(bigint, uuid, timestamptz) to authenticated;
revoke all on function _box_interne() from public, anon, authenticated;

-- 6) Visibilité des courses pour les livreurs -------------------------------------
drop policy if exists "Lecture courses admin et livreur" on courses;
drop policy if exists "Lecture courses admin" on courses;
create policy "Lecture courses admin"
on courses
for select
to authenticated
using (exists (select 1 from profils p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "Lecture courses livreur" on courses;
create policy "Lecture courses livreur"
on courses
for select
to authenticated
using (_livreur_voit_course(id, livreur_id, prete_le));

-- 7) Verrous sur la table courses -----------------------------------------------------
-- 7a) Une course créée sans fournisseur inscrit est prête tout de suite
create or replace function course_prete_a_la_creation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_detail jsonb;
begin
  if new.prete_le is null then
    select produits_detail into v_detail from commandes where id::text = new.commande_id::text;
    if not exists (select 1 from _fournisseurs_commande(v_detail)) then
      new.prete_le := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_course_prete_a_la_creation on courses;
create trigger trg_course_prete_a_la_creation
before insert on courses
for each row execute function course_prete_a_la_creation();

-- 7b) Un livreur ne prend qu'une course prête, et pas une course qu'il a libérée
create or replace function verifier_prise_course()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.livreur_id is not null
     and new.livreur_id is distinct from old.livreur_id
     and auth.uid() is not null
     and auth.uid() = new.livreur_id then
    if new.prete_le is null then
      raise exception 'Cette commande n''est pas encore prête';
    end if;
    if exists (
      select 1 from course_liberations l where l.course_id = new.id and l.livreur_id = new.livreur_id
    ) then
      raise exception 'Tu as libéré cette course : elle est proposée à un autre livreur';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_verifier_prise_course on courses;
create trigger trg_verifier_prise_course
before update of livreur_id on courses
for each row execute function verifier_prise_course();

-- 7c) Les colonnes de ce système ne se modifient que par les fonctions ci-dessous
--     (ou par l'admin) : pas d'écriture directe par un livreur
create or replace function proteger_colonnes_box()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and coalesce(current_setting('app.box_interne', true), '') <> '1'
     and (
       new.prete_le is distinct from old.prete_le
       or new.push_prete_le is distinct from old.push_prete_le
       or new.relancee_le is distinct from old.relancee_le
       or new.nb_liberations is distinct from old.nb_liberations
     )
     and coalesce((select role from profils where id = auth.uid()), '') <> 'admin' then
    raise exception 'Modification non autorisée';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_colonnes_box on courses;
create trigger trg_proteger_colonnes_box
before update on courses
for each row execute function proteger_colonnes_box();

-- 8) Le fournisseur marque la commande « prête » ------------------------------------
-- Cœur commun (fournisseur ou admin). p_box nul = taille non précisée
-- (anciennes versions de l'application).
create or replace function _marquer_prete(
  p_commande text, p_fournisseur text, p_box text, p_nb int, p_par_admin boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course courses;
  v_deja timestamptz;
begin
  perform _box_interne();
  if p_box is not null and not exists (select 1 from boxes_livraison where code = p_box) then
    raise exception 'Taille de box invalide';
  end if;
  if p_nb is null or p_nb < 1 or p_nb > 20 then
    raise exception 'Nombre de colis invalide';
  end if;

  select * into v_course from courses where commande_id::text = p_commande order by id limit 1;
  if found and v_course.statut in ('Annulée', 'Livrée') then
    raise exception 'Cette commande est annulée ou déjà livrée';
  end if;

  select prepare_le into v_deja
  from commande_fournisseur_prepa where commande_id = p_commande and fournisseur = p_fournisseur;
  if v_deja is not null and found and v_course.livreur_id is not null and not p_par_admin then
    raise exception 'Un livreur a déjà pris cette course : la taille ne peut plus être modifiée';
  end if;

  insert into commande_fournisseur_prepa
    (commande_id, fournisseur, prepare_le, prepare_par, box_code, nb_colis, par_admin)
  values (p_commande, p_fournisseur, now(), auth.uid(), p_box, p_nb, p_par_admin)
  on conflict (commande_id, fournisseur) do update
    set prepare_le = coalesce(commande_fournisseur_prepa.prepare_le, excluded.prepare_le),
        prepare_par = excluded.prepare_par,
        box_code = excluded.box_code,
        nb_colis = excluded.nb_colis,
        par_admin = excluded.par_admin;

  update courses set prete_le = coalesce(prete_le, now()) where commande_id::text = p_commande;
end;
$$;

create or replace function fournisseur_marquer_prete(p_commande text, p_box text, p_nb int default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c fournisseur_comptes := _fournisseur_valide();
  v_detail jsonb;
begin
  if p_box is null or p_box = '' then
    raise exception 'Choisis la taille de la box';
  end if;
  select c.produits_detail into v_detail from commandes c where c.id::text = p_commande;
  if not found
     or jsonb_array_length(_lignes_commande_fournisseur(v_detail, v_c.nom_fournisseur)) = 0 then
    raise exception 'Commande introuvable';
  end if;
  perform _marquer_prete(p_commande, v_c.nom_fournisseur, p_box, coalesce(p_nb, 1), false);
end;
$$;

-- Le fournisseur annule « prête » (tant qu'aucun livreur n'a pris la course)
create or replace function fournisseur_demarquer_prete(p_commande text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c fournisseur_comptes := _fournisseur_valide();
  v_detail jsonb;
  v_course courses;
begin
  perform _box_interne();
  select c.produits_detail into v_detail from commandes c where c.id::text = p_commande;
  if not found
     or jsonb_array_length(_lignes_commande_fournisseur(v_detail, v_c.nom_fournisseur)) = 0 then
    raise exception 'Commande introuvable';
  end if;
  select * into v_course from courses where commande_id::text = p_commande order by id limit 1;
  if found and (v_course.livreur_id is not null or v_course.statut <> 'À livrer') then
    raise exception 'Un livreur a déjà pris cette course : elle ne peut plus être remise à préparer';
  end if;

  update commande_fournisseur_prepa
     set prepare_le = null, prepare_par = null, box_code = null, nb_colis = 1,
         par_admin = false, notifie_le = null
   where commande_id = p_commande and fournisseur = v_c.nom_fournisseur;

  -- plus aucun fournisseur prêt : la course disparaît de la liste des livreurs
  if not exists (
    select 1 from commande_fournisseur_prepa
    where commande_id = p_commande and prepare_le is not null
  ) then
    update courses set prete_le = null, push_prete_le = null where commande_id::text = p_commande;
  end if;
end;
$$;

-- Ancienne fonction (anciennes versions de l'application) : même effet
create or replace function fournisseur_marquer_prepare(p_commande text, p_prepare boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c fournisseur_comptes := _fournisseur_valide();
  v_detail jsonb;
begin
  select c.produits_detail into v_detail from commandes c where c.id::text = p_commande;
  if not found
     or jsonb_array_length(_lignes_commande_fournisseur(v_detail, v_c.nom_fournisseur)) = 0 then
    raise exception 'Commande introuvable';
  end if;
  if p_prepare then
    perform _marquer_prete(p_commande, v_c.nom_fournisseur, null, 1, false);
  else
    perform fournisseur_demarquer_prete(p_commande);
  end if;
end;
$$;

-- Dépannage : l'admin marque « prête » à la place d'un fournisseur
create or replace function admin_marquer_prete(p_commande text, p_fournisseur text, p_box text, p_nb int default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_detail jsonb;
begin
  if _role_courant() is distinct from 'admin' then
    raise exception 'Accès réservé à l''admin';
  end if;
  if p_box is null or p_box = '' then
    raise exception 'Choisis la taille de la box';
  end if;
  select c.produits_detail into v_detail from commandes c where c.id::text = p_commande;
  if not found or not exists (select 1 from _fournisseurs_commande(v_detail) f where f = p_fournisseur) then
    raise exception 'Commande ou fournisseur introuvable';
  end if;
  perform _marquer_prete(p_commande, p_fournisseur, p_box, coalesce(p_nb, 1), true);
end;
$$;

-- Commandes du fournisseur (même liste qu'avant + box et état de la course)
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

-- 9) Colis de chaque course, pour les livreurs et l'admin ----------------------------
-- { "<id course>": { "colis": [ {fournisseur, prete, box, nb} ], "pretes": n, "total": n } }
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
            'nb', coalesce(pr.nb_colis, 1)
          ) order by f.nom
        ), '[]'::jsonb) as colis,
        count(*) filter (where pr.prepare_le is not null)::int as pretes,
        count(*)::int as total
      from _fournisseurs_commande(cm.produits_detail) as f(nom)
      left join commande_fournisseur_prepa pr
        on pr.commande_id = c.commande_id::text and pr.fournisseur = f.nom
    ) x
    where c.statut in ('À livrer', 'En cours')
      and (v_role = 'admin' or _livreur_voit_course(c.id, c.livreur_id, c.prete_le))
  ), '{}'::jsonb);
end;
$$;

-- 10) Le livreur libère une course (colis trop volumineux) ----------------------------
create or replace function livreur_liberer_course(p_course bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_course courses;
begin
  if v_uid is null then
    raise exception 'Non connecté';
  end if;
  if _role_courant() is distinct from 'livreur' then
    raise exception 'Accès réservé aux livreurs';
  end if;
  perform _box_interne();

  select * into v_course from courses where id = p_course for update;
  if not found or v_course.livreur_id is distinct from v_uid then
    raise exception 'Cette course n''est pas à toi';
  end if;
  if v_course.statut <> 'À livrer' then
    raise exception 'La livraison est déjà démarrée : la course ne peut plus être libérée';
  end if;

  update courses
     set livreur_id = null, relancee_le = now(), nb_liberations = nb_liberations + 1
   where id = p_course;

  insert into course_liberations (course_id, commande_id, livreur_id)
  values (p_course, v_course.commande_id::text, v_uid);

  return jsonb_build_object('commande_id', v_course.commande_id::text, 'nb', v_course.nb_liberations + 1);
end;
$$;

-- Historique des libérations (admin)
create or replace function admin_liberations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if _role_courant() is distinct from 'admin' then
    raise exception 'Accès réservé à l''admin';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'course_id', l.course_id,
      'commande_id', l.commande_id,
      'livreur', coalesce(p.nom, p.email, 'Livreur'),
      'cree_le', l.cree_le,
      'motif', l.motif,
      'adresse', c.adresse
    ) order by l.cree_le desc)
    from (select * from course_liberations order by cree_le desc limit 20) l
    left join profils p on p.id = l.livreur_id
    left join courses c on c.id = l.course_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function _marquer_prete(text, text, text, int, boolean) from public, anon, authenticated;
revoke all on function fournisseur_marquer_prete(text, text, int) from public, anon;
revoke all on function fournisseur_demarquer_prete(text) from public, anon;
revoke all on function fournisseur_marquer_prepare(text, boolean) from public, anon;
revoke all on function admin_marquer_prete(text, text, text, int) from public, anon;
revoke all on function fournisseur_mes_commandes() from public, anon;
revoke all on function courses_colis() from public, anon;
revoke all on function livreur_liberer_course(bigint) from public, anon;
revoke all on function admin_liberations() from public, anon;
grant execute on function fournisseur_marquer_prete(text, text, int) to authenticated;
grant execute on function fournisseur_demarquer_prete(text) to authenticated;
grant execute on function fournisseur_marquer_prepare(text, boolean) to authenticated;
grant execute on function admin_marquer_prete(text, text, text, int) to authenticated;
grant execute on function fournisseur_mes_commandes() to authenticated;
grant execute on function courses_colis() to authenticated;
grant execute on function livreur_liberer_course(bigint) to authenticated;
grant execute on function admin_liberations() to authenticated;

-- 11) Fonctions réservées au serveur (notifications) -------------------------------------
-- Qui a le droit de déclarer une commande prête ? Renvoie le nom du fournisseur
-- concerné (le sien, ou celui demandé si c'est l'admin), sinon rien.
create or replace function autoriser_declaration_prete(p_user uuid, p_commande text, p_fournisseur text default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_detail jsonb;
  v_nom text;
begin
  select produits_detail into v_detail from commandes where id::text = p_commande;
  if not found then
    return null;
  end if;
  if exists (select 1 from profils where id = p_user and role = 'admin') then
    if p_fournisseur is not null and exists (select 1 from _fournisseurs_commande(v_detail) f where f = p_fournisseur) then
      return p_fournisseur;
    end if;
    return null;
  end if;
  select nom_fournisseur into v_nom from fournisseur_comptes where user_id = p_user and statut = 'valide';
  if v_nom is not null and exists (select 1 from _fournisseurs_commande(v_detail) f where f = v_nom) then
    return v_nom;
  end if;
  return null;
end;
$$;

-- Réclame l'envoi de l'alerte « colis prêt » (une seule fois par colis) et
-- renvoie de quoi la rédiger. Sans effet (renvoie rien) si déjà envoyée.
create or replace function reclamer_push_prete(p_commande text, p_fournisseur text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course courses;
  v_pr commande_fournisseur_prepa;
  v_colis jsonb;
  v_total int;
  v_id bigint;
begin
  perform _box_interne();
  select * into v_course from courses where commande_id::text = p_commande order by id limit 1;
  if not found or v_course.prete_le is null or v_course.statut <> 'À livrer' then
    return null;
  end if;

  if p_fournisseur is not null then
    update commande_fournisseur_prepa
       set notifie_le = now()
     where commande_id = p_commande and fournisseur = p_fournisseur
       and prepare_le is not null and notifie_le is null
    returning * into v_pr;
    if not found then
      return null;
    end if;
  end if;

  if v_course.livreur_id is not null then
    if p_fournisseur is null then
      return null;
    end if;
    return jsonb_build_object(
      'cas', 'livreur', 'livreur_id', v_course.livreur_id,
      'fournisseur', p_fournisseur, 'box', v_pr.box_code, 'nb', v_pr.nb_colis,
      'adresse', v_course.adresse
    );
  end if;

  update courses set push_prete_le = now()
   where id = v_course.id and push_prete_le is null
  returning id into v_id;
  if v_id is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('fournisseur', pr.fournisseur, 'box', pr.box_code, 'nb', pr.nb_colis)
                            order by pr.fournisseur), '[]'::jsonb)
    into v_colis
  from commande_fournisseur_prepa pr
  where pr.commande_id = p_commande and pr.prepare_le is not null;

  select count(*) into v_total
  from _fournisseurs_commande((select produits_detail from commandes where id::text = p_commande));

  return jsonb_build_object(
    'cas', 'tous', 'colis', v_colis, 'total', v_total, 'adresse', v_course.adresse
  );
end;
$$;

-- Réclame l'envoi de l'alerte « course relancée »
create or replace function reclamer_push_liberation(p_user uuid, p_commande text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lib course_liberations;
  v_course courses;
  v_colis jsonb;
begin
  update course_liberations set notifie_le = now()
   where id = (
     select id from course_liberations
     where commande_id = p_commande and livreur_id = p_user and notifie_le is null
     order by cree_le desc limit 1
   )
  returning * into v_lib;
  if not found then
    return null;
  end if;

  select * into v_course from courses where id = v_lib.course_id;
  select coalesce(jsonb_agg(jsonb_build_object('fournisseur', pr.fournisseur, 'box', pr.box_code, 'nb', pr.nb_colis)
                            order by pr.fournisseur), '[]'::jsonb)
    into v_colis
  from commande_fournisseur_prepa pr
  where pr.commande_id = p_commande and pr.prepare_le is not null;

  return jsonb_build_object(
    'livreur_exclu', p_user, 'nb', v_course.nb_liberations, 'colis', v_colis,
    'adresse', v_course.adresse, 'numero', (select numero_suivi from commandes where id::text = p_commande)
  );
end;
$$;

-- Rappels à envoyer maintenant (appelée toutes les minutes par le balayage)
-- et marquage immédiat pour ne jamais les envoyer deux fois.
create or replace function rappels_a_envoyer()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_depuis timestamptz := coalesce((select valeur::timestamptz from box_config where cle = 'depuis'), now());
  r record;
  v_sorties jsonb := '[]'::jsonb;
  v_alerter boolean;
  v_ids jsonb;
begin
  for r in
    select c.commande_id::text as commande_id, cm.numero_suivi, f.nom as fournisseur,
           extract(epoch from (now() - cm.created_at)) / 60 as age_min,
           rp.dernier_rappel_le, coalesce(rp.nb_rappels, 0) as nb_rappels, rp.admin_alerte_le
    from courses c
    join commandes cm on cm.id::text = c.commande_id::text
    cross join lateral _fournisseurs_commande(cm.produits_detail) as f(nom)
    left join commande_fournisseur_prepa pr
      on pr.commande_id = c.commande_id::text and pr.fournisseur = f.nom
    left join commande_fournisseur_rappels rp
      on rp.commande_id = c.commande_id::text and rp.fournisseur = f.nom
    where c.statut = 'À livrer'
      and coalesce(cm.rembourse, false) = false
      and pr.prepare_le is null
      and cm.created_at >= v_depuis
      and cm.created_at > now() - interval '1 day'
  loop
    v_alerter := r.age_min >= 20 and r.admin_alerte_le is null;
    if (r.age_min >= 10 and r.nb_rappels < 6
        and (r.dernier_rappel_le is null or r.dernier_rappel_le <= now() - interval '580 seconds'))
       or v_alerter then
      select coalesce(jsonb_agg(user_id), '[]'::jsonb) into v_ids
      from fournisseur_comptes where nom_fournisseur = r.fournisseur and statut = 'valide';

      insert into commande_fournisseur_rappels (commande_id, fournisseur, dernier_rappel_le, nb_rappels, admin_alerte_le)
      values (
        r.commande_id, r.fournisseur,
        case when r.age_min >= 10 and r.nb_rappels < 6
                  and (r.dernier_rappel_le is null or r.dernier_rappel_le <= now() - interval '580 seconds')
             then now() else r.dernier_rappel_le end,
        case when r.age_min >= 10 and r.nb_rappels < 6
                  and (r.dernier_rappel_le is null or r.dernier_rappel_le <= now() - interval '580 seconds')
             then 1 else 0 end,
        case when v_alerter then now() else null end
      )
      on conflict (commande_id, fournisseur) do update
        set dernier_rappel_le = excluded.dernier_rappel_le,
            nb_rappels = commande_fournisseur_rappels.nb_rappels + excluded.nb_rappels,
            admin_alerte_le = coalesce(commande_fournisseur_rappels.admin_alerte_le, excluded.admin_alerte_le);

      v_sorties := v_sorties || jsonb_build_object(
        'commande_id', r.commande_id, 'numero', r.numero_suivi, 'fournisseur', r.fournisseur,
        'age_min', floor(r.age_min)::int, 'user_ids', v_ids,
        'rappel', (r.age_min >= 10 and r.nb_rappels < 6
                   and (r.dernier_rappel_le is null or r.dernier_rappel_le <= now() - interval '580 seconds')),
        'alerter_admin', v_alerter
      );
    end if;
  end loop;
  return v_sorties;
end;
$$;

-- Alertes « colis prêt » restées sans envoi (navigateur fermé trop vite...)
create or replace function pushes_prete_en_attente()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_depuis timestamptz := coalesce((select valeur::timestamptz from box_config where cle = 'depuis'), now());
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('commande_id', t.commande_id, 'fournisseur', t.fournisseur))
    from (
      select pr.commande_id, pr.fournisseur
      from commande_fournisseur_prepa pr
      join commandes cm on cm.id::text = pr.commande_id
      where pr.prepare_le is not null and pr.notifie_le is null
        and pr.prepare_le < now() - interval '30 seconds'
        and cm.created_at >= v_depuis and cm.created_at > now() - interval '1 day'
      union all
      select c.commande_id::text, null::text
      from courses c
      join commandes cm on cm.id::text = c.commande_id::text
      where c.prete_le is not null and c.push_prete_le is null and c.statut = 'À livrer'
        and c.prete_le < now() - interval '30 seconds'
        and cm.created_at >= v_depuis and cm.created_at > now() - interval '1 day'
        and not exists (select 1 from commande_fournisseur_prepa p2
                        where p2.commande_id = c.commande_id::text and p2.prepare_le is not null)
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function autoriser_declaration_prete(uuid, text, text) from public, anon, authenticated;
revoke all on function reclamer_push_prete(text, text) from public, anon, authenticated;
revoke all on function reclamer_push_liberation(uuid, text) from public, anon, authenticated;
revoke all on function rappels_a_envoyer() from public, anon, authenticated;
revoke all on function pushes_prete_en_attente() from public, anon, authenticated;
grant execute on function autoriser_declaration_prete(uuid, text, text) to service_role;
grant execute on function reclamer_push_prete(text, text) to service_role;
grant execute on function reclamer_push_liberation(uuid, text) to service_role;
grant execute on function rappels_a_envoyer() to service_role;
grant execute on function pushes_prete_en_attente() to service_role;

notify pgrst, 'reload schema';
