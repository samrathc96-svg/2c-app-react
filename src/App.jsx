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
  const [session, setSession] = useState(null)
  const [role, setRole] = useState(null)
  const [chargementAuth, setChargementAuth] = useState(true)
  const [modeAuth, setModeAuth] = useState('connexion')
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [roleChoisi, setRoleChoisi] = useState('client')
  const [erreurAuth, setErreurAuth] = useState('')

  const [appActive, setAppActive] = useState('client')

  const [metiers, setMetiers] = useState([])
  const [chargement, setChargement] = useState(true)

  const [vue, setVue] = useState('accueil')
  const [metierActif, setMetierActif] = useState(null)
  const [sousSectionActive, setSousSectionActive] = useState(null)
  const [panier, setPanier] = useState([])
  const [recapCommande, setRecapCommande] = useState('')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const [nomClient, setNomClient] = useState('')
  const [adresseClient, setAdresseClient] = useState('')

  const [courses, setCourses] = useState([])
  const [chargementCourses, setChargementCourses] = useState(true)
  const [courseSelectionnee, setCourseSelectionnee] = useState(null)

  const total = panier.reduce((somme, produit) => somme + produit.prix, 0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (!session) setChargementAuth(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) {
        setRole(null)
        setChargementAuth(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    async function chargerRole() {
      if (!session) return
      const { data, error } = await supabase
        .from('profils')
        .select('role')
        .eq('id', session.user.id)
        .single()

      if (!error && data) {
        setRole(data.role)
        setAppActive(data.role)
      }
      setChargementAuth(false)
    }
    chargerRole()
  }, [session])

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

  async function connexion() {
    setErreurAuth('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse })
    if (error) {
      setErreurAuth(error.message)
    }
  }

  async function inscription() {
    setErreurAuth('')
    const { data, error } = await supabase.auth.signUp({ email, password: motDePasse })
    if (error) {
      setErreurAuth(error.message)
      return
    }
    if (data.user) {
      const { error: erreurProfil } = await supabase
        .from('profils')
        .insert({ id: data.user.id, role: roleChoisi })
      if (erreurProfil) {
        setErreurAuth(erreurProfil.message)
      }
    }
  }

  async function deconnexion() {
    await supabase.auth.signOut()
    setEmail('')
    setMotDePasse('')
  }

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
    if (nomClient.trim() === '' || adresseClient.trim() === '') {
      alert("Merci de renseigner le nom du client et l'adresse de livraison.")
      return
    }

    setEnvoiEnCours(true)

    const listeProduits = panier.map((produit) => produit.nom).join(', ')

    const { error: erreurCommande } = await supabase.from('commandes').insert({
      produits: listeProduits,
      total: total
    })

    if (erreurCommande) {
      console.error("Erreur d'enregistrement de la commande :", erreurCommande)
      setEnvoiEnCours(false)
      alert("Une erreur est survenue, la commande n'a pas pu être enregistrée.")
      return
    }

    const { data: nouvelleCourse, error: erreurCourse } = await supabase
      .from('courses')
      .insert({
        client: nomClient,
        adresse: adresseClient,
        produits: listeProduits,
        statut: 'À livrer',
        prix: total
      })
      .select()
      .single()

    setEnvoiEnCours(false)

    if (erreurCourse) {
      console.error('Erreur de creation de la course :', erreurCourse)
    } else {
      setCourses([...courses, nouvelleCourse])
    }

    setRecapCommande(panier.length + ' article(s) pour un total de ' + total.toFixed(2) + ' €')
    setPanier([])
    setNomClient('')
    setAdresseClient('')
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
      {chargementAuth && <p className="slogan">Chargement...</p>}

      {!chargementAuth && !session && (
        <>
          <div className="logo">
            <span className="lettre">C</span>
            <span className="chiffre">2</span>
          </div>
          <p className="slogan">Du rayon au chantier, en un clic.</p>

          <div className="switch-app">
            <button className={modeAuth === 'connexion' ? 'actif' : ''} onClick={() => setModeAuth('connexion')}>Connexion</button>
            <button className={modeAuth === 'inscription' ? 'actif' : ''} onClick={() => setModeAuth('inscription')}>Inscription</button>
          </div>

          <div className="champ-livraison">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              placeholder="Mot de passe"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
            />
          </div>

          {modeAuth === 'inscription' && (
            <div className="switch-app">
              <button className={roleChoisi === 'client' ? 'actif' : ''} onClick={() => setRoleChoisi('client')}>Je suis client</button>
              <button className={roleChoisi === 'livreur' ? 'actif' : ''} onClick={() => setRoleChoisi('livreur')}>Je suis livreur</button>
            </div>
          )}

          {erreurAuth && <p className="souligne">{erreurAuth}</p>}

          <button className="valider" onClick={modeAuth === 'connexion' ? connexion : inscription}>
            {modeAuth === 'connexion' ? 'Se connecter' : "S'inscrire"}
          </button>
        </>
      )}

      {!chargementAuth && session && !role && (
        <>
          <p className="slogan">Impossible de charger votre profil.</p>
          <button className="valider" onClick={deconnexion}>Se déconnecter</button>
        </>
      )}

      {!chargementAuth && session && role && (
        <>
          <div className="barre-compte">
            <span className="souligne">{session.user.email} — {role === 'client' ? 'Client' : 'Livreur'}</span>
            <button onClick={deconnexion}>Déconnexion</button>
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
                  <div className="champ-livraison">
                    <input
                      type="text"
                      placeholder="Nom du client"
                      value={nomClient}
                      onChange={(e) => setNomClient(e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Adresse de livraison"
                      value={adresseClient}
                      onChange={(e) => setAdresseClient(e.target.value)}
                    />
                  </div>
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
        </>
      )}
    </div>
  )
}

export default App