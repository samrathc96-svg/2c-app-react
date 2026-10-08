-- =====================================================================
-- Espace fournisseur (version 1) : compte fournisseur + catalogue
-- À exécuter UNE FOIS dans Supabase > SQL Editor (relançable sans danger).
--
--  * Un fournisseur s'inscrit via un lien dédié (2cdelivery.ch/?fournisseur).
--    Son compte est "en attente" jusqu'à validation par 2C.
--  * 2C valide le compte, lui attribue ses MÉTIERS (ventilation, plomberie…)
--    et décide si ses produits sont publiés directement ou après validation.
--  * Le fournisseur gère ses produits (formulaire, photo, stock, import CSV)
--    dans SON espace, sans passer par 2C. Il organise ses sous-sections.
--  * Les produits existants restent "publiés" : rien ne change pour eux.
-- =====================================================================

-- 1. Colonnes de la table produits ----------------------------------------------

alter table produits add column if not exists fournisseur text;
alter table produits add column if not exists reference text;
-- publie : visible sur le site ; en_attente : attend la validation de 2C ;
-- refuse / masque : non visible
alter table produits add column if not exists statut_validation text not null default 'publie';
alter table produits drop constraint if exists produits_statut_validation_check;
alter table produits add constraint produits_statut_validation_check
  check (statut_validation in ('publie', 'en_attente', 'refuse', 'masque'));
alter table produits add column if not exists maj_le timestamptz default now();

-- Une même référence ne peut exister qu'une fois chez un fournisseur
create unique index if not exists produits_fournisseur_reference_idx
  on produits (fournisseur, reference)
  where reference is not null and fournisseur is not null;

-- 2. Comptes fournisseurs ----------------------------------------------------------

create table if not exists fournisseur_comptes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Nom du fournisseur : identique à celui de la carte / des accords entreprise
  nom_fournisseur text not null,
  telephone text,
  statut text not null default 'en_attente'
    check (statut in ('en_attente', 'valide', 'suspendu')),
  -- true : ses produits sont publiés tout de suite (fournisseur de confiance)
  publication_directe boolean not null default false,
  -- métiers dans lesquels il peut publier (attribués par 2C)
  metiers text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table fournisseur_comptes enable row level security;

create or replace function est_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profils where profils.id = auth.uid() and profils.role = 'admin');
$$;

drop policy if exists "fournisseur_comptes_lecture" on fournisseur_comptes;
create policy "fournisseur_comptes_lecture" on fournisseur_comptes
  for select to authenticated
  using (user_id = auth.uid() or est_admin());

-- Appelée par le site après connexion d'un compte inscrit via le lien
-- fournisseur (le nom de l'entreprise voyage avec l'inscription).
create or replace function initialiser_compte_fournisseur()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_meta jsonb := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  v_nom text := nullif(trim(coalesce(v_meta ->> 'fournisseur_nom', '')), '');
  v_tel text := nullif(trim(coalesce(v_meta ->> 'fournisseur_telephone', '')), '');
  v_c fournisseur_comptes%rowtype;
begin
  if v_uid is null then
    raise exception 'Non connecté';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  select * into v_c from fournisseur_comptes where user_id = v_uid;
  if not found then
    if v_nom is null then
      return null;
    end if;
    insert into fournisseur_comptes (user_id, nom_fournisseur, telephone)
    values (v_uid, left(v_nom, 120), left(v_tel, 40))
    returning * into v_c;
  end if;

  return to_jsonb(v_c);
end;
$$;

create or replace function mon_compte_fournisseur()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(c) from fournisseur_comptes c where c.user_id = auth.uid();
$$;

-- Métiers existants sur le site (pour les listes de choix)
create or replace function metiers_disponibles()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct m order by m), '{}')
  from (
    select metier as m from produits where metier is not null and trim(metier) <> ''
    union
    select metier from fournisseurs where metier is not null and trim(metier) <> ''
  ) t;
$$;

-- 3. Fonctions du fournisseur --------------------------------------------------------

-- Compte fournisseur VALIDÉ de la personne connectée (sinon erreur)
create or replace function _fournisseur_valide()
returns fournisseur_comptes
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c fournisseur_comptes;
begin
  select * into v_c from fournisseur_comptes where user_id = auth.uid();
  if not found then
    raise exception 'Accès refusé';
  end if;
  if v_c.statut <> 'valide' then
    raise exception 'Compte fournisseur non validé';
  end if;
  return v_c;
end;
$$;

revoke all on function _fournisseur_valide() from public, anon;

create or replace function fournisseur_mes_produits()
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
    select jsonb_agg(to_jsonb(p) order by p.metier, p.sous_section, p.nom)
    from produits p
    where p.fournisseur = v_c.nom_fournisseur
  ), '[]'::jsonb);
end;
$$;

-- Crée ou modifie UN produit. Nouveau produit : publié tout de suite si le
-- compte est en "publication directe", sinon en attente de validation.
-- Produit déjà existant : modifications appliquées immédiatement (son statut
-- ne change pas).
create or replace function fournisseur_enregistrer_produit(
  p_id text,
  p_metier text,
  p_sous_section text,
  p_nom text,
  p_prix numeric,
  p_image_url text,
  p_stock int,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c fournisseur_comptes := _fournisseur_valide();
  v_metier text := trim(coalesce(p_metier, ''));
  v_sous text := trim(coalesce(p_sous_section, ''));
  v_nom text := trim(coalesce(p_nom, ''));
  v_ref text := nullif(trim(coalesce(p_reference, '')), '');
  v_row jsonb;
begin
  if v_nom = '' or v_sous = '' or v_metier = '' then
    raise exception 'Métier, sous-section et nom obligatoires';
  end if;
  if p_prix is null or p_prix < 0 or p_prix > 100000 then
    raise exception 'Prix invalide';
  end if;
  if p_stock is not null and p_stock < 0 then
    raise exception 'Stock invalide';
  end if;
  if not (v_metier = any (v_c.metiers)) then
    raise exception 'Métier non autorisé pour ce compte';
  end if;

  if p_id is not null and p_id <> '' then
    update produits
       set metier = v_metier, sous_section = v_sous, nom = v_nom, prix = p_prix,
           image_url = nullif(trim(coalesce(p_image_url, '')), ''),
           quantite_stock = p_stock, reference = v_ref, maj_le = now()
     where id::text = p_id and fournisseur = v_c.nom_fournisseur;
    if not found then
      raise exception 'Produit introuvable';
    end if;
    select to_jsonb(p) into v_row from produits p where p.id::text = p_id;
  else
    insert into produits (metier, sous_section, nom, prix, image_url, quantite_stock, fournisseur,
                          reference, statut_validation, maj_le)
    values (v_metier, v_sous, v_nom, p_prix, nullif(trim(coalesce(p_image_url, '')), ''), p_stock,
            v_c.nom_fournisseur, v_ref,
            case when v_c.publication_directe then 'publie' else 'en_attente' end, now())
    returning to_jsonb(produits.*) into v_row;
  end if;

  return v_row;
end;
$$;

-- Mise à jour rapide du stock (jamais soumise à validation)
create or replace function fournisseur_modifier_stock(p_id text, p_stock int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c fournisseur_comptes := _fournisseur_valide();
begin
  if p_stock is not null and p_stock < 0 then
    raise exception 'Stock invalide';
  end if;
  update produits set quantite_stock = p_stock, maj_le = now()
   where id::text = p_id and fournisseur = v_c.nom_fournisseur;
  if not found then
    raise exception 'Produit introuvable';
  end if;
end;
$$;

create or replace function fournisseur_supprimer_produit(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c fournisseur_comptes := _fournisseur_valide();
begin
  delete from produits where id::text = p_id and fournisseur = v_c.nom_fournisseur;
  if not found then
    raise exception 'Produit introuvable';
  end if;
end;
$$;

-- Import d'un catalogue (liste de lignes JSON déjà lues dans le fichier).
-- Chaque ligne : metier, sous_section, nom, prix, stock, reference, image_url.
-- Si "reference" existe déjà chez ce fournisseur -> mise à jour ; sinon création
-- (nouveaux produits soumis à validation selon le compte).
create or replace function fournisseur_importer_produits(p_lignes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c fournisseur_comptes := _fournisseur_valide();
  v_l jsonb;
  v_i int := 0;
  v_crees int := 0;
  v_modifies int := 0;
  v_erreurs jsonb := '[]'::jsonb;
  v_metier text;
  v_sous text;
  v_nom text;
  v_ref text;
  v_prix numeric;
  v_stock int;
  v_image text;
  v_existe boolean;
begin
  if jsonb_typeof(p_lignes) <> 'array' then
    raise exception 'Fichier invalide';
  end if;
  if jsonb_array_length(p_lignes) > 2000 then
    raise exception 'Maximum 2000 produits par import';
  end if;

  for v_l in select * from jsonb_array_elements(p_lignes) loop
    v_i := v_i + 1;
    begin
      v_metier := trim(coalesce(v_l ->> 'metier', ''));
      v_sous := trim(coalesce(v_l ->> 'sous_section', ''));
      v_nom := trim(coalesce(v_l ->> 'nom', ''));
      v_ref := nullif(trim(coalesce(v_l ->> 'reference', '')), '');
      v_image := nullif(trim(coalesce(v_l ->> 'image_url', '')), '');
      v_prix := nullif(trim(coalesce(v_l ->> 'prix', '')), '')::numeric;
      v_stock := nullif(trim(coalesce(v_l ->> 'stock', '')), '')::int;

      if v_nom = '' or v_sous = '' or v_metier = '' then
        raise exception 'métier, sous-section et nom obligatoires';
      end if;
      if v_prix is null or v_prix < 0 or v_prix > 100000 then
        raise exception 'prix invalide';
      end if;
      if v_stock is not null and v_stock < 0 then
        raise exception 'stock invalide';
      end if;
      if not (v_metier = any (v_c.metiers)) then
        raise exception 'métier non autorisé (%)', v_metier;
      end if;

      v_existe := false;
      if v_ref is not null then
        select true into v_existe from produits
         where fournisseur = v_c.nom_fournisseur and reference = v_ref;
      end if;

      if coalesce(v_existe, false) then
        update produits
           set metier = v_metier, sous_section = v_sous, nom = v_nom, prix = v_prix,
               image_url = coalesce(v_image, image_url), quantite_stock = v_stock, maj_le = now()
         where fournisseur = v_c.nom_fournisseur and reference = v_ref;
        v_modifies := v_modifies + 1;
      else
        insert into produits (metier, sous_section, nom, prix, image_url, quantite_stock, fournisseur,
                              reference, statut_validation, maj_le)
        values (v_metier, v_sous, v_nom, v_prix, v_image, v_stock, v_c.nom_fournisseur, v_ref,
                case when v_c.publication_directe then 'publie' else 'en_attente' end, now());
        v_crees := v_crees + 1;
      end if;
    exception when others then
      v_erreurs := v_erreurs || jsonb_build_object('ligne', v_i, 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('crees', v_crees, 'modifies', v_modifies, 'erreurs', v_erreurs);
end;
$$;

-- 4. Stockage des photos : un fournisseur validé dépose dans fournisseurs/<son id>/ --

drop policy if exists "produits_upload_fournisseur" on storage.objects;
create policy "produits_upload_fournisseur" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'produits'
    and (storage.foldername(name))[1] = 'fournisseurs'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from public.fournisseur_comptes c
      where c.user_id = auth.uid() and c.statut = 'valide'
    )
  );

-- 5. Fonctions admin ---------------------------------------------------------------------

create or replace function admin_comptes_fournisseurs()
returns table (
  user_id uuid,
  nom_fournisseur text,
  email text,
  contact_nom text,
  telephone text,
  statut text,
  publication_directe boolean,
  metiers text[],
  created_at timestamptz,
  nb_produits bigint,
  nb_en_attente bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not est_admin() then
    raise exception 'Accès refusé';
  end if;
  return query
  select c.user_id, c.nom_fournisseur, p.email::text, p.nom::text, c.telephone, c.statut,
         c.publication_directe, c.metiers, c.created_at,
         (select count(*) from produits x where x.fournisseur = c.nom_fournisseur),
         (select count(*) from produits x where x.fournisseur = c.nom_fournisseur
            and x.statut_validation = 'en_attente')
  from fournisseur_comptes c
  left join profils p on p.id = c.user_id
  order by (c.statut = 'en_attente') desc, c.created_at desc;
end;
$$;

create or replace function admin_modifier_compte_fournisseur(
  p_user uuid,
  p_nom text,
  p_statut text,
  p_publication_directe boolean,
  p_metiers text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not est_admin() then
    raise exception 'Accès refusé';
  end if;
  if p_statut not in ('en_attente', 'valide', 'suspendu') then
    raise exception 'Statut invalide';
  end if;
  if nullif(trim(coalesce(p_nom, '')), '') is null then
    raise exception 'Nom obligatoire';
  end if;
  update fournisseur_comptes
     set nom_fournisseur = trim(p_nom), statut = p_statut,
         publication_directe = coalesce(p_publication_directe, false),
         metiers = coalesce(p_metiers, '{}')
   where user_id = p_user;
  if not found then
    raise exception 'Compte introuvable';
  end if;
end;
$$;

-- Produits en attente de validation (tous fournisseurs)
create or replace function admin_produits_en_attente()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not est_admin() then
    raise exception 'Accès refusé';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(p) order by p.fournisseur, p.metier, p.sous_section, p.nom)
    from produits p
    where p.statut_validation = 'en_attente'
  ), '[]'::jsonb);
end;
$$;

create or replace function admin_decider_produits(p_ids text[], p_decision text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if not est_admin() then
    raise exception 'Accès refusé';
  end if;
  if p_decision not in ('publie', 'refuse', 'masque') then
    raise exception 'Décision invalide';
  end if;
  update produits set statut_validation = p_decision, maj_le = now()
   where id::text = any (p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 6. Droits d'appel -------------------------------------------------------------------------

revoke all on function initialiser_compte_fournisseur() from public, anon;
revoke all on function mon_compte_fournisseur() from public, anon;
revoke all on function fournisseur_mes_produits() from public, anon;
revoke all on function fournisseur_enregistrer_produit(text, text, text, text, numeric, text, int, text) from public, anon;
revoke all on function fournisseur_modifier_stock(text, int) from public, anon;
revoke all on function fournisseur_supprimer_produit(text) from public, anon;
revoke all on function fournisseur_importer_produits(jsonb) from public, anon;
revoke all on function admin_comptes_fournisseurs() from public, anon;
revoke all on function admin_modifier_compte_fournisseur(uuid, text, text, boolean, text[]) from public, anon;
revoke all on function admin_produits_en_attente() from public, anon;
revoke all on function admin_decider_produits(text[], text) from public, anon;

grant execute on function initialiser_compte_fournisseur() to authenticated;
grant execute on function mon_compte_fournisseur() to authenticated;
grant execute on function metiers_disponibles() to authenticated;
grant execute on function fournisseur_mes_produits() to authenticated;
grant execute on function fournisseur_enregistrer_produit(text, text, text, text, numeric, text, int, text) to authenticated;
grant execute on function fournisseur_modifier_stock(text, int) to authenticated;
grant execute on function fournisseur_supprimer_produit(text) to authenticated;
grant execute on function fournisseur_importer_produits(jsonb) to authenticated;
grant execute on function admin_comptes_fournisseurs() to authenticated;
grant execute on function admin_modifier_compte_fournisseur(uuid, text, text, boolean, text[]) to authenticated;
grant execute on function admin_produits_en_attente() to authenticated;
grant execute on function admin_decider_produits(text[], text) to authenticated;

notify pgrst, 'reload schema';
