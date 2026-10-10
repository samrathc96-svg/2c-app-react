import { useEffect, useState } from 'react'

// Tableau « Vos produits habituels » avec diaporama : quelques lignes par
// page, flèches et pastilles pour passer à la suite.
export default function ProduitsHabituels({ titre, habituels, onAjouter, onOuvrirFournisseur, libelleQuand, masquerFournisseur = false, parPageBureau = 4 }) {
  const [page, setPage] = useState(0)
  const [parPage, setParPage] = useState(parPageBureau)

  useEffect(() => {
    function ajuster() {
      setParPage(window.innerWidth < 700 ? 3 : parPageBureau)
    }
    ajuster()
    window.addEventListener('resize', ajuster)
    return () => window.removeEventListener('resize', ajuster)
  }, [parPageBureau])

  const nombrePages = Math.max(1, Math.ceil(habituels.length / parPage))
  const pageCourante = Math.min(page, nombrePages - 1)
  const lignes = habituels.slice(pageCourante * parPage, pageCourante * parPage + parPage)

  useEffect(() => {
    if (page > nombrePages - 1) setPage(nombrePages - 1)
  }, [page, nombrePages])

  if (habituels.length === 0) return null

  return (
    <section className="habituels" aria-label={titre}>
      <header className="habituels-entete">
        <h3 className="titre-accueil">{titre}</h3>
        {nombrePages > 1 && (
          <div className="habituels-nav">
            <button type="button" aria-label="Page précédente" disabled={pageCourante === 0} onClick={() => setPage(pageCourante - 1)}>
              <i className="bi bi-chevron-left"></i>
            </button>
            <span className="habituels-compteur">{pageCourante + 1} / {nombrePages}</span>
            <button type="button" aria-label="Page suivante" disabled={pageCourante >= nombrePages - 1} onClick={() => setPage(pageCourante + 1)}>
              <i className="bi bi-chevron-right"></i>
            </button>
          </div>
        )}
      </header>
      <div className="habituels-tableau-cadre">
        <table className="habituels-tableau">
          <thead>
            <tr>
              <th>Produit</th>
              {!masquerFournisseur && <th className="col-fournisseur">Fournisseur</th>}
              <th className="col-historique">Historique</th>
              <th className="col-prix">Prix</th>
              <th className="col-action"><span className="sr-seul">Ajouter</span></th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((h) => (
              <tr key={h.produit.id}>
                <td className="col-produit">
                  <span className="habituel-nom">{h.produit.nom}</span>
                  <span className="habituel-sous">
                    {!masquerFournisseur && <span className="habituel-sous-fournisseur">{h.produit.fournisseur} · </span>}
                    {h.fois} fois{libelleQuand(h.derniere) ? ` · ${libelleQuand(h.derniere)}` : ''}
                  </span>
                </td>
                {!masquerFournisseur && (
                  <td className="col-fournisseur">
                    <button type="button" className="lien-fournisseur" onClick={() => onOuvrirFournisseur(h.produit.fournisseur)}>
                      {h.produit.fournisseur}
                    </button>
                  </td>
                )}
                <td className="col-historique">
                  {h.fois} fois
                  <span className="habituel-quand">{libelleQuand(h.derniere)}</span>
                </td>
                <td className="col-prix">{h.produit.prix.toFixed(2)} CHF</td>
                <td className="col-action">
                  <button type="button" className="bouton-plus" aria-label={`Ajouter ${h.produit.nom} au panier`} onClick={() => onAjouter(h.produit)}>
                    <i className="bi bi-plus-lg"></i>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nombrePages > 1 && (
        <div className="habituels-pastilles" role="tablist" aria-label="Pages">
          {Array.from({ length: nombrePages }).map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === pageCourante}
              aria-label={`Page ${i + 1}`}
              className={i === pageCourante ? 'actif' : ''}
              onClick={() => setPage(i)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
