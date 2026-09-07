import { useState } from 'react'
import './App.css'

const metiers = [
  { nom: 'Maçonnerie & Gros œuvre', icone: 'bricks', sousSections: [
    { nom: 'Chevilles & vis béton', produits: [{ nom: 'Chevilles béton x50 + vis (Ø6mm)', prix: 8.90 }, { nom: 'Boîte vis à béton x100', prix: 6.50 }] },
    { nom: 'Fil à plomb & cordeau', produits: [{ nom: 'Fil à plomb 200g', prix: 5.20 }, { nom: 'Cordeau traceur 30m', prix: 4.80 }] },
    { nom: 'Joints de dilatation', produits: [{ nom: 'Joint de dilatation PVC 2m', prix: 3.90 }, { nom: 'Bande compressible 5m', prix: 7.40 }] },
    { nom: 'Équipement de protection', produits: [{ nom: 'Gants de chantier (paire)', prix: 4.50 }, { nom: 'Lunettes de protection', prix: 3.20 }] }
  ]},
  { nom: 'Plâtrerie & Cloisons', icone: 'layers', sousSections: [
    { nom: 'Vis autoforeuses placo', produits: [{ nom: 'Vis autoforeuses placo x100 (35mm)', prix: 6.90 }, { nom: 'Vis autoforeuses placo x100 (45mm)', prix: 7.50 }] },
    { nom: 'Bandes à joint', produits: [{ nom: 'Bande à joint papier 75m', prix: 5.90 }, { nom: 'Bande armée fibre 90m', prix: 8.20 }] },
    { nom: "Cornières d'angle", produits: [{ nom: "Cornière d'angle alu 2,5m", prix: 4.10 }, { nom: "Cornière d'angle PVC 2,5m", prix: 3.40 }] },
    { nom: 'Adhésif toilé', produits: [{ nom: 'Adhésif toilé 50mm x25m', prix: 6.30 }] }
  ]},
  { nom: 'Peinture & Finitions', icone: 'brush', sousSections: [
    { nom: 'Pinceaux & rouleaux', produits: [{ nom: 'Rouleau laqueur 18cm', prix: 7.90 }, { nom: 'Set 3 pinceaux plats', prix: 9.50 }] },
    { nom: 'Bâches de protection', produits: [{ nom: 'Bâche de protection 4x5m', prix: 6.40 }] },
    { nom: 'Ruban de masquage', produits: [{ nom: 'Ruban de masquage 38mm x50m', prix: 3.60 }] },
    { nom: 'Mastics & spatules', produits: [{ nom: 'Mastic acrylique blanc 300ml', prix: 4.90 }, { nom: 'Spatule inox 10cm', prix: 5.30 }] }
  ]},
  { nom: 'Plomberie & Sanitaire', icone: 'droplet', sousSections: [
    { nom: 'Raccords', produits: [{ nom: 'Raccord laiton 15x21', prix: 3.80 }, { nom: 'Coude PVC Ø40', prix: 2.90 }] },
    { nom: 'Joints silicone & fibre', produits: [{ nom: 'Joint silicone sanitaire 280ml', prix: 6.10 }, { nom: 'Joints fibre plats (x10)', prix: 2.40 }] },
    { nom: 'Colliers de serrage', produits: [{ nom: 'Colliers de serrage inox (x10)', prix: 4.70 }] },
    { nom: 'Téflon & mastic sanitaire', produits: [{ nom: 'Ruban téflon x3', prix: 2.60 }, { nom: 'Mastic sanitaire blanc', prix: 5.80 }] }
  ]},
  { nom: 'Électricité', icone: 'lightning-charge', sousSections: [
    { nom: 'Dominos & gaines ICTA', produits: [{ nom: 'Dominos électriques (x12)', prix: 2.90 }, { nom: 'Gaine ICTA Ø16 (5m)', prix: 4.50 }] },
    { nom: 'Câbles courts', produits: [{ nom: 'Câble électrique 3G1,5 (5m)', prix: 6.80 }] },
    { nom: 'Prises & interrupteurs', produits: [{ nom: 'Prise 2P+T saillie', prix: 5.40 }, { nom: 'Interrupteur va-et-vient', prix: 6.20 }] },
    { nom: 'Scotch isolant', produits: [{ nom: 'Scotch isolant (x5 couleurs)', prix: 3.90 }] }
  ]},
  { nom: 'Menuiserie & Serrurerie', icone: 'wrench', sousSections: [
    { nom: 'Vis à bois & chevilles', produits: [{ nom: 'Vis à bois x200 (4x40)', prix: 8.10 }, { nom: 'Chevilles nylon x100', prix: 4.30 }] },
    { nom: 'Charnières & poignées', produits: [{ nom: 'Charnières invisibles (x2)', prix: 6.90 }, { nom: 'Poignée de porte inox', prix: 9.80 }] },
    { nom: 'Colle bois', produits: [{ nom: 'Colle à bois 250g', prix: 4.60 }] },
    { nom: 'Mèches & lames', produits: [{ nom: 'Set mèches à bois (x10)', prix: 11.90 }, { nom: 'Lame scie sauteuse bois (x5)', prix: 7.20 }] }
  ]},
  { nom: 'Carrelage & Revêtements', icone: 'grid-3x3', sousSections: [
    { nom: 'Colle carrelage', produits: [{ nom: 'Colle carrelage sac 5kg', prix: 9.90 }] },
    { nom: 'Croisillons', produits: [{ nom: 'Croisillons 2mm (x250)', prix: 3.50 }] },
    { nom: 'Joints', produits: [{ nom: 'Joint de carrelage 1kg (gris)', prix: 6.70 }] },
    { nom: 'Mastic silicone', produits: [{ nom: 'Mastic silicone sanitaire', prix: 5.80 }] }
  ]},
  { nom: 'Couverture & Étanchéité', icone: 'house', sousSections: [
    { nom: 'Pointes & crochets de tuile', produits: [{ nom: 'Crochets de tuile (x50)', prix: 7.40 }, { nom: 'Pointes torsadées (x100)', prix: 4.90 }] },
    { nom: 'Mastic bitumineux', produits: [{ nom: 'Mastic bitumineux 310ml', prix: 6.50 }] },
    { nom: 'Membrane petit format', produits: [{ nom: 'Membrane EPDM 1x2m', prix: 14.90 }] },
    { nom: 'Vis toiture', produits: [{ nom: 'Vis toiture auto-perceuses (x50)', prix: 9.20 }] }
  ]},
  { nom: 'Chauffage & Climatisation', icone: 'fan', sousSections: [
    { nom: 'Colliers & raccords', produits: [{ nom: 'Colliers de fixation gaine (x10)', prix: 5.10 }] },
    { nom: 'Joints', produits: [{ nom: 'Joints VMC (x10)', prix: 3.30 }] },
    { nom: 'Filtres', produits: [{ nom: 'Filtre VMC standard', prix: 8.90 }] },
    { nom: 'Gaines flexibles courtes', produits: [{ nom: 'Gaine flexible Ø125 (1m)', prix: 6.40 }] }
  ]}
]

const livreurCourant = { nom: 'Léa R.', vehicule: 'Scooter' }

const COURSES_INITIALES = [
  { client: 'Chantier Dupont', adresse: '12 rue des Tilleuls', prix: 6.90, statut: 'À livrer' },
  { client: 'Chantier Martin', adresse: '8 impasse des Forges', prix: 5.40, statut: 'À livrer' },
  { client: 'Chantier Leroy', adresse: '5 rue de la Gare', prix: 8.20, statut: 'À livrer' }
]

const STATUTS = ['À livrer', 'En cours', 'Livrée']

function App() {
  const [appActive, setAppActive] = useState('client')

  const [vue, setVue] = useState('accueil')
  const [metierActif, setMetierActif] = useState(null)
  const [sousSectionActive, setSousSectionActive] = useState(null)
  const [panier, setPanier] = useState([])
  const [recapCommande, setRecapCommande] = useState('')

  const [courses, setCourses] = useState(COURSES_INITIALES)
  const [courseSelectionnee, setCourseSelectionnee] = useState(null)

  const total = panier.reduce((somme, produit) => somme + produit.prix, 0)

  function ouvrirMetier(metier) {
    setMetierActif(metier)
    setVue('metier')
  }

  function ouvrirSousSection(sousSection) {
    setSousSectionActive(sousSection)
    setVue('sousSection')
  }

  function ajouterAuPanier(produit) {
    setPanier([...panier, produit])
  }

  function retirerDuPanier(index) {
    setPanier(panier.filter((_, i) => i !== index))
  }

  function validerCommande() {
    if (panier.length === 0) {
      alert('Votre panier est vide.')
      return
    }
    setRecapCommande(panier.length + ' article(s) pour un total de ' + total.toFixed(2) + ' €')
    setPanier([])
    setVue('commande')
  }

  function retourAccueil() {
    setVue('accueil')
    setMetierActif(null)
    setSousSectionActive(null)
  }

  function avancerStatut(index) {
    setCourses(courses.map((course, i) => {
      if (i !== index) return course
      const indexStatut = STATUTS.indexOf(course.statut)
      if (indexStatut < STATUTS.length - 1) {
        return { ...course, statut: STATUTS[indexStatut + 1] }
      }
      return course
    }))
  }

  return (
    <div className="app">
      <div className="switch-app">
        <button className={appActive === 'client' ? 'actif' : ''} onClick={() => setAppActive('client')}>Client</button>
        <button className={appActive === 'livreur' ? 'actif' : ''} onClick={() => setAppActive('livreur')}>Livreur</button>
      </div>

      <div className="logo">
        <span className="lettre">C</span>
        <span className="chiffre">2</span>
      </div>
      <p className="slogan">Du rayon au chantier, en un clic.</p>

      {appActive === 'client' && (
        <>
          {vue === 'accueil' && (
            <>
              <h3>Corps de métier</h3>
              <ul className="liste-metiers">
                {metiers.map((metier) => (
                  <li key={metier.nom} onClick={() => ouvrirMetier(metier)}>
                    <span className="icon"><i className={`bi bi-${metier.icone}`}></i></span>
                    <span>{metier.nom}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {vue === 'metier' && (
            <>
              <p className="retour" onClick={retourAccueil}>← Retour</p>
              <h3>{metierActif.nom}</h3>
              <ul className="liste-metiers">
                {metierActif.sousSections.map((sousSection) => (
                  <li key={sousSection.nom} onClick={() => ouvrirSousSection(sousSection)}>
                    <span>{sousSection.nom}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {vue === 'sousSection' && (
            <>
              <p className="retour" onClick={() => setVue('metier')}>← Retour</p>
              <h3>{sousSectionActive.nom}</h3>
              <ul className="liste-produits">
                {sousSectionActive.produits.map((produit) => (
                  <li key={produit.nom}>
                    <span>{produit.nom}</span>
                    <span className="prix">{produit.prix.toFixed(2)} €</span>
                    <button onClick={() => ajouterAuPanier(produit)}>Ajouter</button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {vue === 'panier' && (
            <>
              <p className="retour" onClick={retourAccueil}>← Retour</p>
              <h3>Mon panier</h3>
              <ul className="liste-produits">
                {panier.map((produit, index) => (
                  <li key={index}>
                    <span>{produit.nom} — {produit.prix.toFixed(2)} €</span>
                    <button onClick={() => retirerDuPanier(index)}>Retirer</button>
                  </li>
                ))}
              </ul>
              <p className="total-panier">Total : {total.toFixed(2)} €</p>
              <button className="valider" onClick={validerCommande}>Valider la commande</button>
            </>
          )}

          {vue === 'commande' && (
            <>
              <h3>Commande confirmée</h3>
              <p>{recapCommande}</p>
              <p className="slogan">Merci, votre commande a bien été enregistrée.</p>
              <p className="retour" onClick={retourAccueil}>← Retour à l'accueil</p>
            </>
          )}

          {vue !== 'panier' && vue !== 'commande' && (
            <div className="barre-panier" onClick={() => setVue('panier')}>
              Panier : {panier.length} article(s) — {total.toFixed(2)} €
            </div>
          )}
        </>
      )}

      {appActive === 'livreur' && (
        <>
          {courseSelectionnee === null && (
            <>
              <h3>Mes courses</h3>
              <p className="slogan">{livreurCourant.nom} — {livreurCourant.vehicule}</p>
              <ul className="liste-courses">
                {courses.map((course, index) => (
                  <li key={index} onClick={() => setCourseSelectionnee(index)}>
                    <span>{course.client}<br /><span className="souligne">{course.adresse} — {course.statut}</span></span>
                    <span className="prix">{course.prix.toFixed(2)} €</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {courseSelectionnee !== null && (
            <>
              <p className="retour" onClick={() => setCourseSelectionnee(null)}>← Retour</p>
              <h3>{courses[courseSelectionnee].client}</h3>
              <p className="slogan">{courses[courseSelectionnee].adresse}</p>
              <p className="total-panier">{courses[courseSelectionnee].prix.toFixed(2)} €</p>
              <p className="statut-badge">{courses[courseSelectionnee].statut}</p>
              <button
                className="valider"
                disabled={courses[courseSelectionnee].statut === 'Livrée'}
                onClick={() => avancerStatut(courseSelectionnee)}
              >
                {courses[courseSelectionnee].statut === 'Livrée' ? 'Course livrée' : 'Faire avancer le statut'}
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}

export default App