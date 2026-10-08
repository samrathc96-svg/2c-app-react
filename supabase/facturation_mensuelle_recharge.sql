-- =====================================================================
-- Étape 3 (suite) : facture mensuelle + recharge du solde prépayé
-- À exécuter UNE FOIS dans Supabase > SQL Editor, APRÈS
-- livraison_paiement_entreprises.sql (relançable sans danger).
--
--  * Facture mensuelle : l'admin choisit une entreprise en mode "mensuel"
--    et un mois ; les livraisons effectuées et pas encore facturées sont
--    regroupées dans UNE facture envoyée au responsable.
--  * Recharge : le responsable d'une entreprise en mode "prépayé" recharge
--    son solde par carte (Stripe). Le webhook crédite le solde.
--  * Délai de paiement des factures mensuelles : réglable (10 jours au départ).
-- =====================================================================

-- 1. Colonnes et séquence ---------------------------------------------------

alter table commandes add column if not exists facture_mensuelle_id uuid;
alter table tarif_livraison add column if not exists delai_paiement_jours int not null default 10
  check (delai_paiement_jours >= 0);
create sequence if not exists facture_mensuelle_seq;

create or replace function admin_modifier_delai_paiement(p_jours int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not est_admin() then
    raise exception 'Accès refusé';
  end if;
  if p_jours is null or p_jours < 0 or p_jours > 120 then
    raise exception 'Délai invalide';
  end if;
  update tarif_livraison set delai_paiement_jours = p_jours, maj = now() where id = 1;
end;
$$;

-- 2. Recharge du solde (appelée par le webhook Stripe uniquement) ----------------

create or replace function crediter_prepaye_stripe(p_session_id text, p_entreprise uuid, p_montant numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_montant is null or p_montant <= 0 then
    raise exception 'Montant invalide';
  end if;

  -- Une même session Stripe ne crédite qu'une seule fois (rejeu possible).
  insert into mouvements_prepaye (entreprise_id, montant, type, stripe_session_id, note)
  values (p_entreprise, p_montant, 'recharge', p_session_id, 'Recharge par carte')
  on conflict (stripe_session_id) do nothing;

  if not found then
    return false;
  end if;

  update entreprises set solde_prepaye = solde_prepaye + p_montant where id = p_entreprise;
  return true;
end;
$$;

revoke all on function crediter_prepaye_stripe(text, uuid, numeric) from public, anon, authenticated;
grant execute on function crediter_prepaye_stripe(text, uuid, numeric) to service_role;

-- 3. Livraisons à facturer (usage interne) ------------------------------------
-- Livraisons EFFECTUÉES, mode mensuel, pas encore facturées, dans [p_debut, p_fin[.

create or replace function _commandes_a_facturer(p_entreprise uuid, p_debut date, p_fin date)
returns table (
  commande_id text,
  date_commande timestamptz,
  numero_suivi text,
  chantier text,
  technicien text,
  frais numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id::text, c.created_at, c.numero_suivi::text, c.chantier::text, c.technicien::text, c.frais_livraison
  from commandes c
  join entreprise_membres m on m.user_id = c.user_id
  where m.entreprise_id = p_entreprise
    and c.mode_paiement = 'mensuel'
    and c.facturee = false
    and (c.created_at at time zone 'Europe/Zurich')::date >= p_debut
    and (c.created_at at time zone 'Europe/Zurich')::date < p_fin
    and exists (
      select 1 from courses co where co.commande_id::text = c.id::text and co.statut = 'Livrée'
    )
  order by c.created_at;
$$;

revoke all on function _commandes_a_facturer(uuid, date, date) from public, anon, authenticated;

-- 4. Données d'une facture mensuelle (pour fabriquer le PDF) ----------------------

create or replace function _donnees_facture_mensuelle(p_facture_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_f factures;
  v_nom_resp text;
  v_email_resp text;
  v_nom_ent text;
  v_delai int;
  v_lignes jsonb;
begin
  select * into v_f from factures where id = p_facture_id;
  if not found then
    return null;
  end if;

  select p.nom::text, p.email::text into v_nom_resp, v_email_resp from profils p where p.id = v_f.user_id;
  select e.nom into v_nom_ent
  from entreprise_membres m join entreprises e on e.id = m.entreprise_id
  where m.user_id = v_f.user_id;
  select delai_paiement_jours into v_delai from tarif_livraison where id = 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'date', c.created_at,
           'numero_suivi', c.numero_suivi,
           'chantier', c.chantier,
           'technicien', c.technicien,
           'frais', c.frais_livraison
         ) order by c.created_at), '[]'::jsonb)
    into v_lignes
  from commandes c
  where c.facture_mensuelle_id = v_f.id;

  return jsonb_build_object(
    'facture_id', v_f.id,
    'numero', v_f.numero_facture,
    'montant_total', v_f.montant_total,
    'periode_debut', v_f.periode_debut,
    'periode_fin', v_f.periode_fin,
    'emise_le', v_f.created_at,
    'echeance', (v_f.created_at at time zone 'Europe/Zurich')::date + coalesce(v_delai, 10),
    'delai_jours', coalesce(v_delai, 10),
    'responsable_id', v_f.user_id,
    'responsable_nom', v_nom_resp,
    'responsable_email', v_email_resp,
    'entreprise_nom', v_nom_ent,
    'chemin_pdf', v_f.chemin_pdf,
    'lignes', v_lignes
  );
end;
$$;

revoke all on function _donnees_facture_mensuelle(uuid) from public, anon, authenticated;

-- 5. Fonctions admin ---------------------------------------------------------

create or replace function admin_apercu_facture_mensuelle(p_entreprise uuid, p_debut date, p_fin date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_nb int;
  v_total numeric;
begin
  if not est_admin() then
    raise exception 'Accès refusé';
  end if;
  select count(*), coalesce(sum(frais), 0) into v_nb, v_total
  from _commandes_a_facturer(p_entreprise, p_debut, p_fin);
  return jsonb_build_object('nb', v_nb, 'total', v_total);
end;
$$;

create or replace function admin_creer_facture_mensuelle(p_entreprise uuid, p_debut date, p_fin date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resp uuid;
  v_nb int;
  v_total numeric;
  v_numero text;
  v_fid uuid;
begin
  if not est_admin() then
    raise exception 'Accès refusé';
  end if;
  if p_fin <= p_debut then
    raise exception 'Période invalide';
  end if;

  -- verrou : deux clics simultanés ne facturent pas deux fois les mêmes livraisons
  perform 1 from entreprises where id = p_entreprise for update;
  if not found then
    raise exception 'Entreprise introuvable';
  end if;

  select m.user_id into v_resp
  from entreprise_membres m
  where m.entreprise_id = p_entreprise and m.role_entreprise = 'responsable' and m.actif
  limit 1;
  if v_resp is null then
    raise exception 'Aucun responsable actif';
  end if;

  select count(*), coalesce(sum(frais), 0) into v_nb, v_total
  from _commandes_a_facturer(p_entreprise, p_debut, p_fin);
  if v_nb = 0 then
    raise exception 'Aucune livraison à facturer sur cette période';
  end if;

  v_numero := 'M' || to_char(p_debut, 'YYMM') || '-' || lpad(nextval('facture_mensuelle_seq')::text, 3, '0');

  insert into factures (numero_facture, user_id, commande_id, periode_debut, periode_fin, montant_total, chemin_pdf)
  values (v_numero, v_resp, null, p_debut, p_fin - 1, v_total, v_resp::text || '/' || v_numero || '.pdf')
  returning id into v_fid;

  update commandes
     set facturee = true, facture_mensuelle_id = v_fid
   where id::text in (select commande_id from _commandes_a_facturer(p_entreprise, p_debut, p_fin));

  return _donnees_facture_mensuelle(v_fid);
end;
$$;

create or replace function admin_donnees_facture_mensuelle(p_facture_id uuid)
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
  return _donnees_facture_mensuelle(p_facture_id);
end;
$$;

-- Factures mensuelles déjà émises pour une entreprise (pour renvoyer / régénérer un PDF)
create or replace function admin_factures_mensuelles(p_entreprise uuid)
returns table (facture_id uuid, numero text, periode_debut text, montant numeric, emise_le timestamptz)
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
  select f.id, f.numero_facture::text, f.periode_debut::text, f.montant_total, f.created_at
  from factures f
  where f.numero_facture like 'M%'
    and f.user_id in (select m.user_id from entreprise_membres m where m.entreprise_id = p_entreprise)
    and exists (select 1 from commandes c where c.facture_mensuelle_id = f.id)
  order by f.created_at desc;
end;
$$;

-- 6. Stockage : l'admin dépose le PDF dans le dossier du responsable ---------------

drop policy if exists "factures_admin_insert" on storage.objects;
create policy "factures_admin_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'factures' and public.est_admin());

drop policy if exists "factures_admin_update" on storage.objects;
create policy "factures_admin_update" on storage.objects for update to authenticated
  using (bucket_id = 'factures' and public.est_admin())
  with check (bucket_id = 'factures' and public.est_admin());

drop policy if exists "factures_admin_select" on storage.objects;
create policy "factures_admin_select" on storage.objects for select to authenticated
  using (bucket_id = 'factures' and public.est_admin());

-- 7. Droits d'appel -------------------------------------------------------------

revoke all on function admin_modifier_delai_paiement(int) from public, anon;
revoke all on function admin_apercu_facture_mensuelle(uuid, date, date) from public, anon;
revoke all on function admin_creer_facture_mensuelle(uuid, date, date) from public, anon;
revoke all on function admin_donnees_facture_mensuelle(uuid) from public, anon;
revoke all on function admin_factures_mensuelles(uuid) from public, anon;
grant execute on function admin_modifier_delai_paiement(int) to authenticated;
grant execute on function admin_apercu_facture_mensuelle(uuid, date, date) to authenticated;
grant execute on function admin_creer_facture_mensuelle(uuid, date, date) to authenticated;
grant execute on function admin_donnees_facture_mensuelle(uuid) to authenticated;
grant execute on function admin_factures_mensuelles(uuid) to authenticated;
