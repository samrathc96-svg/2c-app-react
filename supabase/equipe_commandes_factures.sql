-- Responsable d'entreprise : voir les factures de toute son équipe
-- (dans "Mes factures") et télécharger les PDF correspondants.
-- À exécuter une fois dans Supabase > SQL Editor. Sans risque si relancé.

create or replace function factures_equipe()
returns setof factures
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ent uuid := entreprise_du_responsable();
begin
  if v_ent is null then
    raise exception 'Accès refusé';
  end if;
  return query
  select f.*
  from factures f
  join entreprise_membres m on m.user_id = f.user_id
  where m.entreprise_id = v_ent
  order by f.created_at desc;
end;
$$;

revoke all on function factures_equipe() from public, anon;
grant execute on function factures_equipe() to authenticated;

-- Lecture des PDF : le dossier du fichier porte l'identifiant du membre.
drop policy if exists "factures_lecture_responsable" on storage.objects;
create policy "factures_lecture_responsable"
on storage.objects for select
to authenticated
using (
  bucket_id = 'factures'
  and exists (
    select 1
    from public.entreprise_membres m
    where m.entreprise_id = public.entreprise_du_responsable()
      and m.user_id::text = (storage.foldername(name))[1]
  )
);
