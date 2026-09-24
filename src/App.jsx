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

const iconsParSousSection = {
  'Visserie & Fixation': 'tools',
  'Équerres & Profilés': 'bounding-box',
  'Colliers & Agrafes': 'link-45deg',
  'Silicone & Adhésifs': 'droplet-half',
  'Isolation compacte': 'layers',
  'Gaines & Raccords': 'wind',
  'Supportage': 'diagram-3',
  'Gaines Quadratique': 'square',
  'Finition & Diffusion': 'sliders'
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
    parMetier[ligne.metier][ligne.sous_section].push({ id: ligne.id, nom: ligne.nom, prix: ligne.prix })
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

const STATUTS = ['À livrer', 'En cours', 'Livrée']

function App() {
  const [session, setSession] = useState(null)
  const [role, setRole] = useState(null)
  const [chargementAuth, setChargementAuth] = useState(true)
  const [afficherAuth, setAfficherAuth] = useState(false)
  const [afficherMenu, setAfficherMenu] = useState(false)
  const [espace, setEspace] = useState('catalogue')

  const [emailConnexion, setEmailConnexion] = useState('')
  const [motDePasseConnexion, setMotDePasseConnexion] = useState('')
  const [erreurConnexion, setErreurConnexion] = useState('')

  const [afficherMotDePasseOublie, setAfficherMotDePasseOublie] = useState(false)
  const [emailOubli, setEmailOubli] = useState('')
  const [erreurOubli, setErreurOubli] = useState('')
  const [messageOubli, setMessageOubli] = useState('')
  const [envoiOubliEnCours, setEnvoiOubliEnCours] = useState(false)

  const [modeReinitialisation, setModeReinitialisation] = useState(false)
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState('')
  const [confirmationNouveauMotDePasse, setConfirmationNouveauMotDePasse] = useState('')
  const [erreurReinitialisation, setErreurReinitialisation] = useState('')

  const [emailInscription, setEmailInscription] = useState('')
  const [motDePasseInscription, setMotDePasseInscription] = useState('')
  const [nomInscription, setNomInscription] = useState('')
  const [roleChoisi, setRoleChoisi] = useState('client')
  const [erreurInscription, setErreurInscription] = useState('')
  const [messageInscription, setMessageInscription] = useState('')

  const [nomUtilisateur, setNomUtilisateur] = useState('')
  const [livreurs, setLivreurs] = useState([])
  const [filtreAdmin, setFiltreAdmin] = useState('toutes')
  const [rechercheAdmin, setRechercheAdmin] = useState('')

  const [metiers, setMetiers] = useState([])
  const [produitsBruts, setProduitsBruts] = useState([])
  const [chargement, setChargement] = useState(true)
  const [recherche, setRecherche] = useState('')

  const [nouveauSousSection, setNouveauSousSection] = useState('')
  const [nouveauNomProduit, setNouveauNomProduit] = useState('')
  const [nouveauPrixProduit, setNouveauPrixProduit] = useState('')
  const [erreurProduit, setErreurProduit] = useState('')
  const [rechercheProduitsAdmin, setRechercheProduitsAdmin] = useState('')
  const [editionProduitId, setEditionProduitId] = useState(null)
  const [editionSousSection, setEditionSousSection] = useState('')
  const [editionNomProduit, setEditionNomProduit] = useState('')
  const [editionPrixProduit, setEditionPrixProduit] = useState('')

  const [vue, setVue] = useState('accueil')
  const [sousSectionActive, setSousSectionActive] = useState(null)
  const [panier, setPanier] = useState([])
  const [recapCommande, setRecapCommande] = useState('')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const [nomClient, setNomClient] = useState('')
  const [adresseClient, setAdresseClient] = useState('')
  const [telephoneClient, setTelephoneClient] = useState('')
  const [emailClient, setEmailClient] = useState('')

  const [courses, setCourses] = useState([])
  const [chargementCourses, setChargementCourses] = useState(true)
  const [courseSelectionnee, setCourseSelectionnee] = useState(null)

  const [mesCommandes, setMesCommandes] = useState([])
  const [chargementCommandes, setChargementCommandes] = useState(true)
  const [commandeSelectionnee, setCommandeSelectionnee] = useState(null)
  const [confirmationAnnulation, setConfirmationAnnulation] = useState(false)

  const [commandeInvite, setCommandeInvite] = useState(null)
  const [numeroSuiviInvite, setNumeroSuiviInvite] = useState('')
  const [nomSuiviInvite, setNomSuiviInvite] = useState('')
  const [erreurSuivi, setErreurSuivi] = useState('')
  const [chargementSuivi, setChargementSuivi] = useState(false)
  const [commandesRecentesLocales, setCommandesRecentesLocales] = useState([])

  const [notification, setNotification] = useState(null)

  const total = panier.reduce((somme, produit) => somme + produit.prix * produit.quantite, 0)
  const nombreArticles = panier.reduce((somme, produit) => somme + produit.quantite, 0)

  const sousSectionsDisponibles = metiers.flatMap((metier) => metier.sousSections)
  const sousSectionsFiltrees = sousSectionsDisponibles.filter((sousSection) =>
    retirerAccents(sousSection.nom.toLowerCase()).includes(retirerAccents(recherche.toLowerCase()))
  )

  const produitsFiltresAdmin = produitsBruts.filter((produit) => {
    const cible = retirerAccents(`${produit.nom} ${produit.sous_section}`.toLowerCase())
    return cible.includes(retirerAccents(rechercheProduitsAdmin.toLowerCase()))
  })

  const coursesActives = courses.filter((course) => course.statut !== 'Livrée' && course.statut !== 'Annulée')
  const coursesLivrees = courses.filter((course) => course.statut === 'Livrée')

  const coursesDisponibles = coursesActives.filter((course) => !course.livreur_id)
  const coursesMoi = session ? coursesActives.filter((course) => course.livreur_id === session.user.id) : []
  const coursesLivreesMoi = session ? coursesLivrees.filter((course) => course.livreur_id === session.user.id) : []

  const coursesFiltreesStatut = filtreAdmin === 'toutes' ? courses : courses.filter((course) => course.statut === filtreAdmin)
  const coursesFiltreesAdmin = rechercheAdmin.trim() === ''
    ? coursesFiltreesStatut
    : coursesFiltreesStatut.filter((course) => {
        const cible = retirerAccents(`${course.client} ${course.adresse} ${course.produits} ${course.telephone || ''}`.toLowerCase())
        return cible.includes(retirerAccents(rechercheAdmin.toLowerCase()))
      })
  const statsAdmin = {
    total: courses.length,
    actives: coursesActives.length,
    livrees: coursesLivrees.length,
    annulees: courses.filter((course) => course.statut === 'Annulée').length,
    chiffreAffaires: courses.filter((course) => course.statut !== 'Annulée').reduce((somme, course) => somme + course.prix, 0)
  }

  useEffect(() => {
    if (!notification) return
    const minuteur = setTimeout(() => setNotification(null), 3500)
    return () => clearTimeout(minuteur)
  }, [notification])

  useEffect(() => {
    setConfirmationAnnulation(false)
  }, [commandeSelectionnee])

  function afficherNotification(message, type = 'erreur') {
    setNotification({ message, type })
  }

  useEffect(() => {
    try {
      const brut = window.localStorage.getItem('commandesRecentes2C')
      if (brut) setCommandesRecentesLocales(JSON.parse(brut))
    } catch (e) {
      // stockage indisponible (navigation privée, etc.) - on ignore silencieusement
    }
  }, [])

  function sauvegarderCommandeLocale(commande) {
    try {
      const brut = window.localStorage.getItem('commandesRecentes2C')
      const liste = brut ? JSON.parse(brut) : []
      const nouvelle = [
        {
          id: commande.id,
          numero_suivi: commande.numero_suivi,
          nom_client: commande.nom_client,
          produits: commande.produits,
          total: commande.total
        },
        ...liste.filter((c) => c.id !== commande.id)
      ].slice(0, 10)
      window.localStorage.setItem('commandesRecentes2C', JSON.stringify(nouvelle))
      setCommandesRecentesLocales(nouvelle)
    } catch (e) {
      // stockage indisponible - on ignore silencieusement
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (!session) setChargementAuth(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (_event === 'PASSWORD_RECOVERY') {
        setModeReinitialisation(true)
        setAfficherAuth(true)
      }
      if (!session) {
        setRole(null)
        setChargementAuth(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    async function gererLienRecuperation() {
      const parametres = new URLSearchParams(window.location.search)
      const code = parametres.get('code')
      if (!code) return

      // On échange juste le code contre une session ici. On NE décide
      // PAS nous-mêmes s'il s'agit d'une réinitialisation de mot de
      // passe : ce lien a le même format (?code=...) que le lien de
      // confirmation d'inscription, donc le confondre ouvrait le
      // formulaire "nouveau mot de passe" même après une simple
      // inscription. C'est l'écouteur PASSWORD_RECOVERY plus haut,
      // qui ne se déclenche que sur le vrai événement Supabase de
      // récupération, qui s'en charge correctement.
      await supabase.auth.exchangeCodeForSession(code)
      window.history.replaceState({}, document.title, window.location.pathname)
    }
    gererLienRecuperation()
  }, [])

  useEffect(() => {
    async function chargerRole() {
      if (!session) return
      const { data, error } = await supabase
        .from('profils')
        .select('role, nom')
        .eq('id', session.user.id)
        .single()

      if (!error && data) {
        setRole(data.role)
        setNomUtilisateur(data.nom || '')
        if (!modeReinitialisation) {
          setEspace(data.role === 'livreur' ? 'livreur' : data.role === 'admin' ? 'admin' : 'catalogue')
          setAfficherAuth(false)
        }
      }
      setChargementAuth(false)
    }
    chargerRole()
  }, [session, modeReinitialisation])

  useEffect(() => {
    if (role !== 'admin') return

    async function chargerLivreurs() {
      const { data, error } = await supabase.from('profils').select('id, nom').eq('role', 'livreur')
      if (!error && data) {
        setLivreurs(data)
      }
    }
    chargerLivreurs()

    const canal = supabase
      .channel('profils-en-direct')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profils' }, () => {
        chargerLivreurs()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [role])

  useEffect(() => {
    async function chargerProduits() {
      const { data, error } = await supabase.from('produits').select('*')
      if (error) {
        console.error('Erreur de chargement :', error)
      } else {
        setProduitsBruts(data)
        setMetiers(grouperProduits(data))
      }
      setChargement(false)
    }
    chargerProduits()
  }, [])

  useEffect(() => {
    async function chargerCourses() {
      // Sans compte, la base ne renvoie plus rien ici (voir la
      // sécurité des courses) : on ne demande donc la liste que si
      // quelqu'un est connecté. Un livreur/admin recevra toutes les
      // courses, un client uniquement les siennes — c'est la base de
      // données elle-même qui filtre, grâce aux règles de sécurité.
      if (!session) {
        setCourses([])
        setChargementCourses(false)
        return
      }
      const { data, error } = await supabase.from('courses').select('*')
      if (error) {
        console.error('Erreur de chargement des courses :', error)
      } else {
        setCourses(data)
      }
      setChargementCourses(false)
    }
    chargerCourses()
  }, [session])

  useEffect(() => {
    // Même logique pour le direct : inutile de s'abonner sans compte,
    // la base ne laissera de toute façon rien passer.
    if (!session) return

    const canal = supabase
      .channel('courses-en-direct')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setCourses((precedentes) =>
            precedentes.some((c) => c.id === payload.new.id) ? precedentes : [...precedentes, payload.new]
          )
        } else if (payload.eventType === 'UPDATE') {
          setCourses((precedentes) =>
            precedentes.map((c) => (c.id === payload.new.id ? payload.new : c))
          )
        } else if (payload.eventType === 'DELETE') {
          setCourses((precedentes) => precedentes.filter((c) => c.id !== payload.old.id))
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [session])

  useEffect(() => {
    const canal = supabase
      .channel('produits-en-direct')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'produits' }, (payload) => {
        setProduitsBruts((precedents) => {
          let nouveaux
          if (payload.eventType === 'INSERT') {
            nouveaux = precedents.some((p) => p.id === payload.new.id)
              ? precedents
              : [...precedents, payload.new]
          } else if (payload.eventType === 'UPDATE') {
            nouveaux = precedents.map((p) => (p.id === payload.new.id ? payload.new : p))
          } else if (payload.eventType === 'DELETE') {
            nouveaux = precedents.filter((p) => p.id !== payload.old.id)
          } else {
            nouveaux = precedents
          }
          setMetiers(grouperProduits(nouveaux))
          return nouveaux
        })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
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

  function messageErreurAuth(error) {
    const code = error?.code || ''
    const message = error?.message || ''

    if (code === 'user_already_exists' || message.includes('already registered')) {
      return 'Cet email est déjà associé à un compte. Essaie de te connecter, ou utilise "Mot de passe oublié ?" si besoin.'
    }
    if (code === 'weak_password' || message.includes('Password')) {
      return 'Le mot de passe est trop court ou trop simple (6 caractères minimum, évite les mots de passe trop courants).'
    }
    if (code === 'email_address_invalid' || message.toLowerCase().includes('invalid') && message.toLowerCase().includes('email')) {
      return "Cette adresse email n'est pas valide."
    }
    if (code === 'invalid_credentials') {
      return 'Email ou mot de passe incorrect.'
    }
    if (code === 'email_not_confirmed') {
      return "Confirme d'abord ton adresse email (vérifie ta boîte mail) avant de te connecter."
    }
    if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
      return 'Trop de tentatives, réessaie dans quelques minutes.'
    }
    return 'Une erreur est survenue, réessaie.'
  }

  async function connexion() {
    setErreurConnexion('')
    const { error } = await supabase.auth.signInWithPassword({
      email: emailConnexion,
      password: motDePasseConnexion
    })
    if (error) {
      setErreurConnexion(messageErreurAuth(error))
    }
  }

  async function demanderReinitialisation() {
    setErreurOubli('')
    setMessageOubli('')
    if (emailOubli.trim() === '') {
      setErreurOubli('Merci de renseigner ton email.')
      return
    }

    setEnvoiOubliEnCours(true)
    const { error } = await supabase.auth.resetPasswordForEmail(emailOubli.trim(), {
      redirectTo: window.location.origin
    })
    setEnvoiOubliEnCours(false)

    if (error) {
      setErreurOubli(messageErreurAuth(error))
      return
    }
    setMessageOubli('Si un compte existe avec cet email, un lien de réinitialisation vient de lui être envoyé.')
  }

  async function reinitialiserMotDePasse() {
    setErreurReinitialisation('')
    if (nouveauMotDePasse.length < 6) {
      setErreurReinitialisation('Le mot de passe doit contenir au moins 6 caractères.')
      return
    }
    if (nouveauMotDePasse !== confirmationNouveauMotDePasse) {
      setErreurReinitialisation('Les deux mots de passe ne correspondent pas.')
      return
    }

    const { error } = await supabase.auth.updateUser({ password: nouveauMotDePasse })

    if (error) {
      setErreurReinitialisation(error.message)
      return
    }

    setModeReinitialisation(false)
    setNouveauMotDePasse('')
    setConfirmationNouveauMotDePasse('')
    setAfficherAuth(false)
    afficherNotification('Mot de passe mis à jour.', 'info')
  }

  async function inscription() {
    setErreurInscription('')
    setMessageInscription('')
    const { data, error } = await supabase.auth.signUp({
      email: emailInscription,
      password: motDePasseInscription,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          role: roleChoisi,
          nom: nomInscription
        }
      }
    })
    if (error) {
      setErreurInscription(messageErreurAuth(error))
      return
    }
    // Le profil (table "profils") est maintenant créé automatiquement
    // côté base de données par un déclencheur ("trigger"), dès que le
    // compte est créé — plus besoin de l'insérer ici depuis le site.
    if (!data.session) {
      // Pas de session tout de suite : la confirmation par email est
      // active, il faut prévenir le client plutôt que de le laisser
      // sans aucun retour après avoir cliqué sur "S'inscrire".
      setMessageInscription("Inscription bien reçue ! Vérifie ta boîte mail (et tes spams) et clique sur le lien de confirmation pour activer ton compte.")
      setEmailInscription('')
      setMotDePasseInscription('')
      setNomInscription('')
    }
  }

  async function deconnexion() {
    await supabase.auth.signOut()
    setEmailConnexion('')
    setMotDePasseConnexion('')
    setEmailInscription('')
    setMotDePasseInscription('')
    setErreurInscription('')
    setMessageInscription('')
    setAfficherMotDePasseOublie(false)
    setEmailOubli('')
    setMessageOubli('')
    setErreurOubli('')
    setEspace('catalogue')
    setAfficherAuth(false)
  }

  function ouvrirSousSection(sousSection) {
    setSousSectionActive(sousSection)
    setVue('sousSection')
  }

  function ajouterAuPanier(produit) {
    setPanier((precedent) => {
      const indexExistant = precedent.findIndex((item) => item.id === produit.id)
      if (indexExistant !== -1) {
        return precedent.map((item, i) =>
          i === indexExistant ? { ...item, quantite: item.quantite + 1 } : item
        )
      }
      return [...precedent, { id: produit.id, nom: produit.nom, prix: produit.prix, quantite: 1 }]
    })
  }

  function augmenterQuantite(index) {
    setPanier((precedent) =>
      precedent.map((item, i) => (i === index ? { ...item, quantite: item.quantite + 1 } : item))
    )
  }

  function diminuerQuantite(index) {
    setPanier((precedent) => {
      const item = precedent[index]
      if (item.quantite <= 1) {
        return precedent.filter((_, i) => i !== index)
      }
      return precedent.map((it, i) => (i === index ? { ...it, quantite: it.quantite - 1 } : it))
    })
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
    if (
      nomClient.trim() === '' ||
      adresseClient.trim() === '' ||
      telephoneClient.trim() === '' ||
      emailClient.trim() === ''
    ) {
      afficherNotification("Merci de renseigner le nom, l'adresse de livraison, le téléphone et l'email.")
      return
    }

    setEnvoiEnCours(true)

    const listeProduits = panier
      .map((produit) => (produit.quantite > 1 ? `${produit.nom} x${produit.quantite}` : produit.nom))
      .join(', ')

    const { data: nouvelleCommande, error: erreurCommande } = await supabase
      .rpc('creer_commande', {
        p_produits: listeProduits,
        p_total: total,
        p_nom_client: nomClient,
        p_adresse: adresseClient,
        p_telephone: telephoneClient,
        p_email: emailClient,
        p_user_id: session ? session.user.id : null
      })
      .single()

    setEnvoiEnCours(false)

    if (erreurCommande) {
      console.error("Erreur d'enregistrement de la commande :", erreurCommande)
      afficherNotification("Une erreur est survenue, la commande n'a pas pu être enregistrée.")
      return
    }

    if (session && nouvelleCommande) {
      setMesCommandes([nouvelleCommande, ...mesCommandes])
    }
    setCommandeInvite(nouvelleCommande)
    sauvegarderCommandeLocale(nouvelleCommande)

    supabase.functions
      .invoke('envoyer-confirmation-commande', {
        body: {
          email: emailClient,
          nomClient,
          produits: listeProduits,
          total,
          numeroSuivi: nouvelleCommande.numero_suivi,
          adresse: adresseClient
        }
      })
      .catch((erreurEmail) => {
        console.error("Erreur d'envoi de l'email de confirmation :", erreurEmail)
      })

    setRecapCommande(nombreArticles + ' article(s) pour un total de ' + total.toFixed(2) + ' CHF')
    setPanier([])
    setNomClient('')
    setAdresseClient('')
    setTelephoneClient('')
    setEmailClient('')
    setVue('commande')
  }

  function retourAccueil() {
    setVue('accueil')
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

  async function annulerCommande(commande) {
    const course = courses.find((c) => c.commande_id === commande.id)
    if (!course) return

    const estProprietaireConnecte = session && commande.user_id === session.user.id

    const { error } = estProprietaireConnecte
      ? await supabase.from('courses').update({ statut: 'Annulée' }).eq('id', course.id)
      : await supabase.rpc('annuler_commande_invite', {
          p_commande_id: commande.id,
          p_numero: commande.numero_suivi,
          p_nom: commande.nom_client
        })

    if (error) {
      console.error("Erreur d'annulation :", error)
      afficherNotification("L'annulation a échoué, réessaie.")
      return
    }

    setCourses((precedentes) =>
      precedentes.map((c) => (c.id === course.id ? { ...c, statut: 'Annulée' } : c))
    )
    setConfirmationAnnulation(false)
    afficherNotification('Commande annulée.', 'info')
  }

  async function rechercherCommandeInvite(numero = numeroSuiviInvite, nom = nomSuiviInvite) {
    setErreurSuivi('')
    if (numero.trim() === '' || nom.trim() === '') {
      setErreurSuivi('Merci de renseigner le numéro de commande et le nom du client.')
      return
    }

    setChargementSuivi(true)
    const { data, error } = await supabase.rpc('rechercher_commande', {
      p_numero: numero.trim(),
      p_nom: nom.trim()
    })
    setChargementSuivi(false)

    if (error) {
      console.error('Erreur de recherche :', error)
      setErreurSuivi('Une erreur est survenue, réessaie.')
      return
    }
    if (!data || data.length === 0) {
      setErreurSuivi('Aucune commande trouvée avec ce numéro et ce nom.')
      setCommandeInvite(null)
      return
    }
    setCommandeInvite(data[0])
    // Sans compte, la table "courses" n'est plus accessible directement
    // (sécurité) : le statut de livraison nous arrive donc via cette
    // même recherche sécurisée, et on l'ajoute nous-mêmes à la liste
    // locale des courses pour que l'affichage (stepper, annulation...)
    // continue de fonctionner sans rien changer d'autre.
    if (data[0].course_id) {
      setCourses((precedentes) => {
        const autres = precedentes.filter((c) => c.id !== data[0].course_id)
        return [...autres, { id: data[0].course_id, commande_id: data[0].id, statut: data[0].statut }]
      })
    }
  }

  function nouvelleRechercheSuivi() {
    setCommandeInvite(null)
    setNumeroSuiviInvite('')
    setNomSuiviInvite('')
    setErreurSuivi('')
  }

  function quitterSuivi() {
    setEspace('catalogue')
    nouvelleRechercheSuivi()
  }

  async function prendreEnCharge(index) {
    const course = courses[index]
    const { error } = await supabase
      .from('courses')
      .update({ livreur_id: session.user.id })
      .eq('id', course.id)

    if (error) {
      console.error('Erreur de prise en charge :', error)
      afficherNotification('Impossible de prendre cette course, réessaie.')
      return
    }

    setCourses(courses.map((c, i) => (i === index ? { ...c, livreur_id: session.user.id } : c)))
  }

  async function libererCourse(index) {
    const course = courses[index]
    const { error } = await supabase
      .from('courses')
      .update({ livreur_id: null })
      .eq('id', course.id)

    if (error) {
      console.error('Erreur de liberation :', error)
      afficherNotification('Impossible de libérer cette course, réessaie.')
      return
    }

    setCourses(courses.map((c, i) => (i === index ? { ...c, livreur_id: null } : c)))
    afficherNotification('Course libérée.', 'info')
  }

  async function changerStatutAdmin(courseId, nouveauStatut) {
    const { error } = await supabase
      .from('courses')
      .update({ statut: nouveauStatut })
      .eq('id', courseId)

    if (error) {
      console.error('Erreur de mise a jour du statut :', error)
      afficherNotification('Le changement de statut a échoué, réessaie.')
      return
    }

    setCourses(courses.map((c) => (c.id === courseId ? { ...c, statut: nouveauStatut } : c)))
  }

  async function assignerLivreur(courseId, livreurId) {
    const { error } = await supabase
      .from('courses')
      .update({ livreur_id: livreurId || null })
      .eq('id', courseId)

    if (error) {
      console.error("Erreur d'assignation :", error)
      afficherNotification("L'assignation a échoué, réessaie.")
      return
    }

    setCourses(courses.map((c) => (c.id === courseId ? { ...c, livreur_id: livreurId || null } : c)))
  }

  async function ajouterProduit() {
    const prixNombre = parseFloat(nouveauPrixProduit.replace(',', '.'))

    if (nouveauNomProduit.trim() === '' || nouveauSousSection.trim() === '' || nouveauPrixProduit.trim() === '') {
      setErreurProduit('Merci de remplir la sous-section, le nom et le prix.')
      return
    }
    if (isNaN(prixNombre) || prixNombre < 0) {
      setErreurProduit('Le prix doit être un nombre positif.')
      return
    }

    setErreurProduit('')

    const { data, error } = await supabase
      .from('produits')
      .insert({
        metier: 'Ventilation',
        sous_section: nouveauSousSection.trim(),
        nom: nouveauNomProduit.trim(),
        prix: prixNombre
      })
      .select()
      .single()

    if (error) {
      console.error("Erreur d'ajout du produit :", error)
      setErreurProduit("L'ajout a échoué, réessaie.")
      return
    }

    const nouveauxProduits = [...produitsBruts, data]
    setProduitsBruts(nouveauxProduits)
    setMetiers(grouperProduits(nouveauxProduits))
    setNouveauSousSection('')
    setNouveauNomProduit('')
    setNouveauPrixProduit('')
    afficherNotification('Produit ajouté au catalogue.', 'info')
  }

  function commencerEditionProduit(produit) {
    setEditionProduitId(produit.id)
    setEditionSousSection(produit.sous_section)
    setEditionNomProduit(produit.nom)
    setEditionPrixProduit(String(produit.prix))
  }

  function annulerEditionProduit() {
    setEditionProduitId(null)
  }

  async function enregistrerModificationProduit(id) {
    const prixNombre = parseFloat(editionPrixProduit.replace(',', '.'))

    if (editionNomProduit.trim() === '' || editionSousSection.trim() === '' || isNaN(prixNombre) || prixNombre < 0) {
      afficherNotification('Champs invalides, vérifie le nom, la sous-section et le prix.')
      return
    }

    const { error } = await supabase
      .from('produits')
      .update({
        sous_section: editionSousSection.trim(),
        nom: editionNomProduit.trim(),
        prix: prixNombre
      })
      .eq('id', id)

    if (error) {
      console.error('Erreur de modification du produit :', error)
      afficherNotification('La modification a échoué, réessaie.')
      return
    }

    const nouveauxProduits = produitsBruts.map((p) =>
      p.id === id
        ? { ...p, sous_section: editionSousSection.trim(), nom: editionNomProduit.trim(), prix: prixNombre }
        : p
    )
    setProduitsBruts(nouveauxProduits)
    setMetiers(grouperProduits(nouveauxProduits))
    setEditionProduitId(null)
    afficherNotification('Produit modifié.', 'info')
  }

  async function supprimerProduit(id) {
    if (!window.confirm('Supprimer définitivement ce produit du catalogue ?')) return

    const { error } = await supabase.from('produits').delete().eq('id', id)

    if (error) {
      console.error('Erreur de suppression du produit :', error)
      afficherNotification('La suppression a échoué, réessaie.')
      return
    }

    const nouveauxProduits = produitsBruts.filter((p) => p.id !== id)
    setProduitsBruts(nouveauxProduits)
    setMetiers(grouperProduits(nouveauxProduits))
    afficherNotification('Produit supprimé.', 'info')
  }

  return (
    <div className="app">
      {notification && (
        <div className={`notification notification-${notification.type}`}>
          {notification.message}
        </div>
      )}

      <div className="barre-menu-haut">
        <button
          className="icone-compte"
          title="Menu"
          onClick={() => setAfficherMenu(true)}
        >
          <i className="bi bi-list"></i>
        </button>
      </div>

      <div className="barre-compte-haut">
        <button className="lien-compte" onClick={() => setAfficherAuth(true)}>
          {session ? (role === 'livreur' ? 'Livreur' : 'Mon compte') : 'Connexion / Inscription'}
        </button>
        <button className="icone-compte" onClick={() => setAfficherAuth(true)}>
          <i className={`bi ${session ? 'bi-person-check-fill' : 'bi-person-circle'}`}></i>
        </button>
      </div>

      {afficherMenu && (
        <div className="overlay-auth" onClick={() => setAfficherMenu(false)}>
          <div className="panneau-auth" onClick={(e) => e.stopPropagation()}>
            <button className="fermer-auth" onClick={() => setAfficherMenu(false)}>✕</button>
            <h3>Menu</h3>
            <nav className="liste-menu">
              <button onClick={() => { setEspace('suivi'); setAfficherMenu(false) }}>
                <i className="bi bi-truck"></i> Suivre ma commande
              </button>
              <button onClick={() => { setEspace('faq'); setAfficherMenu(false) }}>
                <i className="bi bi-question-circle"></i> FAQ
              </button>
              <button onClick={() => { setEspace('apropos'); setAfficherMenu(false) }}>
                <i className="bi bi-info-circle"></i> Qui sommes-nous
              </button>
              {espace !== 'catalogue' && (
                <button onClick={() => { setEspace('catalogue'); setAfficherMenu(false) }}>
                  <i className="bi bi-shop"></i> Catalogue
                </button>
              )}
              {role === 'admin' && (
                <button onClick={() => { setEspace('catalogueAdmin'); setAfficherMenu(false) }}>
                  <i className="bi bi-box-seam"></i> Gérer le catalogue
                </button>
              )}
            </nav>
          </div>
        </div>
      )}

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

            {modeReinitialisation && (
              <div className="carte-auth">
                <h3>Nouveau mot de passe</h3>
                <input
                  type="password"
                  placeholder="Nouveau mot de passe"
                  value={nouveauMotDePasse}
                  onChange={(e) => setNouveauMotDePasse(e.target.value)}
                />
                <input
                  type="password"
                  placeholder="Confirmer le mot de passe"
                  value={confirmationNouveauMotDePasse}
                  onChange={(e) => setConfirmationNouveauMotDePasse(e.target.value)}
                />
                {erreurReinitialisation && <p className="souligne">{erreurReinitialisation}</p>}
                <button className="valider" onClick={reinitialiserMotDePasse}>Mettre à jour le mot de passe</button>
              </div>
            )}

            {!modeReinitialisation && chargementAuth && (
              <div className="skeleton-liste">
                <div className="skeleton-ligne skeleton-courte"></div>
              </div>
            )}

            {!modeReinitialisation && !chargementAuth && !session && (
              <div className="cartes-auth">
                <div className="carte-auth">
                  <h3>Connexion</h3>
                  {!afficherMotDePasseOublie ? (
                    <>
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
                      <p
                        className="lien-carte"
                        onClick={() => { setAfficherMotDePasseOublie(true); setErreurOubli(''); setMessageOubli('') }}
                      >
                        Mot de passe oublié ?
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="souligne">Entre ton email, on t'envoie un lien pour réinitialiser ton mot de passe.</p>
                      <input
                        type="email"
                        placeholder="Email"
                        value={emailOubli}
                        onChange={(e) => setEmailOubli(e.target.value)}
                      />
                      {erreurOubli && <p className="souligne">{erreurOubli}</p>}
                      {messageOubli && <p className="souligne">{messageOubli}</p>}
                      <button className="valider" disabled={envoiOubliEnCours} onClick={demanderReinitialisation}>
                        {envoiOubliEnCours ? 'Envoi...' : 'Envoyer le lien'}
                      </button>
                      <p className="lien-carte" onClick={() => setAfficherMotDePasseOublie(false)}>
                        ← Retour à la connexion
                      </p>
                    </>
                  )}
                </div>

                <div className="carte-auth">
                  <h3>Inscription</h3>
                  <input
                    type="text"
                    placeholder="Nom"
                    value={nomInscription}
                    onChange={(e) => setNomInscription(e.target.value)}
                  />
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
                  {messageInscription && <p className="souligne">{messageInscription}</p>}
                  <button className="valider" onClick={inscription}>S'inscrire</button>
                </div>
              </div>
            )}

            {!modeReinitialisation && !chargementAuth && session && (
              <div className="carte-auth">
                <p className="slogan">{nomUtilisateur || session.user.email}</p>
                <p className="slogan">Rôle : {role === 'livreur' ? 'Livreur' : role === 'admin' ? 'Admin' : 'Client'}</p>
                {role === 'livreur' && espace !== 'livreur' && (
                  <button className="valider" onClick={() => { setEspace('livreur'); setAfficherAuth(false) }}>
                    Aller à mon espace livreur
                  </button>
                )}
                {role === 'admin' && espace !== 'admin' && (
                  <button className="valider" onClick={() => { setEspace('admin'); setAfficherAuth(false) }}>
                    Aller à mon espace admin
                  </button>
                )}
                {(espace === 'livreur' || espace === 'admin') && (
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
              <h3 className="titre-accueil">Nos catégories</h3>
              <input
                type="text"
                className="barre-recherche"
                placeholder="Rechercher une catégorie..."
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
              <div className="grille-categories">
                {sousSectionsFiltrees.map((sousSection, index) => (
                  <div key={`${sousSection.nom}-${index}`} className="carte-categorie" onClick={() => ouvrirSousSection(sousSection)}>
                    <span className="icon-categorie"><i className={`bi bi-${iconsParSousSection[sousSection.nom] || 'box-seam'}`}></i></span>
                    <span>{sousSection.nom}</span>
                  </div>
                ))}
              </div>
              {sousSectionsFiltrees.length === 0 && (
                <p className="aucun-resultat">Aucune catégorie trouvée pour cette recherche.</p>
              )}
            </>
          )}

          {vue === 'sousSection' && (
            <>
              <div className="fil-ariane">
                <span onClick={retourAccueil}>Accueil</span>
                <span className="separateur-fil">›</span>
                <span className="actif">{sousSectionActive.nom}</span>
              </div>
              <h3>{sousSectionActive.nom}</h3>
              <ul className="liste-produits">
                {sousSectionActive.produits.map((produit) => (
                  <li key={produit.nom}>
                    <span>{produit.nom}</span>
                    <span className="prix">{produit.prix.toFixed(2)} CHF</span>
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
                    <span>{produit.nom} — {produit.prix.toFixed(2)} CHF</span>
                    <div className="quantite-controle">
                      <button onClick={() => diminuerQuantite(index)}>−</button>
                      <span>{produit.quantite}</span>
                      <button onClick={() => augmenterQuantite(index)}>+</button>
                    </div>
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
                <input
                  type="tel"
                  placeholder="Téléphone (pour te joindre en cas de souci)"
                  value={telephoneClient}
                  onChange={(e) => setTelephoneClient(e.target.value)}
                />
                <input
                  type="email"
                  placeholder="Email (pour recevoir ta confirmation)"
                  value={emailClient}
                  onChange={(e) => setEmailClient(e.target.value)}
                />
              </div>
              <p className="total-panier">Total : {total.toFixed(2)} CHF</p>
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
              <p className="souligne">Un email de confirmation vient de t'être envoyé.</p>
              {commandeInvite && commandeInvite.numero_suivi && (
                <p className="slogan">
                  Numéro de suivi : <strong>{commandeInvite.numero_suivi}</strong>
                  <br />
                  <span className="souligne">Note-le pour suivre ta commande, même sans compte.</span>
                </p>
              )}
              <button className="valider" onClick={() => { setEspace('suivi'); setVue('accueil') }}>
                Suivre ma commande
              </button>
              <p className="retour" onClick={retourAccueil}>← Retour à l'accueil</p>
            </>
          )}

          {vue !== 'panier' && vue !== 'commande' && (
            <div className="barre-panier" onClick={() => setVue('panier')}>
              Panier : {nombreArticles} article(s) — {total.toFixed(2)} CHF
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
                    <span className="prix">{commande.total.toFixed(2)} CHF</span>
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
              {mesCommandes[commandeSelectionnee].adresse && (
                <p className="souligne">Livraison : {mesCommandes[commandeSelectionnee].adresse}</p>
              )}
              <p className="total-panier">{mesCommandes[commandeSelectionnee].total.toFixed(2)} CHF</p>
              {mesCommandes[commandeSelectionnee].numero_suivi && (
                <p className="souligne">N° de suivi : {mesCommandes[commandeSelectionnee].numero_suivi}</p>
              )}

              {statutCommande(mesCommandes[commandeSelectionnee].id) === 'Annulée' ? (
                <p className="aucun-resultat">Cette commande a été annulée.</p>
              ) : (
                <>
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

                  {statutCommande(mesCommandes[commandeSelectionnee].id) === 'À livrer' && (
                    confirmationAnnulation ? (
                      <div className="confirmation-annulation">
                        <p className="aucun-resultat">Confirmer l'annulation de cette commande ?</p>
                        <div className="boutons-confirmation">
                          <button
                            className="annuler-secondaire"
                            onClick={() => setConfirmationAnnulation(false)}
                          >
                            Non, garder
                          </button>
                          <button
                            className="valider"
                            onClick={() => annulerCommande(mesCommandes[commandeSelectionnee])}
                          >
                            Oui, annuler
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button className="bouton-annuler" onClick={() => setConfirmationAnnulation(true)}>
                        Annuler la commande
                      </button>
                    )
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {espace === 'suivi' && (
        <>
          <p className="retour" onClick={quitterSuivi}>← Retour au catalogue</p>
          <h3>Suivre ma commande</h3>

          {!commandeInvite && commandesRecentesLocales.length > 0 && (
            <>
              <p className="aucun-resultat">Commandes passées récemment depuis cet appareil :</p>
              <nav className="liste-menu">
                {commandesRecentesLocales.map((c) => (
                  <button key={c.id} onClick={() => rechercherCommandeInvite(c.numero_suivi, c.nom_client)}>
                    <i className="bi bi-clock-history"></i> {c.numero_suivi} — {c.total.toFixed(2)} CHF
                  </button>
                ))}
              </nav>
            </>
          )}

          {!commandeInvite && (
            <>
              <p className="aucun-resultat">
                Entre le numéro de suivi reçu à la commande ainsi que le nom utilisé, pour voir uniquement ta commande.
              </p>
              <div className="carte-auth">
                <input
                  type="text"
                  placeholder="Numéro de commande"
                  value={numeroSuiviInvite}
                  onChange={(e) => setNumeroSuiviInvite(e.target.value.toUpperCase())}
                />
                <input
                  type="text"
                  placeholder="Nom du client"
                  value={nomSuiviInvite}
                  onChange={(e) => setNomSuiviInvite(e.target.value)}
                />
                {erreurSuivi && <p className="souligne">{erreurSuivi}</p>}
                <button className="valider" disabled={chargementSuivi} onClick={() => rechercherCommandeInvite()}>
                  {chargementSuivi ? 'Recherche...' : 'Rechercher'}
                </button>
              </div>
            </>
          )}

          {commandeInvite && (
            <>
              <p className="retour" onClick={nouvelleRechercheSuivi}>← Nouvelle recherche</p>
              <p className="slogan">{commandeInvite.produits}</p>
              {commandeInvite.adresse && (
                <p className="souligne">Livraison : {commandeInvite.adresse}</p>
              )}
              <p className="total-panier">{commandeInvite.total.toFixed(2)} CHF</p>

              {statutCommande(commandeInvite.id) === 'Annulée' ? (
                <p className="aucun-resultat">Cette commande a été annulée.</p>
              ) : (
                <>
                  <div className="stepper-statut">
                    <div className={`point-statut ${STATUTS.indexOf(statutCommande(commandeInvite.id)) >= 0 ? 'complete' : ''}`}></div>
                    <div className={`ligne-statut ${STATUTS.indexOf(statutCommande(commandeInvite.id)) >= 1 ? 'complete' : ''}`}></div>
                    <div className={`point-statut ${STATUTS.indexOf(statutCommande(commandeInvite.id)) >= 1 ? 'complete' : ''}`}></div>
                    <div className={`ligne-statut ${STATUTS.indexOf(statutCommande(commandeInvite.id)) >= 2 ? 'complete' : ''}`}></div>
                    <div className={`point-statut ${STATUTS.indexOf(statutCommande(commandeInvite.id)) >= 2 ? 'complete' : ''}`}></div>

                    <div className={`label-statut ${statutCommande(commandeInvite.id) === 'À livrer' ? 'actuelle' : ''}`}>À livrer</div>
                    <div></div>
                    <div className={`label-statut ${statutCommande(commandeInvite.id) === 'En cours' ? 'actuelle' : ''}`}>En cours</div>
                    <div></div>
                    <div className={`label-statut ${statutCommande(commandeInvite.id) === 'Livrée' ? 'actuelle' : ''}`}>Livrée</div>
                  </div>

                  {statutCommande(commandeInvite.id) === 'À livrer' && (
                    confirmationAnnulation ? (
                      <div className="confirmation-annulation">
                        <p className="aucun-resultat">Confirmer l'annulation de cette commande ?</p>
                        <div className="boutons-confirmation">
                          <button className="annuler-secondaire" onClick={() => setConfirmationAnnulation(false)}>
                            Non, garder
                          </button>
                          <button className="valider" onClick={() => annulerCommande(commandeInvite)}>
                            Oui, annuler
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button className="bouton-annuler" onClick={() => setConfirmationAnnulation(true)}>
                        Annuler la commande
                      </button>
                    )
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {espace === 'faq' && (
        <>
          <p className="retour" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>
          <h3>FAQ</h3>

          <div className="carte-auth">
            <strong>Comment suivre ma commande ?</strong>
            <p>
              Utilise le numéro de suivi reçu à la validation de ta commande, via le menu ☰ → "Suivre ma commande".
              Si tu as créé un compte, tu la retrouves aussi automatiquement dans "Mes commandes".
            </p>
          </div>

          <div className="carte-auth">
            <strong>Dois-je créer un compte pour commander ?</strong>
            <p>
              Non, tu peux commander sans compte : un numéro de suivi t'est donné à la fin.
              Créer un compte te permet simplement de retrouver tout ton historique de commandes automatiquement.
            </p>
          </div>

          <div className="carte-auth">
            <strong>Puis-je annuler ma commande ?</strong>
            <p>
              Oui, tant qu'elle est encore au statut "À livrer", depuis l'écran de suivi ou "Mes commandes".
              Une fois "En cours", l'annulation n'est plus possible.
            </p>
          </div>

          <div className="carte-auth">
            <strong>Comment se fait la livraison ?</strong>
            <p>
              Selon le livreur qui prend en charge ta commande et le format de celle-ci : scooter, moto ou vélo cargo.
              Ce choix n'est pas fait par le client, il dépend de la disponibilité et du véhicule du livreur.
            </p>
          </div>

          <div className="carte-auth">
            <strong>Quels produits proposez-vous ?</strong>
            <p>
              Des petits consommables pour le métier de la ventilation (supportage, silicone, gaines, soupapes, grilles de finition...),
              livrables rapidement sur chantier.
            </p>
          </div>

          <p className="aucun-resultat">D'autres questions ? Cette section sera complétée au fil du temps.</p>
        </>
      )}

      {espace === 'apropos' && (
        <>
          <p className="retour" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>
          <h3>Qui sommes-nous</h3>

          <div className="carte-auth">
            <p className="slogan">Du rayon au chantier, en un clic.</p>
            <p>
              <strong>2C</strong> est un service de livraison pensé pour les artisans du bâtiment : on livre rapidement,
              directement sur chantier, les petits consommables qui manquent au dernier moment — sans avoir à quitter le chantier
              pour aller en magasin.
            </p>
            <p>
              On démarre avec le métier de la <strong>ventilation</strong> (montage de gaines quadratiques et spiro, du
              supportage à la finition), avec l'ambition d'ajouter d'autres métiers du BTP par la suite.
            </p>
            <p>
              Nos livreurs se déplacent en scooter, moto ou vélo cargo pour aller vite, même en ville ou sur des accès difficiles.
            </p>
          </div>

          <p className="aucun-resultat">Cette page sera complétée avec plus de détails (équipe, zone de livraison, contact...).</p>
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
              <p className="slogan">{nomUtilisateur || session.user.email}</p>

              <h3>Disponibles</h3>
              <ul className="liste-courses">
                {coursesDisponibles.map((course) => (
                  <li key={course.id} onClick={() => setCourseSelectionnee(courses.findIndex((c) => c.id === course.id))}>
                    <span>{course.client}<br /><span className="souligne">{course.adresse} — {course.statut}</span></span>
                    <span className="prix">{course.prix.toFixed(2)} CHF</span>
                  </li>
                ))}
              </ul>
              {coursesDisponibles.length === 0 && (
                <p className="aucun-resultat">Aucune course disponible.</p>
              )}

              <h3>Mes courses en cours</h3>
              <ul className="liste-courses">
                {coursesMoi.map((course) => (
                  <li key={course.id} onClick={() => setCourseSelectionnee(courses.findIndex((c) => c.id === course.id))}>
                    <span>{course.client}<br /><span className="souligne">{course.adresse} — {course.statut}</span></span>
                    <span className="prix">{course.prix.toFixed(2)} CHF</span>
                  </li>
                ))}
              </ul>
              {coursesMoi.length === 0 && (
                <p className="aucun-resultat">Tu n'as aucune course en cours.</p>
              )}

              {coursesLivreesMoi.length > 0 && (
                <>
                  <h3>Livrées</h3>
                  <ul className="liste-courses">
                    {coursesLivreesMoi.map((course) => (
                      <li key={course.id} onClick={() => setCourseSelectionnee(courses.findIndex((c) => c.id === course.id))}>
                        <span>{course.client}<br /><span className="souligne">{course.adresse} — {course.statut}</span></span>
                        <span className="prix">{course.prix.toFixed(2)} CHF</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          {!chargementCourses && courseSelectionnee !== null && (
            <>
              <p className="retour" onClick={() => setCourseSelectionnee(null)}>← Retour</p>
              <h3>{courses[courseSelectionnee].client}</h3>
              <p className="slogan">{courses[courseSelectionnee].adresse}</p>
              {courses[courseSelectionnee].telephone && (
                <p className="souligne">
                  <a href={`tel:${courses[courseSelectionnee].telephone}`}>
                    <i className="bi bi-telephone"></i> {courses[courseSelectionnee].telephone}
                  </a>
                </p>
              )}
              <p className="total-panier">{courses[courseSelectionnee].prix.toFixed(2)} CHF</p>

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

              {!courses[courseSelectionnee].livreur_id && (
                <button className="valider" onClick={() => prendreEnCharge(courseSelectionnee)}>
                  Prendre en charge
                </button>
              )}

              {courses[courseSelectionnee].livreur_id === session.user.id && (
                <button
                  className="valider"
                  disabled={courses[courseSelectionnee].statut === 'Livrée'}
                  onClick={() => avancerStatut(courseSelectionnee)}
                >
                  {courses[courseSelectionnee].statut === 'Livrée' ? 'Course livrée' : 'Faire avancer le statut'}
                </button>
              )}

              {courses[courseSelectionnee].livreur_id === session.user.id &&
                courses[courseSelectionnee].statut === 'À livrer' && (
                  <button className="bouton-annuler" onClick={() => libererCourse(courseSelectionnee)}>
                    Ce n'est pas moi, libérer cette course
                  </button>
                )}
            </>
          )}
        </>
      )}

      {espace === 'admin' && role === 'admin' && (
        <>
          <p className="retour" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>
          <h3>Tableau de bord</h3>

          <button className="bouton-petit" onClick={() => setEspace('catalogueAdmin')}>
            <i className="bi bi-box-seam"></i> Gérer le catalogue
          </button>

          <div className="stats-admin">
            <div className="stat-carte">
              <span className="stat-valeur">{statsAdmin.total}</span>
              <span className="stat-label">Total</span>
            </div>
            <div className="stat-carte">
              <span className="stat-valeur">{statsAdmin.actives}</span>
              <span className="stat-label">Actives</span>
            </div>
            <div className="stat-carte">
              <span className="stat-valeur">{statsAdmin.livrees}</span>
              <span className="stat-label">Livrées</span>
            </div>
            <div className="stat-carte">
              <span className="stat-valeur">{statsAdmin.annulees}</span>
              <span className="stat-label">Annulées</span>
            </div>
          </div>
          <p className="total-panier">Chiffre d'affaires (hors annulées) : {statsAdmin.chiffreAffaires.toFixed(2)} CHF</p>

          <input
            type="text"
            className="barre-recherche"
            placeholder="Rechercher un client, une adresse, un produit..."
            value={rechercheAdmin}
            onChange={(e) => setRechercheAdmin(e.target.value)}
          />

          <div className="filtres-admin">
            {['toutes', 'À livrer', 'En cours', 'Livrée', 'Annulée'].map((statut) => (
              <button
                key={statut}
                className={filtreAdmin === statut ? 'actif' : ''}
                onClick={() => setFiltreAdmin(statut)}
              >
                {statut === 'toutes' ? 'Toutes' : statut}
              </button>
            ))}
          </div>

          {chargementCourses && (
            <div className="skeleton-liste">
              <div className="skeleton-ligne"></div>
              <div className="skeleton-ligne"></div>
              <div className="skeleton-ligne"></div>
            </div>
          )}

          {!chargementCourses && coursesFiltreesAdmin.length > 0 && (
            <div className="tableau-scroll">
              <table className="tableau-admin">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Adresse — Produits</th>
                    <th>Prix</th>
                    <th>Statut</th>
                    <th>Livreur</th>
                  </tr>
                </thead>
                <tbody>
                  {coursesFiltreesAdmin.map((course) => (
                    <tr key={course.id}>
                      <td>
                        {course.client}
                        {course.telephone && <><br /><span className="souligne">{course.telephone}</span></>}
                      </td>
                      <td>{course.adresse} — {course.produits}</td>
                      <td>{course.prix.toFixed(2)} CHF</td>
                      <td>
                        <select
                          value={course.statut}
                          onChange={(e) => changerStatutAdmin(course.id, e.target.value)}
                        >
                          {[...STATUTS, 'Annulée'].map((statut) => (
                            <option key={statut} value={statut}>{statut}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={course.livreur_id || ''}
                          onChange={(e) => assignerLivreur(course.id, e.target.value)}
                        >
                          <option value="">Non assigné</option>
                          {livreurs.map((livreur) => (
                            <option key={livreur.id} value={livreur.id}>{livreur.nom || 'Sans nom'}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!chargementCourses && coursesFiltreesAdmin.length === 0 && (
            <p className="aucun-resultat">Aucune commande pour ce filtre.</p>
          )}
        </>
      )}

      {espace === 'catalogueAdmin' && role === 'admin' && (
        <>
          <p className="retour" onClick={() => setEspace('admin')}>← Retour au tableau de bord</p>
          <h3>Gérer le catalogue</h3>

          <div className="carte-auth">
            <h3>Ajouter un produit</h3>
            <input
              type="text"
              placeholder="Sous-section (ex: Supportage)"
              value={nouveauSousSection}
              onChange={(e) => setNouveauSousSection(e.target.value)}
            />
            <input
              type="text"
              placeholder="Nom du produit"
              value={nouveauNomProduit}
              onChange={(e) => setNouveauNomProduit(e.target.value)}
            />
            <input
              type="text"
              inputMode="decimal"
              placeholder="Prix (CHF)"
              value={nouveauPrixProduit}
              onChange={(e) => setNouveauPrixProduit(e.target.value)}
            />
            {erreurProduit && <p className="souligne">{erreurProduit}</p>}
            <button className="valider" onClick={ajouterProduit}>Ajouter au catalogue</button>
          </div>

          <input
            type="text"
            className="barre-recherche"
            placeholder="Rechercher un produit..."
            value={rechercheProduitsAdmin}
            onChange={(e) => setRechercheProduitsAdmin(e.target.value)}
          />

          {produitsFiltresAdmin.length > 0 && (
            <div className="tableau-scroll">
              <table className="tableau-admin">
                <thead>
                  <tr>
                    <th>Sous-section</th>
                    <th>Nom</th>
                    <th>Prix</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {produitsFiltresAdmin.map((produit) => (
                    <tr key={produit.id}>
                      {editionProduitId === produit.id ? (
                        <>
                          <td>
                            <input
                              type="text"
                              value={editionSousSection}
                              onChange={(e) => setEditionSousSection(e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={editionNomProduit}
                              onChange={(e) => setEditionNomProduit(e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={editionPrixProduit}
                              onChange={(e) => setEditionPrixProduit(e.target.value)}
                            />
                          </td>
                          <td>
                            <button onClick={() => enregistrerModificationProduit(produit.id)} title="Enregistrer">
                              <i className="bi bi-check-lg"></i>
                            </button>
                            <button onClick={annulerEditionProduit} title="Annuler">
                              <i className="bi bi-x-lg"></i>
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{produit.sous_section}</td>
                          <td>{produit.nom}</td>
                          <td>{produit.prix.toFixed(2)} CHF</td>
                          <td>
                            <button onClick={() => commencerEditionProduit(produit)} title="Modifier">
                              <i className="bi bi-pencil"></i>
                            </button>
                            <button onClick={() => supprimerProduit(produit.id)} title="Supprimer">
                              <i className="bi bi-trash"></i>
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {produitsFiltresAdmin.length === 0 && (
            <p className="aucun-resultat">Aucun produit ne correspond à cette recherche.</p>
          )}
        </>
      )}
    </div>
  )
}

export default App
