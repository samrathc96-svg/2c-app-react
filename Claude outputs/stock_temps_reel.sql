-- =========================================================
-- Stock en temps réel : décrémenté automatiquement à la commande,
-- restauré automatiquement si la commande est annulée
-- =========================================================
-- Logique : comme 2C livre pour le compte de Ventiroman (pas de
-- gestion de stock manuelle de notre côté), le stock affiché doit
-- refléter tout seul ce qui vient d'être commandé — personne n'a à
-- penser à le mettre à jour à la main.
--
-- Un produit dont le stock n'est PAS suivi (quantite_stock = NULL,
-- "illimité") n'est jamais touché par ce script : rien ne change
-- pour lui. Les pièces sur mesure du configurateur (id du type
-- "transfo-...") ne sont pas des articles du catalogue, donc jamais
-- concernées non plus.
--
-- Pré-requis : gestion_stock.sql (colonne quantite_stock) déjà
-- exécuté.
-- =========================================================

-- ---------------------------------------------------------
-- 1) creer_commande : vérifie et décrémente le stock AVANT de créer
--    la commande, ligne par ligne. Si le stock est insuffisant pour
--    un produit, toute la commande est refusée (rien n'est créé) —
--    impossible de vendre plus que ce qui est disponible, même avec
--    deux clients qui commandent en même temps (verrouillage de ligne
--    via "for update").
-- ---------------------------------------------------------

create or replace function creer_commande(
  p_produits text,
  p_produits_detail jsonb,
  p_total numeric,
  p_nom_client text,
  p_adresse text,
  p_telephone text,
  p_email text,
  p_user_id uuid,
  p_technicien text default null,
  p_chantier text default null
)
returns setof commandes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commande commandes;
  v_facturation_mensuelle boolean := false;
  v_item jsonb;
  v_produit_id bigint;
  v_quantite int;
  v_stock_actuel int;
begin
  if p_user_id is not null and p_user_id <> auth.uid() then
    raise exception 'user_id invalide';
  end if;

  if p_user_id is not null then
    select (profils.role = 'entreprise') into v_facturation_mensuelle
    from profils
    where profils.id = p_user_id;
  end if;

  if p_produits_detail is not null then
    for v_item in select * from jsonb_array_elements(p_produits_detail)
    loop
      if (v_item->>'id') ~ '^[0-9]+$' then
        v_produit_id := (v_item->>'id')::bigint;
        v_quantite := coalesce((v_item->>'quantite')::int, 1);

        select quantite_stock into v_stock_actuel
        from produits
        where id = v_produit_id
        for update;

        if v_stock_actuel is not null then
          if v_stock_actuel < v_quantite then
            raise exception 'Stock insuffisant pour un des produits demandés';
          end if;
          update produits set quantite_stock = quantite_stock - v_quantite where id = v_produit_id;
        end if;
      end if;
    end loop;
  end if;

  insert into commandes (
    produits, produits_detail, total, nom_client, adresse, telephone, email,
    user_id, technicien, chantier, facturation_mensuelle
  )
  values (
    p_produits, p_produits_detail, p_total, p_nom_client, p_adresse, p_telephone, p_email,
    p_user_id, p_technicien, p_chantier, coalesce(v_facturation_mensuelle, false)
  )
  returning * into v_commande;

  insert into courses (client, adresse, telephone, produits, statut, prix, commande_id, chantier, technicien)
  values (p_nom_client, p_adresse, p_telephone, p_produits, 'À livrer', p_total, v_commande.id, p_chantier, p_technicien);

  return query select * from commandes where id = v_commande.id;
end;
$$;

grant execute on function creer_commande(text, jsonb, numeric, text, text, text, text, uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------
-- 2) Restauration automatique du stock si une commande est annulée
--    (quel que soit le chemin d'annulation : client connecté, invité
--    via numéro de suivi, admin) — un seul trigger couvre tous les
--    cas, posé directement sur "courses".
-- ---------------------------------------------------------

create or replace function public.restaurer_stock_si_annulee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_produits_detail jsonb;
  v_item jsonb;
  v_produit_id bigint;
  v_quantite int;
begin
  if new.statut = 'Annulée' and old.statut is distinct from 'Annulée' and new.commande_id is not null then
    select produits_detail into v_produits_detail
    from commandes
    where id::text = new.commande_id::text;

    if v_produits_detail is not null then
      for v_item in select * from jsonb_array_elements(v_produits_detail)
      loop
        if (v_item->>'id') ~ '^[0-9]+$' then
          v_produit_id := (v_item->>'id')::bigint;
          v_quantite := coalesce((v_item->>'quantite')::int, 1);

          update produits
          set quantite_stock = quantite_stock + v_quantite
          where id = v_produit_id
            and quantite_stock is not null;
        end if;
      end loop;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists restaurer_stock_annulation on courses;
create trigger restaurer_stock_annulation
after update on courses
for each row
execute function public.restaurer_stock_si_annulee();
