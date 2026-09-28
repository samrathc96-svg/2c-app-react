-- =========================================================
-- Gestion des stocks : quantité disponible par produit
-- =========================================================
-- Nouvelle colonne, optionnelle : si elle reste vide (NULL) pour un
-- produit, rien ne change pour lui (stock non suivi, "illimité",
-- comportement identique à aujourd'hui). Si tu renseignes un nombre,
-- le produit passe en "rupture de stock" côté catalogue dès qu'il
-- atteint 0 (bouton "Ajouter" désactivé).
-- =========================================================

alter table produits add column if not exists quantite_stock integer;
