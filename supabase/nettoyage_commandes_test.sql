-- =========================================================
-- Nettoyage des commandes de test — Supabase > SQL Editor
-- =========================================================
-- À faire en DEUX temps. Ne supprime JAMAIS : produits, fournisseurs,
-- comptes (clients, livreurs, admin), avis donnés ne concernant pas
-- les commandes supprimées. Supprime : commandes, courses (livreurs),
-- codes de livraison, factures enregistrées, avis liés, paiements
-- Stripe en attente.
-- =========================================================


-- ---------------------------------------------------------
-- ÉTAPE 1 : VOIR ce qui va être supprimé (lecture seule)
-- Collez et lancez ce bloc seul.
-- ---------------------------------------------------------
select 'commandes' as table_, count(*) as lignes, min(created_at) as plus_ancienne, max(created_at) as plus_recente from commandes
union all select 'courses', count(*), min(created_at), max(created_at) from courses
union all select 'paiements_en_attente', count(*), min(created_at), max(created_at) from paiements_en_attente
union all select 'factures', count(*), min(created_at), max(created_at) from factures
union all select 'avis', count(*), null, null from avis;


-- ---------------------------------------------------------
-- ÉTAPE 2 : SUPPRIMER (irréversible)
-- Lancez ce bloc seul, après avoir regardé l'étape 1.
-- Tout ce qui a été créé AVANT la date limite est supprimé.
--   * Tout supprimer : laissez  now()
--   * Garder les commandes d'aujourd'hui, par exemple :
--       select timestamptz '2026-10-07 00:00:00+02' as t
-- Tout est fait dans une seule transaction : si une erreur survient,
-- rien n'est supprimé.
-- ---------------------------------------------------------
begin;

create temp table _limite on commit drop as
select now() as t;

create temp table _commandes_a_supprimer on commit drop as
select id::text as commande_id
from commandes
where created_at < (select t from _limite);

create temp table _courses_a_supprimer on commit drop as
select id::text as course_id
from courses
where created_at < (select t from _limite)
   or commande_id::text in (select commande_id from _commandes_a_supprimer);

delete from avis where course_id::text in (select course_id from _courses_a_supprimer);
delete from codes_livraison where course_id in (select course_id from _courses_a_supprimer);
delete from factures
  where commande_id::text in (select commande_id from _commandes_a_supprimer)
     or created_at < (select t from _limite);
delete from courses where id::text in (select course_id from _courses_a_supprimer);
delete from paiements_en_attente where created_at < (select t from _limite);
delete from commandes where id::text in (select commande_id from _commandes_a_supprimer);

commit;

-- Vérification : relancez l'étape 1, les lignes doivent être à 0
-- (ou ne montrer que ce que vous avez gardé).

-- Notes :
--  * Le stock des produits n'est pas remis à jour par cette suppression :
--    vérifiez les quantités dans « Gérer le catalogue ».
--  * Les PDF de factures déjà enregistrés restent dans le stockage
--    (Storage > factures) : vous pouvez les vider à la main si besoin.
--  * Les paiements de test restent visibles dans Stripe (mode test) ;
--    Stripe permet de les effacer : Développeurs > « Supprimer toutes les
--    données de test ».
