-- =====================================================================
-- Logo du fournisseur
-- À exécuter UNE FOIS dans Supabase > SQL Editor (relançable sans danger).
-- Prérequis : espace_fournisseur.sql déjà exécuté.
-- =====================================================================
-- Principe :
--  * chaque fournisseur (compte validé) envoie son propre logo depuis son
--    espace ; l'image est rangée dans le stockage « produits », dossier
--    fournisseurs/<son identifiant>/ (règle déjà en place) ;
--  * seules les adresses de ce dossier sont acceptées (pas de lien vers un
--    autre site) ;
--  * le catalogue public lit les logos des fournisseurs validés ;
--  * l'admin peut retirer un logo depuis « Comptes fournisseurs ».
-- Retour en arrière : logo_fournisseur_RETOUR.sql.
-- =====================================================================

alter table fournisseur_comptes add column if not exists logo_url text;

-- Logos visibles de tous (uniquement : nom + logo des fournisseurs validés)
create or replace view fournisseur_logos_publics
with (security_invoker = false) as
  select c.nom_fournisseur, c.logo_url
  from fournisseur_comptes c
  where c.statut = 'valide' and c.logo_url is not null;

revoke all on fournisseur_logos_publics from public;
grant select on fournisseur_logos_publics to anon, authenticated;

-- Le fournisseur enregistre (ou retire, avec une valeur nulle) son logo
create or replace function fournisseur_enregistrer_logo(p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c fournisseur_comptes := _fournisseur_valide();
  v_url text := nullif(trim(coalesce(p_url, '')), '');
begin
  if v_url is not null then
    if length(v_url) > 500
       or v_url !~ '^https://[^[:space:]<>"'']+$'
       or position('/storage/v1/object/public/produits/fournisseurs/' || v_c.user_id::text || '/' in v_url) = 0 then
      raise exception 'Logo invalide : envoie une image depuis ton espace fournisseur';
    end if;
  end if;
  update fournisseur_comptes set logo_url = v_url where user_id = v_c.user_id;
end;
$$;

-- Admin : logos de tous les comptes (même en attente ou suspendus)
create or replace function admin_logos_fournisseurs()
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
  return coalesce(
    (select jsonb_object_agg(user_id::text, logo_url) from fournisseur_comptes where logo_url is not null),
    '{}'::jsonb
  );
end;
$$;

-- Admin : retirer le logo d'un fournisseur
create or replace function admin_retirer_logo(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not est_admin() then
    raise exception 'Accès refusé';
  end if;
  update fournisseur_comptes set logo_url = null where user_id = p_user;
  if not found then
    raise exception 'Compte introuvable';
  end if;
end;
$$;

revoke all on function fournisseur_enregistrer_logo(text) from public, anon;
revoke all on function admin_logos_fournisseurs() from public, anon;
revoke all on function admin_retirer_logo(uuid) from public, anon;
grant execute on function fournisseur_enregistrer_logo(text) to authenticated;
grant execute on function admin_logos_fournisseurs() to authenticated;
grant execute on function admin_retirer_logo(uuid) to authenticated;

notify pgrst, 'reload schema';
