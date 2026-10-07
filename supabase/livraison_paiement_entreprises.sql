-- =====================================================================
-- Étape 3 : paiement de la LIVRAISON par les entreprises
-- À exécuter UNE FOIS dans Supabase > SQL Editor (relançable sans danger).
-- Supabase peut afficher "Potential issues detected" (RLS) : cliquez
-- "Run and enable RLS", le résultat est le même.
--
-- Principe :
--  * Une entreprise ne paie sur le site QUE la livraison (le fournisseur
--    facture ses produits à part). Le total de la commande reste la valeur
--    des produits (pour le bon de commande), les frais sont à part.
--  * 3 modes, choisis par entreprise dans l'admin :
--      carte    : carte RÉSERVÉE à la commande, DÉBITÉE à la livraison ;
--      prepaye  : les frais sont retirés d'un solde rechargé à l'avance ;
--      mensuel  : aucun paiement à la commande, facture mensuelle,
--                 dans la limite d'un plafond (entreprise "validée").
--  * Tarif de livraison réglable dans l'admin : forfait + (km au-delà de
--    km_inclus) x prix_km. prix_km = 0 => prix fixe.
-- =====================================================================

-- 1. Tarif de livraison -------------------------------------------------

create table if not exists tarif_livraison (
  id int primary key default 1 check (id = 1),
  forfait numeric not null default 10 check (forfait >= 0.5),
  km_inclus numeric not null default 5 check (km_inclus >= 0),
  prix_km numeric not null default 0 check (prix_km >= 0),
  maj timestamptz not null default now()
);
insert into tarif_livraison (id) values (1) on conflict do nothing;

alter table tarif_livraison enable row level security;
drop policy if exists "tarif_lecture" on tarif_livraison;
create policy "tarif_lecture" on tarif_livraison for select to anon, authenticated using (true);

create or replace function admin_modifier_tarif(p_forfait numeric, p_km_inclus numeric, p_prix_km numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not est_admin() then
    raise exception 'Accès refusé';
  end if;
  if p_forfait is null or p_forfait < 0.5 then
    raise exception 'Le forfait doit être d''au moins 0.50 CHF';
  end if;
  update tarif_livraison
     set forfait = p_forfait,
         km_inclus = greatest(coalesce(p_km_inclus, 0), 0),
         prix_km = greatest(coalesce(p_prix_km, 0), 0),
         maj = now()
   where id = 1;
end;
$$;

-- 2. Colonnes de suivi ----------------------------------------------------

alter table commandes add column if not exists frais_livraison numeric not null default 0;
-- en_ligne (particulier) | carte_entreprise | prepaye | mensuel
alter table commandes add column if not exists mode_paiement text;
-- paye | autorise | capture | echec_capture | solde | mensuel | libere | rembourse
alter table commandes add column if not exists paiement_statut text;
alter table commandes add column if not exists distance_km numeric;
alter table commandes add column if not exists facturee boolean not null default false;

alter table entreprises add column if not exists solde_prepaye numeric not null default 0;

create table if not exists mouvements_prepaye (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entreprise_id uuid not null references entreprises (id) on delete cascade,
  montant numeric not null,
  type text not null check (type in ('recharge', 'debit_commande', 'remboursement', 'ajustement')),
  commande_id text,
  stripe_session_id text unique,
  note text
);
create index if not exists mouvements_prepaye_ent_idx on mouvements_prepaye (entreprise_id, created_at desc);

alter table mouvements_prepaye enable row level security;
drop policy if exists "mouvements_lecture" on mouvements_prepaye;
create policy "mouvements_lecture" on mouvements_prepaye for select to authenticated
  using (est_admin() or entreprise_id = entreprise_du_responsable());

-- 3. Encours mensuel d'une entreprise ------------------------------------
-- Frais de livraison des commandes "mensuel" pas encore facturées et pas annulées.

create or replace function encours_mensuel(p_entreprise uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(c.frais_livraison), 0)
  from commandes c
  join entreprise_membres m on m.user_id = c.user_id
  where m.entreprise_id = p_entreprise
    and c.mode_paiement = 'mensuel'
    and c.facturee = false
    and not exists (
      select 1 from courses co
      where co.commande_id::text = c.id::text and co.statut = 'Annulée'
    );
$$;

-- 4. Ce que voit le site (mode de paiement, solde, tarif) ---------------

create or replace function infos_paiement_entreprise()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_m entreprise_membres%rowtype;
  v_e entreprises%rowtype;
  v_t tarif_livraison%rowtype;
begin
  select * into v_t from tarif_livraison where id = 1;
  select * into v_m from entreprise_membres where user_id = auth.uid();
  if not found then
    return jsonb_build_object('statut', 'non_membre',
      'forfait', v_t.forfait, 'km_inclus', v_t.km_inclus, 'prix_km', v_t.prix_km);
  end if;
  select * into v_e from entreprises where id = v_m.entreprise_id;
  return jsonb_build_object(
    'statut', 'ok',
    'mode_paiement', v_e.mode_paiement,
    'entreprise_statut', v_e.statut,
    'forfait', v_t.forfait, 'km_inclus', v_t.km_inclus, 'prix_km', v_t.prix_km,
    'solde_prepaye', case when v_m.role_entreprise = 'responsable' then v_e.solde_prepaye end,
    'plafond_mensuel', case when v_m.role_entreprise = 'responsable' then v_e.plafond_mensuel end,
    'encours_mensuel', case when v_m.role_entreprise = 'responsable' then encours_mensuel(v_e.id) end
  );
end;
$$;

-- 5. Commande entreprise SANS passage par Stripe (prépayé / mensuel) -----
-- Appelée uniquement par la fonction serveur "creer-paiement".

create or replace function creer_commande_entreprise(
  p_user_id uuid,
  p_produits text,
  p_detail jsonb,
  p_total numeric,
  p_nom text,
  p_adresse text,
  p_telephone text,
  p_email text,
  p_technicien text,
  p_chantier text,
  p_frais numeric,
  p_distance numeric
)
returns setof commandes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m entreprise_membres%rowtype;
  v_e entreprises%rowtype;
  v_commande commandes;
begin
  select * into v_m from entreprise_membres where user_id = p_user_id;
  if not found or not v_m.actif then
    raise exception 'Accès entreprise désactivé';
  end if;

  -- verrou : deux commandes simultanées ne peuvent pas dépasser solde / plafond
  select * into v_e from entreprises where id = v_m.entreprise_id for update;
  if v_e.statut = 'suspendue' then
    raise exception 'Entreprise suspendue';
  end if;

  if v_e.mode_paiement = 'prepaye' then
    if v_e.solde_prepaye < p_frais then
      raise exception 'Solde prépayé insuffisant';
    end if;
  elsif v_e.mode_paiement = 'mensuel' then
    if v_e.statut <> 'validee' then
      raise exception 'Facturation mensuelle non activée';
    end if;
    if v_e.plafond_mensuel is null or v_e.plafond_mensuel <= 0 then
      raise exception 'Plafond mensuel non défini';
    end if;
    if encours_mensuel(v_e.id) + p_frais > v_e.plafond_mensuel then
      raise exception 'Plafond mensuel atteint';
    end if;
  else
    raise exception 'Mode de paiement incompatible';
  end if;

  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );

  select * into v_commande
  from creer_commande(
    p_produits, p_detail, p_total, p_nom, p_adresse, p_telephone, p_email,
    p_user_id, p_technicien, p_chantier
  );

  update commandes
     set frais_livraison = p_frais,
         distance_km = p_distance,
         mode_paiement = v_e.mode_paiement,
         paiement_statut = case when v_e.mode_paiement = 'prepaye' then 'solde' else 'mensuel' end
   where id = v_commande.id;

  if v_e.mode_paiement = 'prepaye' then
    update entreprises set solde_prepaye = solde_prepaye - p_frais where id = v_e.id;
    insert into mouvements_prepaye (entreprise_id, montant, type, commande_id)
    values (v_e.id, -p_frais, 'debit_commande', v_commande.id::text);
  end if;

  return query select * from commandes where id = v_commande.id;
end;
$$;

-- 6. Création de la commande après paiement Stripe ------------------------
-- (remplace la version précédente : gère aussi la carte RÉSERVÉE des entreprises)

create or replace function finaliser_paiement(p_session_id text, p_payment_intent text)
returns setof commandes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_att paiements_en_attente;
  v_commande commandes;
  v_p jsonb;
  v_entreprise boolean;
begin
  select * into v_att
  from paiements_en_attente
  where stripe_session_id = p_session_id
  for update;

  if not found then
    raise exception 'Paiement inconnu';
  end if;

  if v_att.statut = 'paye' then
    return query select * from commandes where id::text = v_att.commande_id;
    return;
  end if;

  v_p := v_att.payload;
  v_entreprise := coalesce(v_p->>'mode_paiement', '') = 'carte_entreprise';

  if v_att.user_id is not null then
    perform set_config('request.jwt.claim.sub', v_att.user_id::text, true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_att.user_id::text, 'role', 'authenticated')::text,
      true
    );
  end if;

  select * into v_commande
  from creer_commande(
    v_p->>'produits',
    v_p->'produits_detail',
    coalesce(nullif(v_p->>'total_produits', '')::numeric, v_att.total),
    v_p->>'nom_client',
    v_p->>'adresse',
    v_p->>'telephone',
    v_p->>'email',
    v_att.user_id,
    v_p->>'technicien',
    v_p->>'chantier'
  );

  if v_entreprise then
    -- Carte réservée : l'argent n'est PAS encore encaissé (débit à la livraison)
    update commandes
       set paye = false,
           frais_livraison = (v_p->>'frais')::numeric,
           distance_km = nullif(v_p->>'distance_km', '')::numeric,
           mode_paiement = 'carte_entreprise',
           paiement_statut = 'autorise',
           stripe_payment_intent = p_payment_intent
     where id = v_commande.id;
  else
    update commandes
       set paye = true, paye_le = now(), stripe_payment_intent = p_payment_intent,
           mode_paiement = 'en_ligne', paiement_statut = 'paye'
     where id = v_commande.id;
  end if;

  update paiements_en_attente
  set statut = 'paye', commande_id = v_commande.id::text
  where id = v_att.id;

  return query select * from commandes where id = v_commande.id;
end;
$$;

revoke all on function finaliser_paiement(text, text) from public, anon, authenticated;
grant execute on function finaliser_paiement(text, text) to service_role;

-- 7. Annulation : libère la carte / recrédite le solde / retire du mensuel --
-- Appelée uniquement par les fonctions serveur. Retourne ce qui a été fait.

create or replace function liberer_paiement_commande(p_commande_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c commandes;
  v_ent uuid;
begin
  select * into v_c from commandes where id::text = p_commande_id for update;
  if not found then return 'introuvable'; end if;

  if not exists (
    select 1 from courses where commande_id::text = p_commande_id and statut = 'Annulée'
  ) then
    return 'non_annulee';
  end if;

  if v_c.mode_paiement = 'prepaye' and v_c.paiement_statut = 'solde' then
    select m.entreprise_id into v_ent from entreprise_membres m where m.user_id = v_c.user_id;
    if v_ent is not null then
      update entreprises set solde_prepaye = solde_prepaye + v_c.frais_livraison where id = v_ent;
      insert into mouvements_prepaye (entreprise_id, montant, type, commande_id)
      values (v_ent, v_c.frais_livraison, 'remboursement', p_commande_id);
    end if;
    update commandes set paiement_statut = 'rembourse' where id = v_c.id;
    return 'prepaye_credite';
  end if;

  if v_c.mode_paiement = 'mensuel' and v_c.paiement_statut = 'mensuel' then
    update commandes set paiement_statut = 'libere' where id = v_c.id;
    return 'mensuel_annule';
  end if;

  if v_c.mode_paiement = 'carte_entreprise' and v_c.paiement_statut = 'autorise' then
    return 'carte_a_liberer';
  end if;

  return 'rien';
end;
$$;

revoke all on function liberer_paiement_commande(text) from public, anon, authenticated;
grant execute on function liberer_paiement_commande(text) to service_role;

-- 8. Administration ----------------------------------------------------------

create or replace function admin_crediter_prepaye(p_entreprise uuid, p_montant numeric, p_note text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_solde numeric;
begin
  if not est_admin() then
    raise exception 'Accès refusé';
  end if;
  if p_montant is null or p_montant = 0 then
    raise exception 'Montant invalide';
  end if;
  update entreprises set solde_prepaye = solde_prepaye + p_montant
   where id = p_entreprise
   returning solde_prepaye into v_solde;
  if not found then
    raise exception 'Entreprise introuvable';
  end if;
  insert into mouvements_prepaye (entreprise_id, montant, type, note)
  values (p_entreprise, p_montant, case when p_montant > 0 then 'recharge' else 'ajustement' end,
          nullif(trim(coalesce(p_note, '')), ''));
  return v_solde;
end;
$$;

create or replace function admin_soldes_entreprises()
returns table (entreprise_id uuid, solde_prepaye numeric, encours_mensuel numeric)
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
  select e.id, e.solde_prepaye, encours_mensuel(e.id) from entreprises e;
end;
$$;

-- 9. Infos pour la facture de livraison (en plus de obtenir_commande_facture) ----

create or replace function obtenir_frais_commande(p_commande_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c commandes;
  v_nom text;
begin
  select * into v_c from commandes where id::text = p_commande_id;
  if not found then return null; end if;

  if not (
    est_admin()
    or v_c.user_id = auth.uid()
    or exists (select 1 from profils where id = auth.uid() and role = 'livreur')
  ) then
    raise exception 'Accès refusé';
  end if;

  select e.nom into v_nom
  from entreprise_membres m join entreprises e on e.id = m.entreprise_id
  where m.user_id = v_c.user_id;

  return jsonb_build_object(
    'frais_livraison', v_c.frais_livraison,
    'mode_paiement', v_c.mode_paiement,
    'paiement_statut', v_c.paiement_statut,
    'distance_km', v_c.distance_km,
    'chantier', v_c.chantier,
    'technicien', v_c.technicien,
    'entreprise_nom', v_nom
  );
end;
$$;

-- 10. Droits d'appel --------------------------------------------------------

revoke all on function encours_mensuel(uuid) from public, anon, authenticated;
revoke all on function creer_commande_entreprise(uuid, text, jsonb, numeric, text, text, text, text, text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function creer_commande_entreprise(uuid, text, jsonb, numeric, text, text, text, text, text, text, numeric, numeric) to service_role;
grant execute on function encours_mensuel(uuid) to service_role;

revoke all on function infos_paiement_entreprise() from public, anon;
revoke all on function admin_modifier_tarif(numeric, numeric, numeric) from public, anon;
revoke all on function admin_crediter_prepaye(uuid, numeric, text) from public, anon;
revoke all on function admin_soldes_entreprises() from public, anon;
revoke all on function obtenir_frais_commande(text) from public, anon;
grant execute on function infos_paiement_entreprise() to authenticated;
grant execute on function admin_modifier_tarif(numeric, numeric, numeric) to authenticated;
grant execute on function admin_crediter_prepaye(uuid, numeric, text) to authenticated;
grant execute on function admin_soldes_entreprises() to authenticated;
grant execute on function obtenir_frais_commande(text) to authenticated;
