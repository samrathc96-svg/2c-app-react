-- Retour en arrière de logo_fournisseur.sql (les logos déjà envoyés ne s'affichent plus)
drop view if exists fournisseur_logos_publics;
drop function if exists fournisseur_enregistrer_logo(text);
drop function if exists admin_logos_fournisseurs();
drop function if exists admin_retirer_logo(uuid);
alter table fournisseur_comptes drop column if exists logo_url;
notify pgrst, 'reload schema';
