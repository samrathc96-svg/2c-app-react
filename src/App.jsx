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

function retirerAccents(texte) {
  return texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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
  const [afficherAuth, setAfficherAuth] = useState(false)
  const [espace, setEspace] = useState('catalogue')

  const [emailConnexion, setEmailConnexion] = useState('')
  const [motDePasseConnexion, setMotDePasseConnexion] = useState('')
  const [erreurConnexion, setErreurConnexion] = useState('')

  const [emailInscription, setEmailInscription] = useState('')
  const [motDePasseInscription, setMotDePasseInscription] = useState('')
  const [roleChoisi, setRoleChoisi] = useState('client')
  const [erreurInscription, setErreurInscription] = useState('')

  const [metiers, setMetiers] = useState([])
  const [chargement, setChargement] = useState(true)
  const [recherche, setRecherche] = useState('')

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

  const [mesCommandes, setMesCommandes] = useState([])
  const [chargementCommandes, setChargementCommandes] = useState(true)
  const [commandeSelectionnee, setCommandeSelectionnee] = useState(null)

  const [notification, setNotification] = useState(null)

  const total = panier.reduce((somme, produit) => somme + produit.prix, 0)

  const metiersFiltres = metiers.filter((metier) =>
    retirerAccents(metier.nom.toLowerCase()).includes(retirerAccents(recherche.toLowerCase()))
  )

  useEffect(() => {
    if (!notification) return
    const minuteur = setTimeout(() => setNotification(null), 3500)
    return () => clearTimeout(minuteur)
  }, [notification])

  function afficherNotification(message, type = 'erreur') {
    setNotification({ message, type })
  }

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
        setEspace(data.role === 'livreur' ? 'livreur' : 'catalogue')
        setAfficherAuth(false)
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

  useEffect(() => {
    async function chargerCommandes() {
      if (!session) {
        setMesCommandes([])
        setChargementCommandes(false)
        return
      }
      const { data, error } = await supabase
        .from('commandes')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Erreur de chargement des commandes :', error)
      } else {
        setMesCommandes(data)
      }
      setChargementCommandes(false)
    }
    chargerCommandes()
  }, [session])

  async function connexion() {
    setErreurConnexion('')
    const { error } = await supabase.auth.signInWithPassword({
      email: emailConnexion,
      password: motDePasseConnexion
    })
    if (error) {
      setErreurConnexion(error.message)
    }
  }

  async function inscription() {
    setErreurInscription('')
    const { data, error } = await supabase.auth.signUp({
      email: emailInscription,
      password: motDePasseInscription
    })
    if (error) {
      setErreurInscription(error.message)
      return
    }
    if (data.user) {
      const { error: erreurProfil } = await supabase
        .from('profils')
        .insert({ id: data.user.id, role: roleChoisi })
      if (erreurProfil) {
        setErreurInscription(erreurProfil.message)
      }
    }
  }

  async function deconnexion() {
    await supabase.auth.signOut()
    setEmailConnexion('')
    setMotDePasseConnexion('')
    setEmailInscription('')
    setMotDePasseInscription('')
    setEspace('catalogue')
    setAfficherAuth(false)
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

  function statutCommande(commandeId) {
    const course = courses.find((c) => c.commande_id === commandeId)
    return course ? course.statut : 'À livrer'
  }

  async function validerCommande() {
    if (panier.length === 0) {
      afficherNotification('Votre panier est vide.')
      return
    }
    if (nomClient.trim() === '' || adresseClient.trim() === '') {
      afficherNotification("Merci de renseigner le nom du client et l'adresse de livraison.")
      return
    }

    setEnvoiEnCours(true)

    const listeProduits = panier.map((produit) => produit.nom).join(', ')

    const { data: nouvelleCommande, error: erreurCommande } = await supabase
      .from('commandes')
      .insert({
        produits: listeProduits,
        total: total,
        user_id: session ? session.user.id : null
      })
      .select()
      .single()

    if (erreurCommande) {
      console.error("Erreur d'enregistrement de la commande :", erreurCommande)
      setEnvoiEnCours(false)
      afficherNotification("Une erreur est survenue, la commande n'a pas pu être enregistrée.")
      return
    }

    if (session && nouvelleCommande) {
      setMesCommandes([nouvelleCommande, ...mesCommandes])
    }

    const { data: nouvelleCourse, error: erreurCourse } = await supabase
      .from('courses')
      .insert({
        client: nomClient,
        adresse: adresseClient,
        produits: listeProduits,
        statut: 'À livrer',
        prix: total,
        commande_id: nouvelleCommande.id
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
      {notification && (
        <div className={`notification notification-${notification.type}`}>
          {notification.message}
        </div>
      )}

      <div className="barre-compte-haut">
        <button className="lien-compte" onClick={() => setAfficherAuth(true)}>
          {session ? (role === 'livreur' ? 'Livreur' : 'Mon compte') : 'Connexion / Inscription'}
        </button>
        <button className="icone-compte" onClick={() => setAfficherAuth(true)}>
          <i className={`bi ${session ? 'bi-person-check-fill' : 'bi-person-circle'}`}></i>
        </button>
      </div>

      <div className="logo">
        <span className="lettre">C</span>
        <span className="chiffre">2</span>
      </div>
      <div className="separateur-un"></div>
      <p className="slogan">Du rayon au chantier, en un clic.</p>

      {afficherAuth && (
        <div className="overlay-auth" onClick={() => setAfficherAuth(false)}>
          <div className="panneau-auth" onClick={(e) => e.stopPropagation()}>
            <button className="fermer-auth" onClick={() => setAfficherAuth(false)}>✕</button>

            {chargementAuth && (
              <div className="skeleton-liste">
                <div className="skeleton-ligne skeleton-courte"></div>
              </div>
            )}

            {!chargementAuth && !session && (
              <div className="cartes-auth">
                <div className="carte-auth">
                  <h3>Connexion</h3>
                  <input
                    type="email"
                    placeholder="Email"
                    value={emailConnexion}
                    onChange={(e) => setEmailConnexion(e.target.value)}
                  />
                  <input
                    type="password"
                    placeholder="Mot de passe"
                    value={motDePasseConnexion}
                    onChange={(e) => setMotDePasseConnexion(e.target.value)}
                  />
                  {erreurConnexion && <p className="souligne">{erreurConnexion}</p>}
                  <button className="valider" onClick={connexion}>Se connecter</button>
                </div>

                <div className="carte-auth">
                  <h3>Inscription</h3>
                  <input
                    type="email"
                    placeholder="Email"
                    value={emailInscription}
                    onChange={(e) => setEmailInscription(e.target.value)}
                  />
                  <input
                    type="password"
                    placeholder="Mot de passe"
                    value={motDePasseInscription}
                    onChange={(e) => setMotDePasseInscription(e.target.value)}
                  />
                  <div className="choix-role">
                    <button className={roleChoisi === 'client' ? 'actif' : ''} onClick={() => setRoleChoisi('client')}>Client</button>
                    <button className={roleChoisi === 'livreur' ? 'actif' : ''} onClick={() => setRoleChoisi('livreur')}>Livreur</button>
                  </div>
                  {erreurInscription && <p className="souligne">{erreurInscription}</p>}
                  <button className="valider" onClick={inscription}>S'inscrire</button>
                </div>
              </div>
            )}

            {!chargementAuth && session && (
              <div className="carte-auth">
                <p className="slogan">{session.user.email}</p>
                <p className="slogan">Rôle : {role === 'livreur' ? 'Livreur' : 'Client'}</p>
                {role === 'livreur' && espace !== 'livreur' && (
                  <button className="valider" onClick={() => { setEspace('livreur'); setAfficherAuth(false) }}>
                    Aller à mon espace livreur
                  </button>
                )}
                {espace === 'livreur' && (
                  <button className="valider" onClick={() => { setEspace('catalogue'); setAfficherAuth(false) }}>
                    Voir le catalogue
                  </button>
                )}
                {espace !== 'mesCommandes' && (
                  <button className="valider" onClick={() => { setEspace('mesCommandes'); setCommandeSelectionnee(null); setAfficherAuth(false) }}>
                    Voir mes commandes
                  </button>
                )}
                <button className="valider" onClick={deconnexion}>Se déconnecter</button>
              </div>
            )}
          </div>
        </div>
      )}

      {espace === 'catalogue' && (
        <>
          {chargement && (
            <div className="skeleton-liste">
              <div className="skeleton-ligne"></div>
              <div className="skeleton-ligne"></div>
              <div className="skeleton-ligne"></div>
              <div className="skeleton-ligne"></div>
            </div>
          )}

          {!chargement && vue === 'accueil' && (
            <>
              <h3 className="titre-accueil">Corps de métier</h3>
              <input
                type="text"
                className="barre-recherche"
                placeholder="Rechercher un métier..."
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
              <ul className="liste-metiers">
                {metiersFiltres.map((metier) => (
                  <li key={metier.nom} onClick={() => ouvrirMetier(metier)}>
                    <span className="icon"><i className={`bi bi-${metier.icone}`}></i></span>
                    <span>{metier.nom}</span>
                  </li>
                ))}
              </ul>
              {metiersFiltres.length === 0 && (
                <p className="aucun-resultat">Aucun métier trouvé pour cette recherche.</p>
              )}
            </>
          )}

          {vue === 'metier' && (
            <>
              <div className="fil-ariane">
                <span onClick={retourAccueil}>Accueil</span>
                <span className="separateur-fil">›</span>
                <span className="actif">{metierActif.nom}</span>
              </div>
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
              <div className="fil-ariane">
                <span onClick={retourAccueil}>Accueil</span>
                <span className="separateur-fil">›</span>
                <span onClick={() => setVue('metier')}>{metierActif.nom}</span>
                <span className="separateur-fil">›</span>
                <span className="actif">{sousSectionActive.nom}</span>
              </div>
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

      {espace === 'mesCommandes' && (
        <>
          <p className="retour" onClick={() => { setEspace('catalogue'); setCommandeSelectionnee(null) }}>← Retour au catalogue</p>

          {chargementCommandes && (
            <div className="skeleton-liste">
              <div className="skeleton-ligne"></div>
              <div className="skeleton-ligne"></div>
            </div>
          )}

          {!chargementCommandes && mesCommandes.length === 0 && (
            <>
              <h3>Mes commandes</h3>
              <p className="aucun-resultat">Vous n'avez pas encore passé de commande.</p>
            </>
          )}

          {!chargementCommandes && mesCommandes.length > 0 && commandeSelectionnee === null && (
            <>
              <h3>Mes commandes</h3>
              <ul className="liste-produits">
                {mesCommandes.map((commande, index) => (
                  <li key={commande.id} onClick={() => setCommandeSelectionnee(index)}>
                    <span>
                      {commande.produits}
                      <br />
                      <span className="souligne">
                        {new Date(commande.created_at).toLocaleDateString('fr-FR', {
                          day: 'numeric',
                          month: 'long',
                          hour: '2-digit',
                          minute: '2-digit'
                        })} — {statutCommande(commande.id)}
                      </span>
                    </span>
                    <span className="prix">{commande.total.toFixed(2)} €</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!chargementCommandes && commandeSelectionnee !== null && (
            <>
              <p className="retour" onClick={() => setCommandeSelectionnee(null)}>← Retour</p>
              <h3>Détail de la commande</h3>
              <p className="slogan">{mesCommandes[commandeSelectionnee].produits}</p>
              <p className="total-panier">{mesCommandes[commandeSelectionnee].total.toFixed(2)} €</p>

              <div className="stepper-statut">
                <div className={`point-statut ${STATUTS.indexOf(statutCommande(mesCommandes[commandeSelectionnee].id)) >= 0 ? 'complete' : ''}`}></div>
                <div className={`ligne-statut ${STATUTS.indexOf(statutCommande(mesCommandes[commandeSelectionnee].id)) >= 1 ? 'complete' : ''}`}></div>
                <div className={`point-statut ${STATUTS.indexOf(statutCommande(mesCommandes[commandeSelectionnee].id)) >= 1 ? 'complete' : ''}`}></div>
                <div className={`ligne-statut ${STATUTS.indexOf(statutCommande(mesCommandes[commandeSelectionnee].id)) >= 2 ? 'complete' : ''}`}></div>
                <div className={`point-statut ${STATUTS.indexOf(statutCommande(mesCommandes[commandeSelectionnee].id)) >= 2 ? 'complete' : ''}`}></div>

                <div className={`label-statut ${statutCommande(mesCommandes[commandeSelectionnee].id) === 'À livrer' ? 'actuelle' : ''}`}>À livrer</div>
                <div></div>
                <div className={`label-statut ${statutCommande(mesCommandes[commandeSelectionnee].id) === 'En cours' ? 'actuelle' : ''}`}>En cours</div>
                <div></div>
                <div className={`label-statut ${statutCommande(mesCommandes[commandeSelectionnee].id) === 'Livrée' ? 'actuelle' : ''}`}>Livrée</div>
              </div>
            </>
          )}
        </>
      )}

      {espace === 'livreur' && role === 'livreur' && (
        <>
          <p className="retour" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>

          {chargementCourses && (
            <div className="skeleton-liste">
              <div className="skeleton-ligne"></div>
              <div className="skeleton-ligne"></div>
              <div className="skeleton-ligne"></div>
            </div>
          )}

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

              <div className="stepper-statut">
                <div className={`point-statut ${STATUTS.indexOf(courses[courseSelectionnee].statut) >= 0 ? 'complete' : ''}`}></div>
                <div className={`ligne-statut ${STATUTS.indexOf(courses[courseSelectionnee].statut) >= 1 ? 'complete' : ''}`}></div>
                <div className={`point-statut ${STATUTS.indexOf(courses[courseSelectionnee].statut) >= 1 ? 'complete' : ''}`}></div>
                <div className={`ligne-statut ${STATUTS.indexOf(courses[courseSelectionnee].statut) >= 2 ? 'complete' : ''}`}></div>
                <div className={`point-statut ${STATUTS.indexOf(courses[courseSelectionnee].statut) >= 2 ? 'complete' : ''}`}></div>

                <div className={`label-statut ${courses[courseSelectionnee].statut === 'À livrer' ? 'actuelle' : ''}`}>À livrer</div>
                <div></div>
                <div className={`label-statut ${courses[courseSelectionnee].statut === 'En cours' ? 'actuelle' : ''}`}>En cours</div>
                <div></div>
                <div className={`label-statut ${courses[courseSelectionnee].statut === 'Livrée' ? 'actuelle' : ''}`}>Livrée</div>
              </div>

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
