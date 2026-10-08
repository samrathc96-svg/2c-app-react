-- Retour en arrière des notifications push (supprime clés et abonnements)
drop function if exists push_enregistrer(text, text, text, text);
drop function if exists push_supprimer(text);
drop function if exists push_mon_etat(text);
drop table if exists push_abonnements;
drop table if exists push_config;
