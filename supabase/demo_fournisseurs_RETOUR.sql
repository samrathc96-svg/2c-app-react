-- =====================================================================
-- Retour en arrière : retire les fournisseurs et produits de démonstration
-- À exécuter dans Supabase > SQL Editor.
-- =====================================================================
delete from produits
 where reference like 'DEMO-%'
   and fournisseur in (select nom from fournisseurs_demo);

drop table if exists fournisseurs_demo;
