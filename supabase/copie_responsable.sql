-- =====================================================================
-- Copie des factures au responsable d'entreprise (étape 2)
-- À exécuter UNE FOIS dans Supabase > SQL Editor.
-- Sans danger : ne supprime rien, peut être relancé.
-- =====================================================================
-- Renvoie l'email du responsable de l'entreprise de la personne qui a passé
-- une commande (ou NULL s'il n'y a pas d'entreprise). Réservé au livreur et à
-- l'admin, qui déclenchent l'envoi de la facture à la livraison.

create or replace function email_responsable_commande(p_commande_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if not exists (
    select 1 from profils where profils.id = auth.uid() and profils.role in ('admin', 'livreur')
  ) then
    raise exception 'Accès refusé';
  end if;

  select p.email::text
    into v_email
  from commandes c
  join entreprise_membres m on m.user_id = c.user_id
  join entreprise_membres r on r.entreprise_id = m.entreprise_id
                           and r.role_entreprise = 'responsable'
                           and r.actif
  join profils p on p.id = r.user_id
  where c.id::text = p_commande_id
  limit 1;

  return v_email;
end;
$$;

revoke all on function email_responsable_commande(text) from public, anon;
grant execute on function email_responsable_commande(text) to authenticated;
