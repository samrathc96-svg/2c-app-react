import './App.css'

const metiers = [
  { nom: 'Maçonnerie & Gros œuvre', icone: 'bricks' },
  { nom: 'Plâtrerie & Cloisons', icone: 'layers' },
  { nom: 'Peinture & Finitions', icone: 'brush' },
  { nom: 'Plomberie & Sanitaire', icone: 'droplet' },
  { nom: 'Électricité', icone: 'lightning-charge' },
  { nom: 'Menuiserie & Serrurerie', icone: 'wrench' },
  { nom: 'Carrelage & Revêtements', icone: 'grid-3x3' },
  { nom: 'Couverture & Étanchéité', icone: 'house' },
  { nom: 'Chauffage & Climatisation', icone: 'fan' }
]

function App() {
  return (
    <div className="app">
      <div className="logo">
        <span className="lettre">C</span>
        <span className="chiffre">2</span>
      </div>
      <p className="slogan">Du rayon au chantier, en un clic.</p>

      <h3>Corps de métier</h3>
      <ul className="liste-metiers">
        {metiers.map((metier) => (
          <li key={metier.nom}>
            <span className="icon"><i className={`bi bi-${metier.icone}`}></i></span>
            <span>{metier.nom}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default App