-- =========================================================
-- Paiement en ligne (Stripe) — à exécuter UNE FOIS dans Supabase
-- (SQL Editor > New query > coller tout > Run)
-- =========================================================
-- Principe : la commande n'est créée en base QU'APRÈS le paiement.
-- Pendant le paiement, le panier est mis de côté dans
-- "paiements_en_attente". Quand Stripe confirme le paiement, la
-- fonction finaliser_paiement() crée la commande en réutilisant
-- creer_commande() telle qu'elle existe déjà (stock, course, numéro de
-- suivi...). Aucune commande impayée n'arrive donc jamais aux livreurs.
-- =========================================================

-- 1) Suivi du paiement sur les commandes
alter table commandes add column if not exists paye boolean not null default false;
alter table commandes add column if not exists paye_le timestamptz;
alter table commandes add column if not exists stripe_payment_intent text;
alter table commandes add column if not exists rembourse boolean not null default false;

-- 2) Panier mis de côté pendant le paiement (jamais lisible depuis le navigateur)
create table if not exists paiements_en_attente (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  payload jsonb not null,
  total numeric not null,
  stripe_session_id text unique,
  statut text not null default 'en_attente',
  commande_id text,
  confirmation_envoyee boolean not null default false
);

alter table paiements_en_attente enable row level security;
revoke all on paiements_en_attente from anon, authenticated;

-- 3) Création de la commande une fois le paiement confirmé
--    (appelée uniquement par la fonction serveur "stripe-webhook")
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
    null,
    null
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

-- 4) Page de retour après paiement : retrouve la commande à partir de
--    l'identifiant de session Stripe (long et imprévisible, connu seulement
--    du navigateur du client qui vient de payer)
create or replace function commande_apres_paiement(p_session_id text)
returns setof commandes
language sql
security definer
set search_path = public
as $$
  select c.*
  from paiements_en_attente p
  join commandes c on c.id::text = p.commande_id
  where p.stripe_session_id = p_session_id
    and p.statut = 'paye'
$$;

grant execute on function commande_apres_paiement(text) to anon, authenticated;
