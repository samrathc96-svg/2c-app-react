-- =========================================================
-- Notifications push (téléphone verrouillé, comme un SMS) — à exécuter
-- UNE FOIS dans Supabase (SQL Editor > New query > coller tout > Run)
-- =========================================================
-- Principe :
--  * chaque téléphone / navigateur qui active les notifications est
--    enregistré dans "push_abonnements" (lié à la personne connectée) ;
--  * la fonction serveur "notifications-push" envoie les alertes :
--    nouvelle commande à préparer (fournisseur), nouvelle course (livreurs) ;
--  * les clés d'envoi (VAPID) sont fabriquées automatiquement par cette
--    fonction la première fois et rangées dans "push_config" : aucune clé à
--    copier à la main, rien de secret dans le code ;
--  * aucune de ces deux tables n'est lisible depuis le navigateur : tout
--    passe par les 3 petites fonctions ci-dessous.
-- Sans danger à relancer (idempotent).
-- =========================================================

-- 1) Clés d'envoi (une seule ligne) — lisibles uniquement par le serveur
create table if not exists push_config (
  id int primary key default 1 check (id = 1),
  cle_publique text not null,
  cle_privee jsonb not null,
  created_at timestamptz not null default now()
);

alter table push_config enable row level security;
revoke all on push_config from anon, authenticated;

-- 2) Appareils abonnés
create table if not exists push_abonnements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  appareil text,
  created_at timestamptz not null default now()
);

create index if not exists push_abonnements_user_idx on push_abonnements (user_id);

alter table push_abonnements enable row level security;
revoke all on push_abonnements from anon, authenticated;

-- 3) Enregistrer cet appareil pour la personne connectée
create or replace function push_enregistrer(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_appareil text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Non connecté';
  end if;
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Abonnement incomplet';
  end if;

  -- Un même téléphone qui change de compte : l'abonnement suit la personne connectée
  insert into push_abonnements (user_id, endpoint, p256dh, auth, appareil)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_appareil, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        appareil = excluded.appareil;
end;
$$;

-- 4) Retirer cet appareil
create or replace function push_supprimer(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Non connecté';
  end if;
  delete from push_abonnements
  where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

-- 5) Cet appareil est-il bien abonné pour la personne connectée ?
create or replace function push_mon_etat(p_endpoint text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from push_abonnements
    where endpoint = p_endpoint and user_id = auth.uid()
  );
$$;

revoke all on function push_enregistrer(text, text, text, text) from public, anon;
revoke all on function push_supprimer(text) from public, anon;
revoke all on function push_mon_etat(text) from public, anon;
grant execute on function push_enregistrer(text, text, text, text) to authenticated;
grant execute on function push_supprimer(text) to authenticated;
grant execute on function push_mon_etat(text) to authenticated;
