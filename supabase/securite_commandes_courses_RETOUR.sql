-- =====================================================================
-- RETOUR EN ARRIÈRE de securite_commandes_courses.sql
-- À n'exécuter QUE si quelque chose ne fonctionne plus après la correction.
-- Remet l'état d'avant (qui laisse les données ouvertes au public).
-- =====================================================================
create policy "Insertion publique des commandes" on commandes for insert to public with check (true);
create policy "Lecture des commandes anonymes" on commandes for select to anon using (user_id is null);
create policy "Insertion publique des courses" on courses for insert to public with check (true);
create policy "Lecture publique des courses" on courses for select to public using (true);
create policy "Mise a jour publique du statut" on courses for update to public using (true);

grant insert, select, update, delete, truncate, references, trigger on table commandes to anon, authenticated;
grant insert, select, update, delete, truncate, references, trigger on table courses to anon, authenticated;

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
    execute format('grant execute on function %s to public, anon, authenticated', f.signature);
  end loop;
end $$;

notify pgrst, 'reload schema';
