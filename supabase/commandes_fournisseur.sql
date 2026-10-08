-- =====================================================================
-- Commandes côté fournisseur : bon de commande + suivi de préparation
-- À exécuter UNE FOIS dans Supabase > SQL Editor (relançable sans danger).
-- Prérequis : espace_fournisseur.sql déjà exécuté.
--
--  * Chaque fournisseur voit, dans son espace, les commandes qui contiennent
--    SES produits (et uniquement ses lignes), avec : numéro de commande,
--    client / entreprise, chantier, personne qui commande, adresse de
--    livraison, produits, quantités, prix.
--    Il ne voit NI le téléphone NI l'email du client.
--  * Il peut marquer une commande comme "préparée".
--  * Une commande annulée (ou remboursée) reste dans son historique, avec la
--    mention "Annulée" : il sait qu'il ne doit plus la préparer.
--  * Le lien commande -> fournisseur se fait par le produit (produits.fournisseur).
-- =====================================================================

-- 1. Suivi par commande et par fournisseur ---------------------------------
create table if not exists commande_fournisseur_prepa (
  commande_id text not null,
  fournisseur text not null,
  -- date d'envoi de l'email "bon de commande" (évite les doublons)
  bon_envoye_le timestamptz,
  -- date à laquelle le fournisseur a marqué la commande "préparée"
  prepare_le timestamptz,
  prepare_par uuid references auth.users (id) on delete set null,
  primary key (commande_id, fournisseur)
);

-- Aucun accès direct : tout passe par les fonctions ci-dessous
-- (et par la clé serveur des fonctions d'envoi d'email).
alter table commande_fournisseur_prepa enable row level security;

-- 2. Lignes d'une commande qui concernent un fournisseur --------------------
create or replace function _lignes_commande_fournisseur(p_detail jsonb, p_fournisseur text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'nom', coalesce(p.nom, l.elem ->> 'nom'),
             'reference', p.reference,
             'quantite', coalesce(nullif(l.elem ->> 'quantite', '')::numeric, 1),
             'prix', coalesce(nullif(l.elem ->> 'prix', '')::numeric, p.prix, 0)
           )
           order by l.ord
         ), '[]'::jsonb)
  from jsonb_array_elements(
         case when jsonb_typeof(p_detail) = 'array' then p_detail else '[]'::jsonb end
       ) with ordinality as l(elem, ord)
  join produits p on p.id::text = l.elem ->> 'id'
  where p.fournisseur = p_fournisseur;
$$;

revoke all on function _lignes_commande_fournisseur(jsonb, text) from public, anon, authenticated;

-- 3. Commandes du fournisseur connecté ----------------------------------------
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
          'prepare_le', pr.prepare_le,
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

-- Nombre de commandes à préparer (pastille sur l'onglet "Commandes")
create or replace function fournisseur_commandes_a_preparer()
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c fournisseur_comptes := _fournisseur_valide();
  v_n int;
begin
  select count(*) into v_n
  from commandes c
  left join commande_fournisseur_prepa pr
    on pr.commande_id = c.id::text and pr.fournisseur = v_c.nom_fournisseur
  where jsonb_array_length(_lignes_commande_fournisseur(c.produits_detail, v_c.nom_fournisseur)) > 0
    and coalesce(c.rembourse, false) = false
    and pr.prepare_le is null
    and not exists (
      select 1 from courses co
      where co.commande_id::text = c.id::text and co.statut in ('Annulée', 'Livrée', 'En cours')
    );
  return v_n;
end;
$$;

-- Marque (ou démarque) une commande comme préparée
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

  insert into commande_fournisseur_prepa (commande_id, fournisseur, prepare_le, prepare_par)
  values (
    p_commande, v_c.nom_fournisseur,
    case when p_prepare then now() else null end,
    case when p_prepare then auth.uid() else null end
  )
  on conflict (commande_id, fournisseur) do update
    set prepare_le = excluded.prepare_le,
        prepare_par = excluded.prepare_par;
end;
$$;

-- Droits : seuls les comptes connectés appellent ces fonctions (et elles
-- refusent tout compte qui n'est pas un fournisseur validé).
revoke all on function fournisseur_mes_commandes() from public, anon;
revoke all on function fournisseur_commandes_a_preparer() from public, anon;
revoke all on function fournisseur_marquer_prepare(text, boolean) from public, anon;
grant execute on function fournisseur_mes_commandes() to authenticated;
grant execute on function fournisseur_commandes_a_preparer() to authenticated;
grant execute on function fournisseur_marquer_prepare(text, boolean) to authenticated;

notify pgrst, 'reload schema';
