import { useRef, useState } from 'react'

// « Vos produits habituels » : un seul produit visible à la fois, dans un
// tableau d'une ligne. On passe au suivant en faisant glisser vers la gauche
// ou la droite (doigt, trackpad), ou avec les flèches / les pastilles.
export default function ProduitsHabituels({ titre, habituels, onAjouter, onOuvrirFournisseur, libelleQuand, masquerFournisseur = false }) {
  const piste = useRef(null)
  const [index, setIndex] = useState(0)

  if (habituels.length === 0) return null

  const total = habituels.length
  const courant = Math.min(index, total - 1)

  function surDefilement() {
    const el = piste.current
    if (!el || el.clientWidth === 0) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    if (i !== index) setIndex(Math.max(0, Math.min(total - 1, i)))
  }

  function aller(i) {
    const el = piste.current
    if (!el) return
    const cible = Math.max(0, Math.min(total - 1, i))
    el.scrollTo({ left: cible * el.clientWidth, behavior: 'smooth' })
    setIndex(cible)
  }

  return (
    <section className="habituels bloc-accueil" aria-label={titre}>
      <header className="habituels-entete">
        <h3 className="titre-accueil">{titre}</h3>
        {total > 1 && (
          <div className="habituels-nav">
            <button type="button" aria-label="Produit précédent" disabled={courant === 0} onClick={() => aller(courant - 1)}>
              <i className="bi bi-chevron-left"></i>
            </button>
            <span className="habituels-compteur">{courant + 1} / {total}</span>
            <button type="button" aria-label="Produit suivant" disabled={courant >= total - 1} onClick={() => aller(courant + 1)}>
              <i className="bi bi-chevron-right"></i>
            </button>
          </div>
        )}
      </header>
      <div className="habituels-tableau-cadre">
        <div className={`habituels-ligne habituels-titres${masquerFournisseur ? ' sans-fournisseur' : ''}`} aria-hidden="true">
          <span>Produit</span>
          {!masquerFournisseur && <span className="col-fournisseur">Fournisseur</span>}
          <span className="col-historique">Historique</span>
          <span className="col-prix">Prix</span>
          <span className="col-action"></span>
        </div>
        <div className="habituels-piste" ref={piste} onScroll={surDefilement}>
          {habituels.map((h, i) => (
            <div
              key={h.produit.id}
              className={`habituels-ligne habituels-diapo${masquerFournisseur ? ' sans-fournisseur' : ''}`}
              aria-hidden={i !== courant}
            >
              <span className="col-produit">
                <span className="habituel-nom">{h.produit.nom}</span>
                <span className="habituel-sous">
                  {!masquerFournisseur && <>{h.produit.fournisseur} · </>}
                  {h.fois} fois{libelleQuand(h.derniere) ? ` · ${libelleQuand(h.derniere)}` : ''}
                </span>
              </span>
              {!masquerFournisseur && (
                <span className="col-fournisseur">
                  <button type="button" className="lien-fournisseur" tabIndex={i === courant ? 0 : -1} onClick={() => onOuvrirFournisseur(h.produit.fournisseur)}>
                    {h.produit.fournisseur}
                  </button>
                </span>
              )}
              <span className="col-historique">
                {h.fois} fois
                <span className="habituel-quand">{libelleQuand(h.derniere)}</span>
              </span>
              <span className="col-prix">{h.produit.prix.toFixed(2)} CHF</span>
              <span className="col-action">
                <button type="button" className="bouton-plus" tabIndex={i === courant ? 0 : -1} aria-label={`Ajouter ${h.produit.nom} au panier`} onClick={() => onAjouter(h.produit)}>
                  <i className="bi bi-plus-lg"></i>
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
      {total > 1 && (
        <div className="habituels-pastilles" role="tablist" aria-label="Produits">
          {habituels.map((h, i) => (
            <button
              key={h.produit.id}
              type="button"
              role="tab"
              aria-selected={i === courant}
              aria-label={`Produit ${i + 1}`}
              className={i === courant ? 'actif' : ''}
              onClick={() => aller(i)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
