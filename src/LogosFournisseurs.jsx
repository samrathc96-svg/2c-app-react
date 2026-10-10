import { useEffect, useRef, useState } from 'react'
import { LogoFournisseurImage } from './LogoFournisseur'

// Rangée de logos de fournisseurs qui défile (comme la rangée des métiers) :
// accès direct à la page d'un fournisseur. Glisser au doigt sur téléphone,
// flèches sur ordinateur.
export default function LogosFournisseurs({ fournisseurs, logos, onOuvrir }) {
  const rangee = useRef(null)
  const [peutReculer, setPeutReculer] = useState(false)
  const [peutAvancer, setPeutAvancer] = useState(false)

  function mettreAJourFleches() {
    const el = rangee.current
    if (!el) return
    setPeutReculer(el.scrollLeft > 4)
    setPeutAvancer(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  useEffect(() => {
    mettreAJourFleches()
    window.addEventListener('resize', mettreAJourFleches)
    return () => window.removeEventListener('resize', mettreAJourFleches)
  }, [fournisseurs.length])

  function defiler(sens) {
    const el = rangee.current
    if (!el) return
    el.scrollBy({ left: sens * Math.max(160, el.clientWidth * 0.8), behavior: 'smooth' })
  }

  if (fournisseurs.length === 0) return null

  return (
    <div className="logos-fournisseurs bloc-accueil" role="region" aria-label="Accès rapide aux fournisseurs">
      <h3 className="titre-accueil">Accès rapide</h3>
      <div className="logos-fournisseurs-cadre">
        {peutReculer && (
          <button type="button" className="fleche-logos gauche" aria-label="Fournisseurs précédents" onClick={() => defiler(-1)}>
            <i className="bi bi-chevron-left"></i>
          </button>
        )}
        <div className="rangee-logos-fournisseurs" ref={rangee} onScroll={mettreAJourFleches}>
          {fournisseurs.map((f) => (
            <button key={f.nom} type="button" className="puce-logo-fournisseur" onClick={() => onOuvrir(f.nom)}>
              <span className={`rond-logo-fournisseur${logos[f.nom] ? ' avec-logo' : ''}`}>
                <LogoFournisseurImage url={logos[f.nom]} nom={f.nom} />
                {f.habituel && <span className="pastille-habituel" title="Tu y commandes souvent"><i className="bi bi-star-fill"></i></span>}
              </span>
              <span className="nom-logo-fournisseur">{f.nom}</span>
              {f.demo && <span className="etiquette-demo">Démo</span>}
            </button>
          ))}
        </div>
        {peutAvancer && (
          <button type="button" className="fleche-logos droite" aria-label="Fournisseurs suivants" onClick={() => defiler(1)}>
            <i className="bi bi-chevron-right"></i>
          </button>
        )}
      </div>
    </div>
  )
}
