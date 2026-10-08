-- =====================================================================
-- Sécurité des commandes et des courses — à exécuter UNE FOIS
-- (Supabase > SQL Editor > New query > coller tout > Run)
--
-- Problèmes corrigés (constatés le 08/10/2026 sur la base en ligne) :
--  * n'importe quel visiteur pouvait LIRE toutes les commandes passées sans
--    compte (nom, adresse, téléphone, email) et toutes les courses ;
--  * n'importe quel visiteur pouvait MODIFIER le statut de n'importe quelle
--    course (par exemple annuler la livraison de quelqu'un d'autre) ;
--  * n'importe quel visiteur pouvait CRÉER de fausses commandes et courses,
--    sans payer, par l'accès direct aux tables ou par la fonction
--    creer_commande ;
--  * le rôle "anon" avait des droits inutiles (DELETE, TRUNCATE…).
--
-- Ce qui continue de fonctionner (inchangé) : paiement Stripe (la commande est
-- créée par le serveur), suivi et annulation des commandes invités (fonctions
-- rechercher_commande et annuler_commande_invite), code de livraison, espace
-- livreur / admin, « Mes commandes » d'un client connecté.
--
-- En cas de souci : supabase/securite_commandes_courses_RETOUR.sql remet
-- exactement l'état d'avant.
-- =====================================================================

-- 1. Règles d'accès trop ouvertes
drop policy if exists "Insertion publique des commandes" on commandes;
drop policy if exists "Lecture des commandes anonymes" on commandes;
drop policy if exists "Insertion publique des courses" on courses;
drop policy if exists "Lecture publique des courses" on courses;
drop policy if exists "Mise a jour publique du statut" on courses;

-- 2. Droits sur les tables : un visiteur n'a plus aucun accès direct ;
--    un compte connecté peut lire (ses données, via les règles qui restent)
--    et, pour les courses, modifier (livreur, admin, annulation par le client).
revoke all on table commandes from anon;
revoke all on table courses from anon;
revoke insert, update, delete, truncate, references, trigger on table commandes from authenticated;
revoke insert, delete, truncate, references, trigger on table courses from authenticated;

-- 3. La création d'une commande ne passe plus que par le serveur
--    (paiement Stripe validé -> finaliser_paiement), jamais par un visiteur.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'creer_commande'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.signature);
  end loop;
end $$;

notify pgrst, 'reload schema';
