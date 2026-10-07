-- =====================================================================
-- Comptes entreprise : responsable + employés (étape 1)
-- À exécuter UNE FOIS dans Supabase > SQL Editor.
-- Sans danger pour l'existant : le script ne supprime rien et peut être
-- relancé plusieurs fois (create ... if not exists / create or replace).
-- Supabase affichera peut-être "Potential issues detected" : ce script
-- active la sécurité (RLS) sur ses tables, tu peux cliquer "Run and enable RLS"
-- ou "Run without RLS" (le résultat est le même ici).
-- =====================================================================

-- 1. Tables ------------------------------------------------------------

create table if not exists entreprises (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  -- en_attente : créée, pas encore vérifiée par 2C ; validee ; suspendue
  statut text not null default 'en_attente'
    check (statut in ('en_attente', 'validee', 'suspendue')),
  -- carte (par défaut) | prepaye | mensuel : réglé par 2C selon l'accord conclu
  mode_paiement text not null default 'carte'
    check (mode_paiement in ('carte', 'prepaye', 'mensuel')),
  plafond_mensuel numeric,
  -- code secret contenu dans le lien d'invitation des employés
  code_invitation text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

create table if not exists entreprise_membres (
  user_id uuid primary key references auth.users (id) on delete cascade,
  entreprise_id uuid not null references entreprises (id) on delete cascade,
  role_entreprise text not null check (role_entreprise in ('responsable', 'employe')),
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists entreprise_membres_entreprise_idx
  on entreprise_membres (entreprise_id);

-- Fournisseurs chez lesquels l'entreprise a un accord (commande "sur compte").
create table if not exists entreprise_fournisseurs (
  entreprise_id uuid not null references entreprises (id) on delete cascade,
  fournisseur text not null,
  primary key (entreprise_id, fournisseur)
);

-- 2. Sécurité (RLS) ----------------------------------------------------
-- Aucune écriture directe depuis le site : tout passe par les fonctions
-- ci-dessous, qui vérifient qui fait quoi.

alter table entreprises enable row level security;
alter table entreprise_membres enable row level security;
alter table entreprise_fournisseurs enable row level security;

create or replace function est_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profils where profils.id = auth.uid() and profils.role = 'admin');
$$;

drop policy if exists "membres_lecture_perso" on entreprise_membres;
create policy "membres_lecture_perso" on entreprise_membres
  for select to authenticated
  using (user_id = auth.uid() or est_admin());

drop policy if exists "entreprises_lecture" on entreprises;
create policy "entreprises_lecture" on entreprises
  for select to authenticated
  using (
    est_admin()
    or id in (select entreprise_id from entreprise_membres where user_id = auth.uid())
  );

drop policy if exists "entreprise_fournisseurs_lecture" on entreprise_fournisseurs;
create policy "entreprise_fournisseurs_lecture" on entreprise_fournisseurs
  for select to authenticated
  using (
    est_admin()
    or entreprise_id in (select entreprise_id from entreprise_membres where user_id = auth.uid())
  );

-- 3. Rattachement à la première connexion -------------------------------
-- Appelée par le site après chaque connexion d'un compte "entreprise" :
--  * lien d'invitation présent dans l'inscription -> devient employé ;
--  * sinon -> crée l'entreprise et devient responsable.
-- Sans effet si le compte est déjà rattaché.

create or replace function initialiser_compte_entreprise()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_nom text;
  v_meta jsonb := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  v_code text := nullif(trim(coalesce(v_meta ->> 'invitation', '')), '');
  v_nom_entreprise text := nullif(trim(coalesce(v_meta ->> 'entreprise_nom', '')), '');
  v_ent entreprises%rowtype;
  v_membre entreprise_membres%rowtype;
begin
  if v_uid is null then
    raise exception 'Non connecté';
  end if;

  -- évite les doublons si le site appelle la fonction deux fois en même temps
  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  select role, nom into v_role, v_nom from profils where id = v_uid;
  if v_role is distinct from 'entreprise' then
    return jsonb_build_object('statut', 'non_entreprise');
  end if;

  select * into v_membre from entreprise_membres where user_id = v_uid;

  if not found then
    if v_code is not null then
      select * into v_ent from entreprises where code_invitation = v_code;
      if not found then
        return jsonb_build_object('statut', 'invitation_invalide');
      end if;
      insert into entreprise_membres (user_id, entreprise_id, role_entreprise)
      values (v_uid, v_ent.id, 'employe')
      returning * into v_membre;
    else
      insert into entreprises (nom)
      values (coalesce(v_nom_entreprise, nullif(trim(coalesce(v_nom, '')), ''), 'Entreprise'))
      returning * into v_ent;
      insert into entreprise_membres (user_id, entreprise_id, role_entreprise)
      values (v_uid, v_ent.id, 'responsable')
      returning * into v_membre;
    end if;
  end if;

  select * into v_ent from entreprises where id = v_membre.entreprise_id;

  return jsonb_build_object(
    'statut', 'ok',
    'entreprise_id', v_ent.id,
    'entreprise_nom', v_ent.nom,
    'statut_entreprise', v_ent.statut,
    'mode_paiement', v_ent.mode_paiement,
    'role_entreprise', v_membre.role_entreprise,
    'actif', v_membre.actif,
    'code_invitation', case when v_membre.role_entreprise = 'responsable' then v_ent.code_invitation else null end
  );
end;
$$;

-- Nom de l'entreprise qui invite (affiché sur la page d'inscription, sans compte).
create or replace function nom_entreprise_invitation(p_code text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nom from entreprises where code_invitation = nullif(trim(coalesce(p_code, '')), '');
$$;

-- 4. Espace du responsable ---------------------------------------------

create or replace function entreprise_du_responsable()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.entreprise_id
  from entreprise_membres m
  where m.user_id = auth.uid() and m.role_entreprise = 'responsable' and m.actif;
$$;

create or replace function equipe_entreprise()
returns table (
  user_id uuid,
  nom text,
  email text,
  role_entreprise text,
  actif boolean,
  created_at timestamptz,
  nb_commandes bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ent uuid := entreprise_du_responsable();
begin
  if v_ent is null then
    raise exception 'Accès refusé';
  end if;
  return query
  select m.user_id,
         p.nom::text,
         p.email::text,
         m.role_entreprise::text,
         m.actif,
         m.created_at,
         (select count(*) from commandes c where c.user_id = m.user_id)
  from entreprise_membres m
  join profils p on p.id = m.user_id
  where m.entreprise_id = v_ent
  order by m.role_entreprise desc, m.created_at;
end;
$$;

create or replace function changer_acces_employe(p_user_id uuid, p_actif boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ent uuid := entreprise_du_responsable();
begin
  if v_ent is null then
    raise exception 'Accès refusé';
  end if;
  update entreprise_membres
     set actif = p_actif
   where user_id = p_user_id
     and entreprise_id = v_ent
     and role_entreprise = 'employe';
  if not found then
    raise exception 'Employé introuvable';
  end if;
end;
$$;

create or replace function regenerer_invitation()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ent uuid := entreprise_du_responsable();
  v_code text := replace(gen_random_uuid()::text, '-', '');
begin
  if v_ent is null then
    raise exception 'Accès refusé';
  end if;
  update entreprises set code_invitation = v_code where id = v_ent;
  return v_code;
end;
$$;

-- Commandes passées par les membres de l'entreprise (vue du responsable).
create or replace function commandes_equipe()
returns setof commandes
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ent uuid := entreprise_du_responsable();
begin
  if v_ent is null then
    raise exception 'Accès refusé';
  end if;
  return query
  select c.*
  from commandes c
  join entreprise_membres m on m.user_id = c.user_id
  where m.entreprise_id = v_ent
  order by c.created_at desc;
end;
$$;

-- Statut de livraison de ces commandes.
create or replace function statuts_equipe()
returns table (commande_id text, statut text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ent uuid := entreprise_du_responsable();
begin
  if v_ent is null then
    raise exception 'Accès refusé';
  end if;
  return query
  select co.commande_id::text, co.statut::text
  from courses co
  join commandes c on c.id::text = co.commande_id::text
  join entreprise_membres m on m.user_id = c.user_id
  where m.entreprise_id = v_ent;
end;
$$;

-- 5. Administration 2C --------------------------------------------------

create or replace function admin_entreprises()
returns table (
  id uuid,
  nom text,
  statut text,
  mode_paiement text,
  plafond_mensuel numeric,
  created_at timestamptz,
  nb_membres bigint,
  responsable_nom text,
  responsable_email text,
  fournisseurs text[]
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
  select e.id,
         e.nom,
         e.statut,
         e.mode_paiement,
         e.plafond_mensuel,
         e.created_at,
         (select count(*) from entreprise_membres m where m.entreprise_id = e.id),
         (select p.nom::text from entreprise_membres m join profils p on p.id = m.user_id
           where m.entreprise_id = e.id and m.role_entreprise = 'responsable' limit 1),
         (select p.email::text from entreprise_membres m join profils p on p.id = m.user_id
           where m.entreprise_id = e.id and m.role_entreprise = 'responsable' limit 1),
         coalesce((select array_agg(f.fournisseur order by f.fournisseur)
                     from entreprise_fournisseurs f where f.entreprise_id = e.id), '{}')
  from entreprises e
  order by e.created_at desc;
end;
$$;

create or replace function admin_modifier_entreprise(
  p_id uuid,
  p_statut text,
  p_mode_paiement text,
  p_plafond numeric,
  p_fournisseurs text[]
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

  update entreprises
     set statut = p_statut,
         mode_paiement = p_mode_paiement,
         plafond_mensuel = p_plafond
   where id = p_id;
  if not found then
    raise exception 'Entreprise introuvable';
  end if;

  delete from entreprise_fournisseurs where entreprise_id = p_id;
  insert into entreprise_fournisseurs (entreprise_id, fournisseur)
  select p_id, trim(f)
  from unnest(coalesce(p_fournisseurs, '{}')) as f
  where trim(f) <> ''
  on conflict do nothing;
end;
$$;

-- 6. Droits d'appel -----------------------------------------------------

revoke all on function initialiser_compte_entreprise() from public, anon;
revoke all on function equipe_entreprise() from public, anon;
revoke all on function changer_acces_employe(uuid, boolean) from public, anon;
revoke all on function regenerer_invitation() from public, anon;
revoke all on function commandes_equipe() from public, anon;
revoke all on function statuts_equipe() from public, anon;
revoke all on function admin_entreprises() from public, anon;
revoke all on function admin_modifier_entreprise(uuid, text, text, numeric, text[]) from public, anon;
revoke all on function entreprise_du_responsable() from public, anon;

grant execute on function initialiser_compte_entreprise() to authenticated;
grant execute on function equipe_entreprise() to authenticated;
grant execute on function changer_acces_employe(uuid, boolean) to authenticated;
grant execute on function regenerer_invitation() to authenticated;
grant execute on function commandes_equipe() to authenticated;
grant execute on function statuts_equipe() to authenticated;
grant execute on function admin_entreprises() to authenticated;
grant execute on function admin_modifier_entreprise(uuid, text, text, numeric, text[]) to authenticated;
grant execute on function entreprise_du_responsable() to authenticated;
grant execute on function est_admin() to authenticated;
-- La page d'inscription (sans compte) doit pouvoir lire le nom de l'entreprise invitante.
grant execute on function nom_entreprise_invitation(text) to anon, authenticated;

-- 7. Comptes entreprise déjà existants ----------------------------------
-- Chaque compte entreprise actuel devient responsable de sa propre entreprise
-- (nom repris du profil), sans rien changer à ses commandes.

do $$
declare
  r record;
  v_ent uuid;
begin
  for r in
    select p.id, p.nom
    from profils p
    where p.role = 'entreprise'
      and not exists (select 1 from entreprise_membres m where m.user_id = p.id)
  loop
    insert into entreprises (nom)
    values (coalesce(nullif(trim(coalesce(r.nom, '')), ''), 'Entreprise'))
    returning id into v_ent;
    insert into entreprise_membres (user_id, entreprise_id, role_entreprise)
    values (r.id, v_ent, 'responsable');
  end loop;
end;
$$;
