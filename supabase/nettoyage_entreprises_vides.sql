-- Nettoyage des entreprises « fantômes » : sans aucun membre.
-- Elles apparaissent dans l'admin (onglet Entreprises) quand le compte de leur
-- responsable a été supprimé (ex. comptes de test) : la fiche reste, vide,
-- sans responsable. C'est le cas du doublon « ALVAZZI » (0 membre).
--
-- Mode d'emploi : lance d'abord l'ÉTAPE 1 seule (lecture), vérifie la liste,
-- puis lance l'ÉTAPE 2.

-- ÉTAPE 1 — Voir les entreprises sans membre (rien n'est modifié) -------------
select e.id, e.nom, e.statut, e.mode_paiement, e.created_at
from entreprises e
where not exists (select 1 from entreprise_membres m where m.entreprise_id = e.id)
order by e.created_at;

-- ÉTAPE 2 — Supprimer ces entreprises vides (à lancer après vérification) ------
-- Les accords fournisseurs et les soldes liés partent avec elles (ils n'ont plus
-- de raison d'exister sans membre). Si une entreprise est encore utilisée
-- ailleurs, la base refuse la suppression et tu n'as rien perdu : dis-le-moi.
begin;

delete from entreprises e
where not exists (select 1 from entreprise_membres m where m.entreprise_id = e.id);

commit;

-- Vérification : cette requête doit maintenant ne renvoyer aucune ligne.
select e.id, e.nom
from entreprises e
where not exists (select 1 from entreprise_membres m where m.entreprise_id = e.id);
