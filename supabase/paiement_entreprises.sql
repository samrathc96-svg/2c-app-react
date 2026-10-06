-- =========================================================
-- Comptes entreprise : paiement en ligne comme tous les clients
-- À exécuter UNE FOIS dans Supabase (SQL Editor > New query > Run)
-- =========================================================
-- Il n'y a plus de facturation mensuelle : les comptes entreprise paient
-- en ligne à la commande. Pour ne pas perdre le chantier et le nom du
-- collaborateur qui commande, finaliser_paiement() les transmet
-- maintenant à creer_commande() (avant : null, null).
-- À faire AVANT de mettre en ligne la nouvelle version du site, puis
-- redéployer la fonction "creer-paiement" (fichier fourni).
-- =========================================================

create or replace function finaliser_paiement(p_session_id text, p_payment_intent text)
returns setof commandes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_att paiements_en_attente;
  v_commande commandes;
  v_p jsonb;
begin
  select * into v_att
  from paiements_en_attente
  where stripe_session_id = p_session_id
  for update;

  if not found then
    raise exception 'Paiement inconnu';
  end if;

  -- Déjà traité (Stripe peut renvoyer le même événement) : on renvoie la commande existante
  if v_att.statut = 'paye' then
    return query select * from commandes where id::text = v_att.commande_id;
    return;
  end if;

  v_p := v_att.payload;

  -- creer_commande() vérifie que user_id = utilisateur connecté. Ici l'appel
  -- vient du serveur : on simule l'identité du client le temps de la transaction.
  if v_att.user_id is not null then
    perform set_config('request.jwt.claim.sub', v_att.user_id::text, true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_att.user_id::text, 'role', 'authenticated')::text,
      true
    );
  end if;

  select * into v_commande
  from creer_commande(
    v_p->>'produits',
    v_p->'produits_detail',
    v_att.total,
    v_p->>'nom_client',
    v_p->>'adresse',
    v_p->>'telephone',
    v_p->>'email',
    v_att.user_id,
    v_p->>'technicien',
    v_p->>'chantier'
  );

  update commandes
  set paye = true, paye_le = now(), stripe_payment_intent = p_payment_intent
  where id = v_commande.id;

  update paiements_en_attente
  set statut = 'paye', commande_id = v_commande.id::text
  where id = v_att.id;

  return query select * from commandes where id = v_commande.id;
end;
$$;

revoke all on function finaliser_paiement(text, text) from public, anon, authenticated;
grant execute on function finaliser_paiement(text, text) to service_role;
