-- =====================================================================
-- Fournisseurs de démonstration (noms inventés)
-- À exécuter UNE FOIS dans Supabase > SQL Editor (relançable sans danger :
-- rien n'est créé en double).
-- =====================================================================
-- Objectif : montrer à des visiteurs / associés le déroulement du site avec
-- des fournisseurs et des produits fictifs, SANS qu'une commande puisse
-- partir : les produits de démonstration ont un stock à 0 (le serveur de
-- paiement refuse donc toute commande), et le site affiche « Démonstration »
-- à la place du bouton d'ajout au panier.
--
--  FrappeK1coup (fixation) · PTV (ventilation) · C2B (plomberie) · JCBD (électricité)
--
-- Pour tout retirer : demo_fournisseurs_RETOUR.sql.
-- =====================================================================

-- 1. Liste des fournisseurs de démonstration (lisible par tous) -------------
create table if not exists fournisseurs_demo (
  nom text primary key
);

alter table fournisseurs_demo enable row level security;

drop policy if exists "fournisseurs_demo_lecture" on fournisseurs_demo;
create policy "fournisseurs_demo_lecture" on fournisseurs_demo
  for select to anon, authenticated using (true);

grant select on fournisseurs_demo to anon, authenticated;

insert into fournisseurs_demo (nom) values
  ('FrappeK1coup'),
  ('PTV'),
  ('C2B'),
  ('JCBD')
on conflict (nom) do nothing;

-- 2. Produits fictifs (stock à 0 = commande impossible) ----------------------
insert into produits (metier, sous_section, nom, prix, quantite_stock, fournisseur, reference, statut_validation)
select v.metier, v.sous_section, v.nom, v.prix, 0, v.fournisseur, v.reference, 'publie'
from (values
  ('Fixation & Quincaillerie', 'Chevilles', 'Cheville nylon Ø8 x 40, boîte de 100', 12.90, 'FrappeK1coup', 'DEMO-FK-01'),
  ('Fixation & Quincaillerie', 'Chevilles', 'Cheville à expansion métal M10 x 80, lot de 20', 18.40, 'FrappeK1coup', 'DEMO-FK-02'),
  ('Fixation & Quincaillerie', 'Chevilles', 'Cheville chimique, cartouche 345 ml', 28.50, 'FrappeK1coup', 'DEMO-FK-03'),
  ('Fixation & Quincaillerie', 'Vis & Boulons', 'Vis à bois Torx 5 x 60, boîte de 200', 16.80, 'FrappeK1coup', 'DEMO-FK-04'),
  ('Fixation & Quincaillerie', 'Vis & Boulons', 'Vis autoforeuse 4,8 x 25, boîte de 500', 21.00, 'FrappeK1coup', 'DEMO-FK-05'),
  ('Fixation & Quincaillerie', 'Vis & Boulons', 'Boulon hexagonal inox A2 M8 x 60, lot de 50', 19.50, 'FrappeK1coup', 'DEMO-FK-06'),
  ('Fixation & Quincaillerie', 'Vis & Boulons', 'Tige filetée zinguée M10, 1 m', 6.40, 'FrappeK1coup', 'DEMO-FK-07'),
  ('Fixation & Quincaillerie', 'Fixations murales', 'Équerre de fixation 90 x 90 galva, lot de 10', 9.80, 'FrappeK1coup', 'DEMO-FK-08'),
  ('Fixation & Quincaillerie', 'Fixations murales', 'Collier de serrage inox Ø50-70, lot de 10', 14.20, 'FrappeK1coup', 'DEMO-FK-09'),
  ('Fixation & Quincaillerie', 'Fixations murales', 'Clou de fixation béton 4 x 40, boîte de 100', 11.30, 'FrappeK1coup', 'DEMO-FK-10'),
  ('Ventilation', 'Gaines & Raccords', 'Gaine PVC rigide Ø100, 1 m', 14.90, 'PTV', 'DEMO-PT-01'),
  ('Ventilation', 'Gaines & Raccords', 'Gaine souple isolée Ø125, 6 m', 39.50, 'PTV', 'DEMO-PT-02'),
  ('Ventilation', 'Gaines & Raccords', 'Coude 90° galva Ø125', 8.70, 'PTV', 'DEMO-PT-03'),
  ('Ventilation', 'Gaines & Raccords', 'Manchon de jonction Ø160', 6.30, 'PTV', 'DEMO-PT-04'),
  ('Ventilation', 'Bouches & Grilles', 'Bouche d''extraction VMC Ø125', 13.90, 'PTV', 'DEMO-PT-05'),
  ('Ventilation', 'Bouches & Grilles', 'Grille de ventilation aluminium 200 x 200', 16.40, 'PTV', 'DEMO-PT-06'),
  ('Ventilation', 'Bouches & Grilles', 'Grille extérieure anti-pluie Ø125', 18.60, 'PTV', 'DEMO-PT-07'),
  ('Ventilation', 'Extracteurs & VMC', 'Extracteur salle de bain Ø100 silencieux', 54.90, 'PTV', 'DEMO-PT-08'),
  ('Ventilation', 'Extracteurs & VMC', 'Ventilateur de conduit Ø125, 280 m³/h', 89.00, 'PTV', 'DEMO-PT-09'),
  ('Ventilation', 'Accessoires', 'Collier de serrage Ø125, lot de 10', 7.90, 'PTV', 'DEMO-PT-10'),
  ('Ventilation', 'Accessoires', 'Ruban aluminium adhésif, 50 m', 12.50, 'PTV', 'DEMO-PT-11'),
  ('Plomberie & Sanitaire', 'Tubes & Raccords', 'Tube multicouche Ø16, rouleau de 25 m', 58.00, 'C2B', 'DEMO-CB-01'),
  ('Plomberie & Sanitaire', 'Tubes & Raccords', 'Raccord laiton à sertir Ø16', 4.90, 'C2B', 'DEMO-CB-02'),
  ('Plomberie & Sanitaire', 'Tubes & Raccords', 'Coude cuivre à souder 90° Ø18', 2.40, 'C2B', 'DEMO-CB-03'),
  ('Plomberie & Sanitaire', 'Tubes & Raccords', 'Tube PVC évacuation Ø100, 2 m', 17.80, 'C2B', 'DEMO-CB-04'),
  ('Plomberie & Sanitaire', 'Robinetterie', 'Robinet d''arrêt à sphère 1/2"', 9.60, 'C2B', 'DEMO-CB-05'),
  ('Plomberie & Sanitaire', 'Robinetterie', 'Mitigeur de lavabo chromé', 74.50, 'C2B', 'DEMO-CB-06'),
  ('Plomberie & Sanitaire', 'Robinetterie', 'Flexible inox 1/2", 50 cm', 6.80, 'C2B', 'DEMO-CB-07'),
  ('Plomberie & Sanitaire', 'Étanchéité', 'Ruban PTFE pour filetage, lot de 10', 5.40, 'C2B', 'DEMO-CB-08'),
  ('Plomberie & Sanitaire', 'Étanchéité', 'Pâte à joint pour filetage, 100 g', 9.20, 'C2B', 'DEMO-CB-09'),
  ('Plomberie & Sanitaire', 'Étanchéité', 'Silicone sanitaire blanc, 300 ml', 8.90, 'C2B', 'DEMO-CB-10'),
  ('Plomberie & Sanitaire', 'Siphons & Évacuations', 'Siphon de lavabo chromé 1"1/4', 11.50, 'C2B', 'DEMO-CB-11'),
  ('Électricité', 'Câbles & Gaines', 'Câble 3G1.5 mm², couronne de 25 m', 34.90, 'JCBD', 'DEMO-JC-01'),
  ('Électricité', 'Câbles & Gaines', 'Câble 3G2.5 mm², couronne de 25 m', 52.50, 'JCBD', 'DEMO-JC-02'),
  ('Électricité', 'Câbles & Gaines', 'Gaine ICTA Ø20, couronne de 50 m', 21.00, 'JCBD', 'DEMO-JC-03'),
  ('Électricité', 'Appareillage', 'Prise T13 encastrable blanche', 7.40, 'JCBD', 'DEMO-JC-04'),
  ('Électricité', 'Appareillage', 'Interrupteur à bascule encastrable blanc', 6.20, 'JCBD', 'DEMO-JC-05'),
  ('Électricité', 'Appareillage', 'Boîte d''encastrement Ø68, lot de 10', 8.50, 'JCBD', 'DEMO-JC-06'),
  ('Électricité', 'Protection', 'Disjoncteur 16 A courbe C, 1 pôle', 14.80, 'JCBD', 'DEMO-JC-07'),
  ('Électricité', 'Protection', 'Interrupteur différentiel 40 A 30 mA', 62.00, 'JCBD', 'DEMO-JC-08'),
  ('Électricité', 'Connexion', 'Bornes à levier 3 entrées, lot de 50', 21.50, 'JCBD', 'DEMO-JC-09'),
  ('Électricité', 'Connexion', 'Ruban isolant noir 19 mm, lot de 5', 7.90, 'JCBD', 'DEMO-JC-10'),
  ('Électricité', 'Connexion', 'Domino de raccordement, lot de 20', 6.10, 'JCBD', 'DEMO-JC-11')
) as v(metier, sous_section, nom, prix, fournisseur, reference)
where not exists (
  select 1 from produits p where p.fournisseur = v.fournisseur and p.reference = v.reference
);
