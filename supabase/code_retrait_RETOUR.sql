-- =====================================================================
-- Retour en arrière : supprime le code de retrait et remet les deux fonctions
-- (courses_colis, fournisseur_mes_commandes) dans leur état d'avant.
-- À exécuter UNE FOIS dans Supabase > SQL Editor.
-- =====================================================================

drop trigger if exists trg_verifier_remise_avant_depart on courses;
drop trigger if exists trg_gerer_codes_retrait on courses;
drop function if exists verifier_remise_avant_depart();
drop function if exists gerer_codes_retrait();
drop function if exists fournisseur_confirmer_remise(text, text);
drop table if exists codes_retrait;

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

revoke all on function courses_colis() from public, anon;
revoke all on function fournisseur_mes_commandes() from public, anon;
grant execute on function courses_colis() to authenticated;
grant execute on function fournisseur_mes_commandes() to authenticated;

notify pgrst, 'reload schema';
