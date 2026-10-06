-- =========================================================
-- Sécurité de livraison : code à 4 chiffres — à exécuter UNE FOIS
-- dans Supabase (SQL Editor > New query > coller tout > Run)
-- =========================================================
-- Principe :
--  * chaque course reçoit un code à 4 chiffres, créé automatiquement ;
--  * le client voit ce code (suivi / Mes commandes) et le donne au livreur
--    à la remise de la commande ;
--  * le livreur doit saisir ce code pour passer la course à "Livrée"
--    (+ nom de la personne qui a reçu). 5 essais maximum ;
--  * même en contournant l'application, la base refuse le passage à
--    "Livrée" sans code validé (l'admin et les appels serveur peuvent
--    toujours le faire, par exemple pour un dépannage).
-- Le code est stocké à part (table non lisible depuis le navigateur) :
-- le livreur ne peut donc jamais le lire.
-- =========================================================

-- 1) Table des codes (jamais lisible directement depuis le navigateur)
create table if not exists codes_livraison (
  course_id text primary key,
  code text not null,
  tentatives int not null default 0,
  valide_le timestamptz,
  recu_par text,
  created_at timestamptz not null default now()
);

alter table codes_livraison enable row level security;
revoke all on codes_livraison from anon, authenticated;

-- 2) Création automatique d'un code pour chaque nouvelle course
create or replace function generer_code_livraison()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into codes_livraison (course_id, code)
  values (new.id::text, lpad((floor(random() * 10000))::int::text, 4, '0'))
  on conflict (course_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_generer_code_livraison on courses;
create trigger trg_generer_code_livraison
after insert on courses
for each row execute function generer_code_livraison();

-- Codes pour les courses déjà en cours (créées avant cette mise en place)
insert into codes_livraison (course_id, code)
select c.id::text, lpad((floor(random() * 10000))::int::text, 4, '0')
from courses c
where c.statut in ('À livrer', 'En cours')
on conflict (course_id) do nothing;

-- 3) Verrou : pas de passage à "Livrée" sans code validé
create or replace function verifier_code_avant_livraison()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.statut = 'Livrée' and old.statut is distinct from 'Livrée' then
    -- Appels serveur (éditeur SQL, fonctions) : pas de blocage
    if auth.uid() is null then
      return new;
    end if;
    -- L'admin peut toujours corriger un statut
    if exists (select 1 from profils where id = auth.uid() and role = 'admin') then
      return new;
    end if;
    -- Course sans code (très anciennes courses) : pas de blocage
    if not exists (select 1 from codes_livraison where course_id = new.id::text) then
      return new;
    end if;
    -- Code validé : on laisse passer
    if exists (
      select 1 from codes_livraison
      where course_id = new.id::text and valide_le is not null
    ) then
      return new;
    end if;
    raise exception 'Code de livraison requis pour valider la livraison';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_verifier_code_livraison on courses;
create trigger trg_verifier_code_livraison
before update of statut on courses
for each row execute function verifier_code_avant_livraison();

-- 4) Validation de la livraison par le livreur (code + "reçu par")
create or replace function valider_livraison(
  p_course_id text,
  p_code text,
  p_recu_par text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course courses;
  v_code codes_livraison;
begin
  if auth.uid() is null then
    raise exception 'Non connecté';
  end if;

  select * into v_course from courses where id::text = p_course_id for update;
  if not found then
    raise exception 'Course introuvable';
  end if;
  if v_course.livreur_id is distinct from auth.uid() then
    raise exception 'Cette course ne vous est pas assignée';
  end if;
  if v_course.statut <> 'En cours' then
    return jsonb_build_object('ok', false, 'message', 'La course doit être « En cours » pour être validée.');
  end if;

  select * into v_code from codes_livraison where course_id = p_course_id for update;

  -- Très ancienne course sans code : validation sans contrôle
  if not found then
    update courses set statut = 'Livrée' where id::text = p_course_id;
    return jsonb_build_object('ok', true);
  end if;

  if v_code.tentatives >= 5 then
    return jsonb_build_object('ok', false, 'message', 'Trop de tentatives. Contactez 2C Delivery pour valider cette livraison.');
  end if;

  if trim(coalesce(p_code, '')) <> v_code.code then
    update codes_livraison set tentatives = tentatives + 1 where course_id = p_course_id;
    return jsonb_build_object(
      'ok', false,
      'message', 'Code incorrect. Il reste ' || greatest(4 - v_code.tentatives, 0) || ' essai(s).'
    );
  end if;

  update codes_livraison
  set valide_le = now(), recu_par = nullif(trim(coalesce(p_recu_par, '')), '')
  where course_id = p_course_id;

  update courses set statut = 'Livrée' where id::text = p_course_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function valider_livraison(text, text, text) to authenticated;

-- 5) Le client (compte ou invité) retrouve son code
--    Compte : numéro de suivi d'une commande qui lui appartient.
--    Invité : numéro de suivi + nom, comme pour la recherche de commande.
--    Le code n'est renvoyé que tant que la livraison n'est pas terminée.
create or replace function obtenir_code_livraison(
  p_numero text,
  p_nom text default null
)
returns table (code text, valide boolean, recu_par text, valide_le timestamptz, statut text)
language sql
security definer
set search_path = public
as $$
  select
    case when cr.statut in ('À livrer', 'En cours') then cl.code else null end,
    cl.valide_le is not null,
    cl.recu_par,
    cl.valide_le,
    cr.statut
  from commandes cmd
  join courses cr on cr.commande_id::text = cmd.id::text
  join codes_livraison cl on cl.course_id = cr.id::text
  where upper(trim(cmd.numero_suivi)) = upper(trim(p_numero))
    and (
      (auth.uid() is not null and cmd.user_id::text = auth.uid()::text)
      or (p_nom is not null and lower(trim(cmd.nom_client)) = lower(trim(p_nom)))
    )
  limit 1;
$$;

grant execute on function obtenir_code_livraison(text, text) to anon, authenticated;
