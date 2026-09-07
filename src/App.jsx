import { useState } from 'react'
import './App.css'

const metiers = [
  { nom: 'Maçonnerie & Gros œuvre', icone: 'bricks', sousSections: ['Chevilles & vis béton', 'Fil à plomb & cordeau', 'Joints de dilatation', 'Équipement de protection'] },
  { nom: 'Plâtrerie & Cloisons', icone: 'layers', sousSections: ['Vis autoforeuses placo', 'Bandes à joint', "Cornières d'angle", 'Adhésif toilé'] },
  { nom: 'Peinture & Finitions', icone: 'brush', sousSections: ['Pinceaux & rouleaux', 'Bâches de protection', 'Ruban de masquage', 'Mastics & spatules'] },
  { nom: 'Plomberie & Sanitaire', icone: 'droplet', sousSections: ['Raccords', 'Joints silicone & fibre', 'Colliers de serrage', 'Téflon & mastic sanitaire'] },
  { nom: 'Électricité', icone: 'lightning-charge', sousSections: ['Dominos & gaines ICTA', 'Câbles courts', 'Prises & interrupteurs', 'Scotch isolant'] },
  { nom: 'Menuiserie & Serrurerie', icone: 'wrench', sousSections: ['Vis à bois & chevilles', 'Charnières & poignées', 'Colle bois', 'Mèches & lames'] },
  { nom: 'Carrelage & Revêtements', icone: 'grid-3x3', sousSections: ['Colle carrelage', 'Croisillons', 'Joints', 'Mastic silicone'] },
  { nom: 'Couverture & Étanchéité', icone: 'house', sousSections: ['Pointes & crochets de tuile', 'Mastic bitumineux', 'Membrane petit format', 'Vis toiture'] },
  { nom: 'Chauffage & Climatisation', icone: 'fan', sousSections: ['Colliers & raccords', 'Joints', 'Filtres', 'Gaines flexibles courtes'] }
]

function App() {
  const [metierActif, setMetierActif] = useState(null)

  return (
    <div className="app">
      <div className="logo">
        <span className="lettre">C</span>
        <span className="chiffre">2</span>
      </div>
      <p className="slogan">Du rayon au chantier, en un clic.</p>

      {metierActif === null ? (
        <>
          <h3>Corps de métier</h3>
          <ul className="liste-metiers">
            {metiers.map((metier) => (
              <li key={metier.nom} onClick={() => setMetierActif(metier)}>
                <span className="icon"><i className={`bi bi-${metier.icone}`}></i></span>
                <span>{metier.nom}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p onClick={() => setMetierActif(null)} style={{ cursor: 'pointer', color: '#79705F' }}>← Retour</p>
          <h3>{metierActif.nom}</h3>
          <ul className="liste-metiers">
            {metierActif.sousSections.map((sousSection) => (
              <li key={sousSection}>
                <span>{sousSection}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export default App