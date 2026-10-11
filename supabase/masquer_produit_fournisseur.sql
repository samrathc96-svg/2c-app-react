-- =====================================================================
-- Fournisseur : masquer / réafficher un produit (sans le supprimer)
-- =====================================================================
-- Jusqu'ici un fournisseur ne pouvait que modifier ou SUPPRIMER un produit.
-- Ici il peut le masquer temporairement (rupture longue, produit saisonnier…)
-- puis le réafficher d'un clic.
--
-- Garde-fous :
--  * on ne peut masquer qu'un produit actuellement publié ;
--  * on ne peut réafficher que ce que le fournisseur a lui-même masqué : un
--    produit masqué ou refusé par 2C reste sous le contrôle de 2C ;
--  * si 2C prend une décision sur le produit, le marqueur « masqué par le
--    fournisseur » est effacé.
--
-- À lancer une seule fois dans Supabase (SQL Editor). Sans danger si relancé.
-- =====================================================================

alter table produits add column if not exists masque_par_fournisseur boolean not null default false;

create or replace function fournisseur_masquer_produit(p_id text, p_masquer boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c fournisseur_comptes := _fournisseur_valide();
begin
  if p_masquer then
    update produits
       set statut_validation = 'masque', masque_par_fournisseur = true, maj_le = now()
     where id::text = p_id
       and fournisseur = v_c.nom_fournisseur
       and statut_validation = 'publie';
    if not found then
      raise exception 'Seul un produit publié peut être masqué';
    end if;
  else
    update produits
       set statut_validation = 'publie', masque_par_fournisseur = false, maj_le = now()
     where id::text = p_id
       and fournisseur = v_c.nom_fournisseur
       and statut_validation = 'masque'
       and masque_par_fournisseur = true;
    if not found then
      raise exception 'Ce produit a été masqué par 2C Delivery : contactez-nous pour le réafficher';
    end if;
  end if;
end;
$$;

-- Une décision de 2C (publier, refuser, masquer) remplace tout masquage fait
-- par le fournisseur.
create or replace function admin_decider_produits(p_ids text[], p_decision text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if not est_admin() then
    raise exception 'Accès refusé';
  end if;
  if p_decision not in ('publie', 'refuse', 'masque') then
    raise exception 'Décision invalide';
  end if;
  update produits
     set statut_validation = p_decision, masque_par_fournisseur = false, maj_le = now()
   where id::text = any (p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function fournisseur_masquer_produit(text, boolean) from public, anon;
grant execute on function fournisseur_masquer_produit(text, boolean) to authenticated;
revoke all on function admin_decider_produits(text[], text) from public, anon;
grant execute on function admin_decider_produits(text[], text) to authenticated;
