-- =========================================================
-- Notifications push : retirer un appareil à la déconnexion
-- À exécuter UNE FOIS dans Supabase > SQL Editor (relançable sans danger).
-- Prérequis : notifications_push.sql déjà exécuté.
-- =========================================================
-- Problème corrigé : un téléphone restait abonné au compte de la personne
-- même après la déconnexion, donc il continuait à recevoir ses alertes.
-- Le site retire maintenant l'appareil au moment de se déconnecter. Cette
-- fonction sert de filet de sécurité quand la session est déjà fermée : elle
-- supprime l'abonnement à partir de son adresse (une longue adresse secrète,
-- connue du seul appareil), sans exiger d'être connecté.
-- Retour en arrière : notifications_push_deconnexion_RETOUR.sql.
-- =========================================================

create or replace function push_oublier_appareil(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from push_abonnements where endpoint = p_endpoint;
$$;

revoke all on function push_oublier_appareil(text) from public;
grant execute on function push_oublier_appareil(text) to anon, authenticated;
