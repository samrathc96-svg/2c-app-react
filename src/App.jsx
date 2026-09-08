import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import './App.css'

const iconsParMetier = {
  'Maçonnerie & Gros œuvre': 'bricks',
  'Plâtrerie & Cloisons': 'layers',
  'Peinture & Finitions': 'brush',
  'Plomberie & Sanitaire': 'droplet',
  'Électricité': 'lightning-charge',
  'Menuiserie & Serrurerie': 'wrench',
  'Carrelage & Revêtements': 'grid-3x3',
  'Couverture & Étanchéité': 'house',
  'Chauffage & Climatisation': 'fan'
}

function grouperProduits(lignes) {
  const parMetier = {}

  lignes.forEach((ligne) => {
    if (!parMetier[ligne.metier]) {
      parMetier[ligne.metier] = {}
    }
    if (!parMetier[ligne.metier][ligne.sous_section]) {
      parMetier[ligne.metier][ligne.sous_section] = []
    }
    parMetier[ligne.metier][ligne.sous_section].push({ nom: ligne.nom, prix: ligne.prix })
  })

  return Object.keys(parMetier).map((nomMetier) => ({
    nom: nomMetier,
    icone: iconsParMetier[nomMetier] || 'question-circle',
    sousSections: Object.keys(parMetier[nomMetier]).map((nomSousSection) => ({
      nom: nomSousSection,
      produits: parMetier[nomMetier][nomSousSection]
    }))
  }))
}

const livreurCourant = { nom: 'Léa R.', vehicule: 'Scooter' }

const STATUTS = ['À livrer', 'En cours', 'Livrée']

function App() {
  const [appActive, setAppActive] = useState('client')

  const [metiers, setMetiers] = useState([])
  const [chargement, setChargement] = useState(true)

  const [vue, setVue] = useState('accueil')
  const [metierActif, setMetierActif] = useState(null)
  const [sousSectionActive, setSousSectionActive] = useState(null)
  const [panier, setPanier] = useState([])
  const [recapCommande, setRecapCommande] = useState('')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)

  const [courses, setCourses] = useState([])
  const [chargementCourses, setChargementCourses] = useState(true)
  const [courseSelectionnee, setCourseSelectionnee] = useState(null)

  const total = panier.reduce((somme, produit) => somme + produit.prix, 0)

  useEffect(() => {
    async function chargerProduits() {
      const { data, error } = await supabase.from('produits').select('*')
      if (error) {
        console.error('Erreur de chargement :', error)
      } else {
        setMetiers(grouperProduits(data))
      }
      setChargement(false)
    }
    chargerProduits()
  }, [])

  useEffect(() => {
    async function chargerCourses() {
      const { data, error } = await supabase.from('courses').select('*')
      if (error) {
        console.error('Erreur de chargement des courses :', error)
      } else {
        setCourses(data)
      }
      setChargementCourses(false)
    }
    chargerCourses()
  }, [])

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

  async function validerCommande() {
    if (panier.length === 0) {
      alert('Votre panier est vide.')
      return
    }

    setEnvoiEnCours(true)

    const listeProduits = panier.map((produit) => produit.nom).join(', ')

    const { error } = await supabase.from('commandes').insert({
      produits: listeProduits,
      total: total
    })

    setEnvoiEnCours(false)

    if (error) {
      console.error("Erreur d'enregistrement de la commande :", error)
      alert("Une erreur est survenue, la commande n'a pas pu être enregistrée.")
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

  async function avancerStatut(index) {
    const course = courses[index]
    const indexStatut = STATUTS.indexOf(course.statut)
    if (indexStatut >= STATUTS.length - 1) {
      return
    }
    const nouveauStatut = STATUTS[indexStatut + 1]

    const { error } = await supabase
      .from('courses')
      .update({ statut: nouveauStatut })
      .eq('id', course.id)

    if (error) {
      console.error('Erreur de mise a jour du statut :', error)
      return
    }

    setCourses(courses.map((c, i) => (i === index ? { ...c, statut: nouveauStatut } : c)))
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
          {chargement && <p className="slogan">Chargement des produits...</p>}

          {!chargement && vue === 'accueil' && (
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
              <button className="valider" disabled={envoiEnCours} onClick={validerCommande}>
                {envoiEnCours ? 'Envoi en cours...' : 'Valider la commande'}
              </button>
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
          {chargementCourses && <p className="slogan">Chargement des courses...</p>}

          {!chargementCourses && courseSelectionnee === null && (
            <>
              <h3>Mes courses</h3>
              <p className="slogan">{livreurCourant.nom} — {livreurCourant.vehicule}</p>
              <ul className="liste-courses">
                {courses.map((course, index) => (
                  <li key={course.id} onClick={() => setCourseSelectionnee(index)}>
                    <span>{course.client}<br /><span className="souligne">{course.adresse} — {course.statut}</span></span>
                    <span className="prix">{course.prix.toFixed(2)} €</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!chargementCourses && courseSelectionnee !== null && (
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