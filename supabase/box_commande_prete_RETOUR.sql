-- =====================================================================
-- Retour en arrière de box_commande_prete.sql
-- Les courses redeviennent toutes visibles des livreurs, sans condition.
-- Les tables et colonnes ajoutées sont conservées (inoffensives).
-- =====================================================================

drop trigger if exists trg_course_prete_a_la_creation on courses;
drop trigger if exists trg_verifier_prise_course on courses;
drop trigger if exists trg_proteger_colonnes_box on courses;

drop policy if exists "Lecture courses livreur" on courses;
drop policy if exists "Lecture courses admin" on courses;
drop policy if exists "Lecture courses admin et livreur" on courses;
create policy "Lecture courses admin et livreur"
on courses
for select
to authenticated
using (exists (select 1 from profils p where p.id = auth.uid() and p.role in ('admin','livreur')));

drop function if exists course_prete_a_la_creation();
drop function if exists verifier_prise_course();
drop function if exists proteger_colonnes_box();
drop function if exists _livreur_voit_course(bigint, uuid, timestamptz);
drop function if exists fournisseur_marquer_prete(text, text, int);
drop function if exists fournisseur_demarquer_prete(text);
drop function if exists admin_marquer_prete(text, text, text, int);
drop function if exists courses_colis();
drop function if exists livreur_liberer_course(bigint);
drop function if exists admin_liberations();
drop function if exists autoriser_declaration_prete(uuid, text, text);
drop function if exists reclamer_push_prete(text, text);
drop function if exists reclamer_push_liberation(uuid, text);
drop function if exists rappels_a_envoyer();
drop function if exists pushes_prete_en_attente();

notify pgrst, 'reload schema';
