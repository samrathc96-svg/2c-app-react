import { useEffect, useState } from 'react'

// Diaporama de l'accueil (ordinateur uniquement) : 3 photos qui s'enchaînent
// en fondu toutes les 8 secondes, avec un message par image.
const DUREE_MS = 8000

const DIAPOS = [
  {
    image: '/diaporama/accueil-1-plans.jpg',
    position: '62% 50%',
    titre: 'Du plan au chantier, tout est prévu',
    texte: 'Commandez vos petits consommables en quelques clics, chez plusieurs fournisseurs à la fois.'
  },
  {
    image: '/diaporama/accueil-2-chantier.jpg',
    position: '50% 38%',
    titre: "Le chantier n'attend pas",
    texte: 'Il manque une pièce ? Elle est récupérée chez le fournisseur et livrée directement sur place.'
  },
  {
    image: '/diaporama/accueil-3-livraison.jpg',
    position: '50% 52%',
    titre: 'Livré à Genève, sans détour',
    texte: 'Un seul livreur, en scooter ou en vélo cargo : une livraison rapide et plus respectueuse de la ville.'
  }
]

export default function DiaporamaAccueil() {
  const [index, setIndex] = useState(0)
  const [pause, setPause] = useState(false)

  useEffect(() => {
    if (pause) return undefined
    const minuteur = setInterval(() => setIndex((i) => (i + 1) % DIAPOS.length), DUREE_MS)
    return () => clearInterval(minuteur)
  }, [pause, index])

  return (
    <div
      className="hero-diapo"
      role="region"
      aria-roledescription="diaporama"
      aria-label="2C Delivery en images"
      onMouseEnter={() => setPause(true)}
      onMouseLeave={() => setPause(false)}
    >
      {DIAPOS.map((d, i) => (
        <div key={d.image} className={`hero-diapo-slide${i === index ? ' actif' : ''}`} aria-hidden={i !== index}>
          <img src={d.image} alt="" style={{ objectPosition: d.position }} />
          <div className="hero-diapo-texte">
            <strong>{d.titre}</strong>
            <span>{d.texte}</span>
          </div>
        </div>
      ))}
      <div className="hero-diapo-puces" role="tablist" aria-label="Images">
        {DIAPOS.map((d, i) => (
          <button
            key={d.image}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Image ${i + 1}`}
            className={i === index ? 'actif' : ''}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </div>
  )
}
