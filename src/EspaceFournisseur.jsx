import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { CommandesFournisseur } from './CommandesFournisseur'
import { alerteSonoreActivee, definirAlerteSonore, jouerSonnerie } from './alerteSonore'

// =========================================================
// Espace fournisseur (version 1) + validation côté admin
// =========================================================
// Le fournisseur gère SES produits (formulaire, photo, stock, import CSV).
// Les métiers (ventilation, plomberie…) sont attribués par 2C ; les
// sous-sections sont libres. Les nouveaux produits sont publiés tout de suite
// ou après validation de 2C, selon le réglage du compte.
// Toute la sécurité est côté base de données (fonctions SQL) : cet écran ne
// fait que les appeler.

const LIBELLES_STATUT_PRODUIT = {
  publie: 'Publié',
  en_attente: 'En attente de validation',
  refuse: 'Refusé',
  masque: 'Masqué'
}

function messageErreur(erreur, parDefaut) {
  const texte = (erreur && erreur.message) || ''
  if (texte.includes('Métier non autorisé')) return "Ce métier n'est pas autorisé pour votre compte."
  if (texte.includes('non validé')) return "Votre compte n'est pas encore validé par 2C."
  if (texte.includes('Prix invalide')) return 'Le prix est invalide.'
  if (texte.includes('Stock invalide')) return 'Le stock est invalide.'
  if (texte.includes('obligatoires')) return 'Métier, sous-section et nom sont obligatoires.'
  return parDefaut
}

// ---------------------------------------------------------
// Lecture d'un fichier CSV (Excel : Enregistrer sous → CSV)
// ---------------------------------------------------------

function sansAccents(texte) {
  return String(texte || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function normaliserEntete(texte) {
  return sansAccents(texte).toLowerCase().replace(/[^a-z0-9]/g, '')
}

const ALIAS_COLONNES = {
  metier: ['metier', 'corpsdemetier', 'section'],
  sous_section: ['soussection', 'sousrubrique', 'categorie', 'rubrique', 'famille'],
  nom: ['nom', 'nomduproduit', 'produit', 'designation', 'libelle', 'article'],
  prix: ['prix', 'prixchf', 'tarif', 'prixunitaire', 'pu'],
  stock: ['stock', 'quantite', 'quantitestock', 'qte', 'qty'],
  reference: ['reference', 'ref', 'sku', 'code', 'codearticle', 'refarticle'],
  image_url: ['image', 'imageurl', 'photo', 'urlimage', 'lienimage', 'urlphoto']
}

// Découpe le texte en lignes / cellules (guillemets, ; , ou tabulation).
export function lireCsv(texteBrut) {
  const texte = String(texteBrut || '').replace(/^﻿/, '')
  const premiereLigne = texte.split(/\r?\n/)[0] || ''
  const separateurs = [';', ',', '\t']
  const separateur = separateurs
    .map((s) => ({ s, n: premiereLigne.split(s).length }))
    .sort((a, b) => b.n - a.n)[0].s

  const lignes = []
  let ligne = []
  let cellule = ''
  let entreGuillemets = false
  for (let i = 0; i < texte.length; i += 1) {
    const c = texte[i]
    if (entreGuillemets) {
      if (c === '"' && texte[i + 1] === '"') {
        cellule += '"'
        i += 1
      } else if (c === '"') {
        entreGuillemets = false
      } else {
        cellule += c
      }
    } else if (c === '"') {
      entreGuillemets = true
    } else if (c === separateur) {
      ligne.push(cellule)
      cellule = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i += 1
      ligne.push(cellule)
      cellule = ''
      if (ligne.some((v) => v.trim() !== '')) lignes.push(ligne)
      ligne = []
    } else {
      cellule += c
    }
  }
  ligne.push(cellule)
  if (ligne.some((v) => v.trim() !== '')) lignes.push(ligne)
  return lignes
}

function lirePrix(texte) {
  const nettoye = String(texte ?? '')
    .replace(/chf|fr\.?|\s/gi, '')
    .replace(/['’]/g, '')
    .replace(',', '.')
  if (nettoye === '') return NaN
  return Number(nettoye)
}

// Transforme le contenu d'un CSV en lignes de produits contrôlées.
// metiersAutorises : si un seul métier est autorisé, il sert de valeur par défaut.
export function preparerImport(texteCsv, metiersAutorises) {
  const cellules = lireCsv(texteCsv)
  if (cellules.length < 2) {
    return { lignes: [], colonnesManquantes: [], vide: true }
  }
  const entetes = cellules[0].map(normaliserEntete)
  const index = {}
  Object.keys(ALIAS_COLONNES).forEach((cle) => {
    index[cle] = entetes.findIndex((e) => ALIAS_COLONNES[cle].includes(e))
  })

  const metierParDefaut = metiersAutorises.length === 1 ? metiersAutorises[0] : ''
  const colonnesManquantes = []
  if (index.nom < 0) colonnesManquantes.push('Nom du produit')
  if (index.prix < 0) colonnesManquantes.push('Prix (CHF)')
  if (index.sous_section < 0) colonnesManquantes.push('Sous-section')
  if (index.metier < 0 && !metierParDefaut) colonnesManquantes.push('Métier')

  const valeur = (ligne, cle) => (index[cle] >= 0 ? String(ligne[index[cle]] ?? '').trim() : '')
  const lignes = cellules.slice(1).map((ligne, i) => {
    const metier = valeur(ligne, 'metier') || metierParDefaut
    const prix = lirePrix(valeur(ligne, 'prix'))
    const stockTexte = valeur(ligne, 'stock')
    const stock = stockTexte === '' ? null : Number(stockTexte.replace(/\s/g, ''))
    const produit = {
      numero: i + 2,
      metier,
      sous_section: valeur(ligne, 'sous_section'),
      nom: valeur(ligne, 'nom'),
      prix,
      stock,
      reference: valeur(ligne, 'reference'),
      image_url: valeur(ligne, 'image_url')
    }
    let erreur = ''
    if (!produit.nom) erreur = 'nom manquant'
    else if (!produit.sous_section) erreur = 'sous-section manquante'
    else if (!produit.metier) erreur = 'métier manquant'
    else if (!metiersAutorises.includes(produit.metier)) erreur = `métier non autorisé (${produit.metier})`
    else if (!Number.isFinite(prix) || prix < 0) erreur = 'prix invalide'
    else if (stock !== null && (!Number.isInteger(stock) || stock < 0)) erreur = 'stock invalide'
    return { ...produit, erreur }
  })
  return { lignes, colonnesManquantes, vide: false }
}

const MODELE_CSV =
  'Métier;Sous-section;Nom du produit;Prix (CHF);Stock;Référence;Image (URL)\n' +
  'Ventilation;Gaines;Gaine souple 125 mm - 10 m;24.90;120;GS-125-10;\n' +
  'Ventilation;Colliers;Collier de serrage 125 mm;2.20;;CL-125;\n'

function telechargerTexte(nomFichier, contenu) {
  const blob = new Blob(['﻿' + contenu], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const lien = document.createElement('a')
  lien.href = url
  lien.download = nomFichier
  document.body.appendChild(lien)
  lien.click()
  document.body.removeChild(lien)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ---------------------------------------------------------
// Espace du fournisseur
// ---------------------------------------------------------

const FORMULAIRE_VIDE = {
  id: '',
  metier: '',
  sous_section: '',
  nom: '',
  prix: '',
  stock: '',
  reference: '',
  image_url: ''
}


// Réglages de l'alerte « nouvelle commande à préparer » (par appareil).
function ReglagesAlerte({ notifier }) {
  const [sonActif, setSonActif] = useState(alerteSonoreActivee())
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'indisponible'
  )

  function basculer() {
    const nouveau = !sonActif
    definirAlerteSonore(nouveau)
    setSonActif(nouveau)
    if (nouveau) jouerSonnerie()
  }

  async function activerNotifications() {
    if (typeof Notification === 'undefined') return
    const resultat = await Notification.requestPermission()
    setPermission(resultat)
    if (resultat === 'granted') notifier('Notifications activées sur cet appareil.', 'info')
    else notifier('Notifications refusées. Vous pouvez les activer dans les réglages du navigateur.')
  }

  return (
    <div className="reglages-alerte">
      <button className={sonActif ? 'bouton-secondaire alerte-active' : 'bouton-secondaire'} onClick={basculer}>
        <i className={sonActif ? 'bi bi-bell-fill' : 'bi bi-bell-slash'}></i>{' '}
        Alerte sonore : {sonActif ? 'activée' : 'désactivée'}
      </button>
      <button
        className="bouton-secondaire"
        onClick={() => {
          jouerSonnerie().then((ok) => {
            if (!ok) notifier('Son bloqué par ce téléphone : vérifiez le volume et le mode silencieux, puis réessayez.')
          })
        }}
      >
        <i className="bi bi-volume-up"></i> Tester le son
      </button>
      {permission === 'default' && (
        <button className="bouton-secondaire" onClick={activerNotifications}>
          <i className="bi bi-megaphone"></i> Activer les notifications
        </button>
      )}
      <small>La sonnerie retentit quand une nouvelle commande est à préparer, tant que le site est ouvert et l'écran allumé. Touchez le bouton de test une fois après avoir ouvert la page, montez le volume et désactivez le mode silencieux.</small>
    </div>
  )
}

export function EspaceFournisseur({ compte, onRetour, notifier, onCatalogueChange }) {
  const valide = compte.statut === 'valide'
  const metiersAutorises = compte.metiers || []
  const [produits, setProduits] = useState([])
  const [chargement, setChargement] = useState(valide)
  const [recherche, setRecherche] = useState('')
  const [filtreStatut, setFiltreStatut] = useState('')
  const [formulaire, setFormulaire] = useState(null)
  const [enregistrement, setEnregistrement] = useState(false)
  const [envoiPhoto, setEnvoiPhoto] = useState(false)
  const [stocks, setStocks] = useState({})
  const [apercuImport, setApercuImport] = useState(null)
  const [importEnCours, setImportEnCours] = useState(false)
  const [resultatImport, setResultatImport] = useState(null)
  const champFichier = useRef(null)
  const [onglet, setOnglet] = useState('catalogue')
  const [aPreparer, setAPreparer] = useState(0)

  // Pastille "commandes à préparer" sur l'onglet Commandes
  async function chargerAPreparer() {
    const { data, error } = await supabase.rpc('fournisseur_commandes_a_preparer')
    // Erreur (ex. SQL des commandes pas encore exécuté) : on n'affiche simplement pas de pastille.
    setAPreparer(!error && Number.isFinite(Number(data)) ? Number(data) : 0)
  }

  useEffect(() => {
    if (valide) chargerAPreparer()
  }, [valide])

  // L'alerte (useAlerteFournisseur) signale une nouvelle commande : on rafraîchit la pastille.
  useEffect(() => {
    if (!valide) return undefined
    window.addEventListener('commandes-fournisseur-maj', chargerAPreparer)
    return () => window.removeEventListener('commandes-fournisseur-maj', chargerAPreparer)
  }, [valide])

  async function charger() {
    const { data, error } = await supabase.rpc('fournisseur_mes_produits')
    if (error) {
      console.error('Erreur de chargement des produits du fournisseur :', error)
      notifier('Impossible de charger vos produits.')
      setChargement(false)
      return
    }
    setProduits(data || [])
    setChargement(false)
  }

  useEffect(() => {
    if (valide) charger()
  }, [valide])

  const sousSectionsConnues = useMemo(() => {
    const ensemble = new Set()
    produits.forEach((p) => {
      if (!formulaire || !formulaire.metier || p.metier === formulaire.metier) ensemble.add(p.sous_section)
    })
    return [...ensemble].filter(Boolean).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [produits, formulaire && formulaire.metier])

  const produitsAffiches = produits.filter((p) => {
    if (filtreStatut && p.statut_validation !== filtreStatut) return false
    const mot = recherche.trim().toLowerCase()
    if (!mot) return true
    return [p.nom, p.sous_section, p.metier, p.reference].some((v) => String(v || '').toLowerCase().includes(mot))
  })

  const nbEnAttente = produits.filter((p) => p.statut_validation === 'en_attente').length

  function ouvrirNouveau() {
    setResultatImport(null)
    setFormulaire({ ...FORMULAIRE_VIDE, metier: metiersAutorises.length === 1 ? metiersAutorises[0] : '' })
  }

  function ouvrirEdition(p) {
    setResultatImport(null)
    setFormulaire({
      id: String(p.id),
      metier: p.metier || '',
      sous_section: p.sous_section || '',
      nom: p.nom || '',
      prix: String(p.prix ?? ''),
      stock: p.quantite_stock === null || p.quantite_stock === undefined ? '' : String(p.quantite_stock),
      reference: p.reference || '',
      image_url: p.image_url || ''
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function enregistrerProduit() {
    const prix = lirePrix(formulaire.prix)
    const stockTexte = formulaire.stock.trim()
    const stock = stockTexte === '' ? null : Number(stockTexte)
    if (!formulaire.metier || !formulaire.sous_section.trim() || !formulaire.nom.trim()) {
      notifier('Métier, sous-section et nom sont obligatoires.')
      return
    }
    if (!Number.isFinite(prix) || prix < 0) {
      notifier('Le prix doit être un nombre positif.')
      return
    }
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
      notifier('Le stock doit être un nombre entier positif (ou vide si illimité).')
      return
    }
    setEnregistrement(true)
    const { error } = await supabase.rpc('fournisseur_enregistrer_produit', {
      p_id: formulaire.id || null,
      p_metier: formulaire.metier,
      p_sous_section: formulaire.sous_section.trim(),
      p_nom: formulaire.nom.trim(),
      p_prix: prix,
      p_image_url: formulaire.image_url.trim() || null,
      p_stock: stock,
      p_reference: formulaire.reference.trim() || null
    })
    setEnregistrement(false)
    if (error) {
      console.error("Erreur d'enregistrement du produit :", error)
      notifier(messageErreur(error, "L'enregistrement a échoué, réessayez."))
      return
    }
    const estNouveau = !formulaire.id
    setFormulaire(null)
    await charger()
    if (onCatalogueChange) onCatalogueChange()
    notifier(
      estNouveau && !compte.publication_directe
        ? 'Produit ajouté : il sera publié après validation par 2C.'
        : 'Produit enregistré.',
      'info'
    )
  }

  async function enregistrerStock(p) {
    const texte = String(stocks[p.id] ?? '').trim()
    const stock = texte === '' ? null : Number(texte)
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
      notifier('Le stock doit être un nombre entier positif (ou vide si illimité).')
      return
    }
    const { error } = await supabase.rpc('fournisseur_modifier_stock', { p_id: String(p.id), p_stock: stock })
    if (error) {
      console.error('Erreur de mise à jour du stock :', error)
      notifier('La mise à jour du stock a échoué.')
      return
    }
    setProduits((precedent) => precedent.map((x) => (x.id === p.id ? { ...x, quantite_stock: stock } : x)))
    setStocks((precedent) => {
      const copie = { ...precedent }
      delete copie[p.id]
      return copie
    })
    if (onCatalogueChange) onCatalogueChange()
    notifier('Stock mis à jour.', 'info')
  }

  async function supprimer(p) {
    if (!window.confirm(`Supprimer « ${p.nom} » de votre catalogue ?`)) return
    const { error } = await supabase.rpc('fournisseur_supprimer_produit', { p_id: String(p.id) })
    if (error) {
      console.error('Erreur de suppression :', error)
      notifier('La suppression a échoué.')
      return
    }
    setProduits((precedent) => precedent.filter((x) => x.id !== p.id))
    if (onCatalogueChange) onCatalogueChange()
    notifier('Produit supprimé.', 'info')
  }

  async function envoyerPhoto(fichier) {
    if (!fichier) return
    if (!fichier.type.startsWith('image/')) {
      notifier('Choisissez un fichier image (JPG, PNG…).')
      return
    }
    if (fichier.size > 5 * 1024 * 1024) {
      notifier('Image trop lourde (5 Mo maximum).')
      return
    }
    setEnvoiPhoto(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const uid = sessionData && sessionData.session ? sessionData.session.user.id : compte.user_id
      const extension = (fichier.name.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
      const chemin = `fournisseurs/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
      const { error } = await supabase.storage.from('produits').upload(chemin, fichier)
      if (error) throw error
      const { data } = supabase.storage.from('produits').getPublicUrl(chemin)
      setFormulaire((precedent) => ({ ...precedent, image_url: data.publicUrl }))
    } catch (e) {
      console.error("Erreur d'envoi de la photo :", e)
      notifier("L'envoi de la photo a échoué, réessayez.")
    }
    setEnvoiPhoto(false)
  }

  async function lireFichierCsv(fichier) {
    if (!fichier) return
    setResultatImport(null)
    if (/\.xlsx?$/i.test(fichier.name)) {
      notifier('Dans Excel : Fichier → Enregistrer sous → « CSV UTF-8 », puis choisissez ce fichier.')
      return
    }
    const texte = await fichier.text()
    const apercu = preparerImport(texte, metiersAutorises)
    if (apercu.vide) {
      notifier('Le fichier est vide ou ne contient pas de lignes de produits.')
      return
    }
    setApercuImport({ nomFichier: fichier.name, ...apercu })
  }

  async function lancerImport() {
    const valides = apercuImport.lignes.filter((l) => !l.erreur)
    if (valides.length === 0) return
    setImportEnCours(true)
    const total = { crees: 0, modifies: 0, erreurs: [] }
    for (let debut = 0; debut < valides.length; debut += 500) {
      const lot = valides.slice(debut, debut + 500).map((l) => ({
        metier: l.metier,
        sous_section: l.sous_section,
        nom: l.nom,
        prix: String(l.prix),
        stock: l.stock === null ? '' : String(l.stock),
        reference: l.reference,
        image_url: l.image_url
      }))
      const { data, error } = await supabase.rpc('fournisseur_importer_produits', { p_lignes: lot })
      if (error) {
        console.error("Erreur d'import :", error)
        total.erreurs.push({ ligne: debut + 2, message: messageErreur(error, "l'import a échoué") })
        break
      }
      total.crees += data.crees
      total.modifies += data.modifies
      ;(data.erreurs || []).forEach((e) => {
        const source = valides[debut + e.ligne - 1]
        total.erreurs.push({ ligne: source ? source.numero : debut + e.ligne + 1, message: e.message })
      })
    }
    setImportEnCours(false)
    setApercuImport(null)
    if (champFichier.current) champFichier.current.value = ''
    setResultatImport(total)
    await charger()
    if (onCatalogueChange) onCatalogueChange()
  }

  const bandeau = !valide ? (
    <div className="bandeau-fournisseur">
      {compte.statut === 'suspendu'
        ? "Votre compte fournisseur est suspendu. Contactez 2C à contact@2cdelivery.ch."
        : "Votre compte est en cours de validation par 2C. Vous pourrez ajouter vos produits dès qu'il sera validé."}
    </div>
  ) : metiersAutorises.length === 0 ? (
    <div className="bandeau-fournisseur">
      2C n'a pas encore attribué de métier à votre compte (ventilation, plomberie…). Vous pourrez ajouter vos
      produits dès que ce sera fait.
    </div>
  ) : (
    <div className="bandeau-fournisseur bandeau-info">
      {compte.publication_directe
        ? 'Vos nouveaux produits sont publiés immédiatement sur le site.'
        : 'Vos nouveaux produits sont publiés après validation par 2C. Les modifications de prix et de stock de vos produits déjà publiés sont immédiates.'}
    </div>
  )

  const peutAgir = valide && metiersAutorises.length > 0

  const barreOnglets = valide ? (
    <div className="choix-role onglets-fournisseur">
      <button className={onglet === 'catalogue' ? 'actif' : ''} onClick={() => setOnglet('catalogue')}>
        Catalogue
      </button>
      <button
        className={onglet === 'commandes' ? 'actif' : ''}
        onClick={() => {
          setOnglet('commandes')
          chargerAPreparer()
        }}
      >
        Commandes
        {aPreparer > 0 && <span className="pastille-commandes">{aPreparer}</span>}
      </button>
    </div>
  ) : null

  if (valide && onglet === 'commandes') {
    return (
      <div className="espace-fournisseur">
        <p className="retour retour-gestion" onClick={onRetour}>← Retour au catalogue</p>
        <h3>Espace fournisseur — {compte.nom_fournisseur}</h3>
        {barreOnglets}
        <ReglagesAlerte notifier={notifier} />
        <CommandesFournisseur compte={compte} notifier={notifier} onChangement={chargerAPreparer} />
      </div>
    )
  }

  return (
    <div className="espace-fournisseur">
      <p className="retour retour-gestion" onClick={onRetour}>← Retour au catalogue</p>
      <h3>Espace fournisseur — {compte.nom_fournisseur}</h3>
      {barreOnglets}
      {valide && <ReglagesAlerte notifier={notifier} />}
      {bandeau}

      {peutAgir && (
        <>
          <div className="actions-fournisseur">
            <button className="valider" onClick={ouvrirNouveau}>
              <i className="bi bi-plus-lg"></i> Ajouter un produit
            </button>
            <button className="bouton-secondaire" onClick={() => champFichier.current && champFichier.current.click()}>
              <i className="bi bi-upload"></i> Importer un fichier CSV
            </button>
            <button className="bouton-secondaire" onClick={() => telechargerTexte('modele-catalogue-2c.csv', MODELE_CSV)}>
              <i className="bi bi-download"></i> Modèle de fichier
            </button>
            <input
              ref={champFichier}
              type="file"
              accept=".csv,.txt,.xls,.xlsx,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => lireFichierCsv(e.target.files && e.target.files[0])}
            />
          </div>

          {formulaire && (
            <div className="carte-auth carte-produit-fournisseur">
              <h3>{formulaire.id ? 'Modifier le produit' : 'Nouveau produit'}</h3>
              <label className="champ-admin-entreprise">
                <span>Métier</span>
                <select value={formulaire.metier} onChange={(e) => setFormulaire({ ...formulaire, metier: e.target.value })}>
                  <option value="">— Choisir —</option>
                  {metiersAutorises.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
              <input
                type="text"
                list="liste-sous-sections-fournisseur"
                placeholder="Sous-section (ex: Gaines, Colliers)"
                value={formulaire.sous_section}
                onChange={(e) => setFormulaire({ ...formulaire, sous_section: e.target.value })}
              />
              <datalist id="liste-sous-sections-fournisseur">
                {sousSectionsConnues.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <input
                type="text"
                placeholder="Nom du produit"
                value={formulaire.nom}
                onChange={(e) => setFormulaire({ ...formulaire, nom: e.target.value })}
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="Prix (CHF)"
                value={formulaire.prix}
                onChange={(e) => setFormulaire({ ...formulaire, prix: e.target.value })}
              />
              <input
                type="text"
                inputMode="numeric"
                placeholder="Stock (vide = illimité)"
                value={formulaire.stock}
                onChange={(e) => setFormulaire({ ...formulaire, stock: e.target.value })}
              />
              <input
                type="text"
                placeholder="Votre référence article (facultatif, sert aux mises à jour par fichier)"
                value={formulaire.reference}
                onChange={(e) => setFormulaire({ ...formulaire, reference: e.target.value })}
              />
              <div className="photo-produit-fournisseur">
                {formulaire.image_url && <img src={formulaire.image_url} alt="" />}
                <label className="bouton-secondaire">
                  <i className="bi bi-camera"></i> {envoiPhoto ? 'Envoi…' : formulaire.image_url ? 'Changer la photo' : 'Ajouter une photo'}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    disabled={envoiPhoto}
                    onChange={(e) => envoyerPhoto(e.target.files && e.target.files[0])}
                  />
                </label>
              </div>
              <div className="actions-fournisseur">
                <button className="valider" disabled={enregistrement || envoiPhoto} onClick={enregistrerProduit}>
                  {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
                </button>
                <button className="bouton-secondaire" onClick={() => setFormulaire(null)}>Annuler</button>
              </div>
            </div>
          )}

          {apercuImport && (
            <div className="carte-auth carte-import-fournisseur">
              <h3>Import : {apercuImport.nomFichier}</h3>
              {apercuImport.colonnesManquantes.length > 0 ? (
                <p className="souligne">
                  Colonnes introuvables dans le fichier : {apercuImport.colonnesManquantes.join(', ')}. Téléchargez le
                  « Modèle de fichier » pour voir les colonnes attendues.
                </p>
              ) : (
                <>
                  <p className="souligne">
                    {apercuImport.lignes.filter((l) => !l.erreur).length} ligne(s) prête(s) à importer
                    {apercuImport.lignes.some((l) => l.erreur)
                      ? `, ${apercuImport.lignes.filter((l) => l.erreur).length} à corriger (ignorée(s))`
                      : ''}
                    . Une ligne dont la référence existe déjà met à jour le produit.
                  </p>
                  <ul className="liste-apercu-import">
                    {apercuImport.lignes.slice(0, 40).map((l) => (
                      <li key={l.numero} className={l.erreur ? 'ligne-erreur' : ''}>
                        <span>
                          {l.nom || '(sans nom)'} — {l.metier} › {l.sous_section}
                          {Number.isFinite(l.prix) ? ` — ${l.prix.toFixed(2)} CHF` : ''}
                        </span>
                        {l.erreur && <em>ligne {l.numero} : {l.erreur}</em>}
                      </li>
                    ))}
                  </ul>
                  {apercuImport.lignes.length > 40 && (
                    <p className="souligne">… et {apercuImport.lignes.length - 40} autre(s) ligne(s).</p>
                  )}
                </>
              )}
              <div className="actions-fournisseur">
                {apercuImport.colonnesManquantes.length === 0 && (
                  <button
                    className="valider"
                    disabled={importEnCours || apercuImport.lignes.every((l) => l.erreur)}
                    onClick={lancerImport}
                  >
                    {importEnCours ? 'Import en cours…' : 'Importer ces produits'}
                  </button>
                )}
                <button
                  className="bouton-secondaire"
                  onClick={() => {
                    setApercuImport(null)
                    if (champFichier.current) champFichier.current.value = ''
                  }}
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          {resultatImport && (
            <div className="carte-auth">
              <h3>Import terminé</h3>
              <p className="souligne">
                {resultatImport.crees} produit(s) créé(s), {resultatImport.modifies} mis à jour
                {resultatImport.erreurs.length > 0 ? `, ${resultatImport.erreurs.length} ligne(s) refusée(s)` : ''}.
                {resultatImport.crees > 0 && !compte.publication_directe
                  ? ' Les nouveaux produits seront publiés après validation par 2C.'
                  : ''}
              </p>
              {resultatImport.erreurs.slice(0, 10).map((e, i) => (
                <p key={i} className="souligne">Ligne {e.ligne} : {e.message}</p>
              ))}
            </div>
          )}

          <div className="filtres-fournisseur">
            <input
              type="search"
              placeholder="Rechercher un produit, une référence…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
            />
            <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)}>
              <option value="">Tous les statuts</option>
              {Object.keys(LIBELLES_STATUT_PRODUIT).map((s) => (
                <option key={s} value={s}>{LIBELLES_STATUT_PRODUIT[s]}</option>
              ))}
            </select>
          </div>
          <p className="souligne">
            {produits.length} produit(s){nbEnAttente > 0 ? ` dont ${nbEnAttente} en attente de validation` : ''}.
          </p>

          {chargement && <p className="aucun-resultat">Chargement…</p>}
          {!chargement && produitsAffiches.length === 0 && (
            <p className="aucun-resultat">
              {produits.length === 0
                ? 'Aucun produit pour le moment. Ajoutez-en un ou importez votre catalogue.'
                : 'Aucun produit ne correspond à votre recherche.'}
            </p>
          )}
          <ul className="liste-produits-fournisseur">
            {produitsAffiches.map((p) => {
              const stockSaisi = stocks[p.id]
              const stockAffiche = stockSaisi !== undefined
                ? stockSaisi
                : p.quantite_stock === null || p.quantite_stock === undefined ? '' : String(p.quantite_stock)
              return (
                <li key={p.id} className="produit-fournisseur">
                  {p.image_url ? <img src={p.image_url} alt="" /> : <div className="image-vide"><i className="bi bi-image"></i></div>}
                  <div className="infos-produit-fournisseur">
                    <strong>{p.nom}</strong>
                    <span className="souligne">
                      {p.metier} › {p.sous_section}{p.reference ? ` · réf. ${p.reference}` : ''}
                    </span>
                    <span>{Number(p.prix).toFixed(2)} CHF</span>
                    <span className={`badge-statut-produit statut-${p.statut_validation}`}>
                      {LIBELLES_STATUT_PRODUIT[p.statut_validation] || p.statut_validation}
                    </span>
                  </div>
                  <div className="actions-produit-fournisseur">
                    <label className="stock-fournisseur">
                      <span>Stock</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="∞"
                        value={stockAffiche}
                        onChange={(e) => setStocks({ ...stocks, [p.id]: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') enregistrerStock(p) }}
                      />
                    </label>
                    {stockSaisi !== undefined && (
                      <button className="bouton-secondaire" onClick={() => enregistrerStock(p)}>OK</button>
                    )}
                    <button className="bouton-secondaire" onClick={() => ouvrirEdition(p)} title="Modifier">
                      <i className="bi bi-pencil"></i>
                    </button>
                    <button className="bouton-secondaire" onClick={() => supprimer(p)} title="Supprimer">
                      <i className="bi bi-trash"></i>
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="carte-auth">
            <h3>Votre catalogue est déjà dans un logiciel ?</h3>
            <p className="souligne">
              D'autres modes d'intégration sont prévus pour s'adapter à ce que vous utilisez déjà (synchronisation
              automatique par API, flux de catalogue…). Écrivez-nous à contact@2cdelivery.ch en nous indiquant
              l'outil que vous utilisez.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------
// Partie admin : comptes fournisseurs + produits à valider
// ---------------------------------------------------------

// Place (ou met à jour) le fournisseur sur la carte : transforme l'adresse en
// coordonnées (OpenStreetMap, gratuit) puis écrit dans la table "fournisseurs".
// existant = point déjà présent sous ce nom (ou null).
async function placerSurCarte({ nom, adresse, metier, existant }) {
  const reponse = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(adresse)}`,
    { headers: { 'Accept-Language': 'fr' } }
  )
  const resultats = await reponse.json()
  if (!Array.isArray(resultats) || resultats.length === 0) {
    return { ok: false, raison: 'adresse' }
  }
  const latitude = parseFloat(resultats[0].lat)
  const longitude = parseFloat(resultats[0].lon)
  const valeurs = { nom, adresse, metier: metier || null, latitude, longitude }
  const { error } = existant
    ? await supabase.from('fournisseurs').update(valeurs).eq('id', existant.id)
    : await supabase.from('fournisseurs').insert(valeurs)
  if (error) {
    console.error("Erreur d'écriture sur la carte :", error)
    return { ok: false, raison: 'base' }
  }
  return { ok: true }
}

function CarteCompteFournisseur({ compte, metiersConnus, pointsCarte, notifier, onModifie }) {
  const [nom, setNom] = useState(compte.nom_fournisseur)
  const [adresse, setAdresse] = useState(compte.adresse || '')
  const [statut, setStatut] = useState(compte.statut)
  const [direct, setDirect] = useState(compte.publication_directe)
  const [metiers, setMetiers] = useState(compte.metiers || [])
  const [nouveauMetier, setNouveauMetier] = useState('')
  const [enCours, setEnCours] = useState(false)

  const choix = [...new Set([...metiersConnus, ...metiers])].sort((a, b) => a.localeCompare(b, 'fr'))
  const existant = pointsCarte.find((f) => String(f.nom || '').trim().toLowerCase() === nom.trim().toLowerCase()) || null
  const [carteEnCours, setCarteEnCours] = useState(false)

  function messageCarte(resultat) {
    if (resultat.ok) return null
    return resultat.raison === 'adresse'
      ? "Adresse introuvable pour la carte : précisez la rue, le code postal et la ville."
      : "Le point n'a pas pu être écrit sur la carte."
  }

  async function mettreSurCarte() {
    if (adresse.trim() === '') {
      notifier("Indiquez d'abord l'adresse du fournisseur.")
      return
    }
    setCarteEnCours(true)
    try {
      const resultat = await placerSurCarte({ nom: nom.trim(), adresse: adresse.trim(), metier: metiers[0], existant })
      const message = messageCarte(resultat)
      if (message) notifier(message)
      else {
        notifier(existant ? 'Position mise à jour sur la carte.' : 'Fournisseur placé sur la carte.', 'info')
        onModifie()
      }
    } catch (e) {
      console.error('Erreur de localisation :', e)
      notifier('La localisation a échoué, réessayez dans un instant.')
    }
    setCarteEnCours(false)
  }

  function basculer(m) {
    setMetiers((precedent) => (precedent.includes(m) ? precedent.filter((x) => x !== m) : [...precedent, m]))
  }

  function ajouterMetier() {
    const m = nouveauMetier.trim()
    if (!m) return
    if (!metiers.includes(m)) setMetiers([...metiers, m])
    setNouveauMetier('')
  }

  async function enregistrer() {
    setEnCours(true)
    const { error } = await supabase.rpc('admin_modifier_compte_fournisseur', {
      p_user: compte.user_id,
      p_nom: nom,
      p_statut: statut,
      p_publication_directe: direct,
      p_metiers: metiers,
      p_adresse: adresse.trim()
    })
    if (error) {
      setEnCours(false)
      console.error('Erreur de mise à jour du compte fournisseur :', error)
      notifier("L'enregistrement a échoué.")
      return
    }
    // Compte validé, adresse connue, pas encore sur la carte : on l'y place
    // automatiquement (un point déjà présent n'est jamais écrasé ici).
    let messageFinal = 'Compte fournisseur enregistré.'
    if (statut === 'valide' && adresse.trim() !== '' && !existant) {
      try {
        const resultat = await placerSurCarte({ nom: nom.trim(), adresse: adresse.trim(), metier: metiers[0], existant: null })
        messageFinal = resultat.ok
          ? 'Compte enregistré et fournisseur placé sur la carte.'
          : `Compte enregistré. ${messageCarte(resultat)}`
      } catch (e) {
        console.error('Erreur de localisation :', e)
        messageFinal = 'Compte enregistré, mais la localisation sur la carte a échoué : utilisez « Placer sur la carte ».'
      }
    }
    setEnCours(false)
    notifier(messageFinal, 'info')
    onModifie()
  }

  return (
    <div className="carte-auth carte-entreprise-admin">
      <div className="entete-entreprise-admin">
        <h3>{compte.nom_fournisseur}</h3>
        <span className="souligne">
          {compte.nb_produits} produit(s)
          {Number(compte.nb_en_attente) > 0 ? ` · ${compte.nb_en_attente} à valider` : ''}
          {' · inscrit le '}
          {new Date(compte.created_at).toLocaleDateString('fr-CH')}
        </span>
      </div>
      <p className="souligne">
        Contact : {compte.contact_nom || '—'}
        {compte.email ? ` (${compte.email})` : ''}
        {compte.telephone ? ` · ${compte.telephone}` : ''}
      </p>

      <label className="champ-admin-entreprise">
        <span>Nom du fournisseur sur le site (identique à celui de la carte)</span>
        <input type="text" list={`noms-carte-${compte.user_id}`} value={nom} onChange={(e) => setNom(e.target.value)} />
        <datalist id={`noms-carte-${compte.user_id}`}>
          {pointsCarte.map((f) => (
            <option key={f.id} value={f.nom} />
          ))}
        </datalist>
      </label>

      <label className="champ-admin-entreprise">
        <span>Adresse (rue, code postal, ville)</span>
        <input type="text" value={adresse} onChange={(e) => setAdresse(e.target.value)} />
      </label>
      <p className="souligne">
        {existant
          ? `Sur la carte : oui (${existant.adresse || 'adresse non renseignée'}).`
          : 'Sur la carte : pas encore. Il y sera placé automatiquement à la validation du compte.'}
      </p>
      <button className="bouton-secondaire" disabled={carteEnCours || adresse.trim() === ''} onClick={mettreSurCarte}>
        {carteEnCours ? 'Localisation…' : existant ? 'Mettre à jour la position sur la carte' : 'Placer sur la carte maintenant'}
      </button>

      <label className="champ-admin-entreprise">
        <span>Statut</span>
        <select value={statut} onChange={(e) => setStatut(e.target.value)}>
          <option value="en_attente">En attente de validation</option>
          <option value="valide">Validé</option>
          <option value="suspendu">Suspendu</option>
        </select>
      </label>

      <label className="case-fournisseur">
        <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} />
        <span>Publication directe (ses nouveaux produits sont visibles sans validation)</span>
      </label>

      <div className="champ-admin-entreprise">
        <span>Métiers autorisés</span>
        <div className="cases-fournisseurs">
          {choix.map((m) => (
            <label key={m} className="case-fournisseur">
              <input type="checkbox" checked={metiers.includes(m)} onChange={() => basculer(m)} />
              <span>{m}</span>
            </label>
          ))}
        </div>
        <input
          type="text"
          placeholder="Autre métier (ex: Chauffage)"
          value={nouveauMetier}
          onChange={(e) => setNouveauMetier(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') ajouterMetier() }}
        />
        <button className="bouton-secondaire" onClick={ajouterMetier} disabled={nouveauMetier.trim() === ''}>
          Ajouter ce métier
        </button>
      </div>

      <button className="valider" disabled={enCours} onClick={enregistrer}>
        {enCours ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </div>
  )
}

export function AdminComptesFournisseurs({ notifier, onCatalogueChange, onCarteChange }) {
  const [comptes, setComptes] = useState([])
  const [pointsCarte, setPointsCarte] = useState([])
  const [metiersConnus, setMetiersConnus] = useState([])
  const [enAttente, setEnAttente] = useState([])
  const [selection, setSelection] = useState([])
  const [chargement, setChargement] = useState(true)
  const [enCours, setEnCours] = useState(false)
  const lienInscription = `${window.location.origin}/?fournisseur`

  async function copierLien() {
    try {
      await navigator.clipboard.writeText(lienInscription)
      notifier('Lien copié.', 'info')
    } catch (e) {
      notifier('Copie impossible : sélectionnez le lien dans le champ et copiez-le à la main.')
    }
  }

  async function charger() {
    const [rc, rm, rp, rf] = await Promise.all([
      supabase.rpc('admin_comptes_fournisseurs'),
      supabase.rpc('metiers_disponibles'),
      supabase.rpc('admin_produits_en_attente'),
      supabase.from('fournisseurs').select('id,nom,adresse,metier')
    ])
    if (!rf.error) setPointsCarte(rf.data || [])
    if (rc.error) {
      console.error('Erreur de chargement des comptes fournisseurs :', rc.error)
      notifier('Impossible de charger les comptes fournisseurs (script SQL exécuté ?).')
    } else {
      setComptes(rc.data || [])
    }
    if (!rm.error) setMetiersConnus(rm.data || [])
    if (!rp.error) setEnAttente(rp.data || [])
    setSelection([])
    setChargement(false)
  }

  useEffect(() => {
    charger()
  }, [])

  function basculer(id) {
    setSelection((precedent) => (precedent.includes(id) ? precedent.filter((x) => x !== id) : [...precedent, id]))
  }

  async function decider(decision) {
    if (selection.length === 0) return
    setEnCours(true)
    const { error } = await supabase.rpc('admin_decider_produits', {
      p_ids: selection.map(String),
      p_decision: decision
    })
    setEnCours(false)
    if (error) {
      console.error('Erreur de décision sur les produits :', error)
      notifier("L'action a échoué.")
      return
    }
    notifier(decision === 'publie' ? 'Produits publiés.' : 'Produits refusés.', 'info')
    await charger()
    if (onCatalogueChange) onCatalogueChange()
  }

  const enAttenteParFournisseur = {}
  enAttente.forEach((p) => {
    const cle = p.fournisseur || '—'
    if (!enAttenteParFournisseur[cle]) enAttenteParFournisseur[cle] = []
    enAttenteParFournisseur[cle].push(p)
  })

  return (
    <>
      <h3>Comptes fournisseurs</h3>
      <p className="souligne">
        Les fournisseurs s'inscrivent via le lien 2cdelivery.ch/?fournisseur. Validez leur compte, attribuez-leur
        leurs métiers et choisissez si leurs produits sont publiés directement ou après votre validation. Le nom
        du fournisseur doit être identique à celui de la carte (c'est lui qui relie produits, accords entreprises
        et calcul de distance).
      </p>

      <div className="carte-auth carte-lien-fournisseur">
        <h3>Lien d'inscription fournisseur</h3>
        <p className="souligne">
          Envoyez ce lien au fournisseur (email, message…) : il ouvre directement le formulaire d'inscription
          fournisseur. Il n'est visible nulle part ailleurs sur le site.
        </p>
        <input type="text" readOnly value={lienInscription} onFocus={(e) => e.target.select()} />
        <div className="actions-fournisseur">
          <button className="valider" onClick={copierLien}>
            <i className="bi bi-clipboard"></i> Copier le lien
          </button>
          <a className="bouton-secondaire" href={lienInscription} target="_blank" rel="noopener noreferrer">
            Ouvrir le lien
          </a>
        </div>
      </div>

      {enAttente.length > 0 && (
        <div className="carte-auth">
          <h3>Produits à valider ({enAttente.length})</h3>
          {Object.keys(enAttenteParFournisseur).map((fournisseur) => (
            <div key={fournisseur}>
              <p className="souligne"><strong>{fournisseur}</strong></p>
              <ul className="liste-apercu-import">
                {enAttenteParFournisseur[fournisseur].map((p) => (
                  <li key={p.id}>
                    <label className="case-fournisseur">
                      <input type="checkbox" checked={selection.includes(p.id)} onChange={() => basculer(p.id)} />
                      <span>
                        {p.nom} — {p.metier} › {p.sous_section} — {Number(p.prix).toFixed(2)} CHF
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="actions-fournisseur">
            <button
              className="bouton-secondaire"
              onClick={() => setSelection(selection.length === enAttente.length ? [] : enAttente.map((p) => p.id))}
            >
              {selection.length === enAttente.length ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
            <button className="valider" disabled={enCours || selection.length === 0} onClick={() => decider('publie')}>
              Publier la sélection
            </button>
            <button className="bouton-secondaire" disabled={enCours || selection.length === 0} onClick={() => decider('refuse')}>
              Refuser la sélection
            </button>
          </div>
        </div>
      )}

      {chargement && <p className="aucun-resultat">Chargement…</p>}
      {!chargement && comptes.length === 0 && (
        <p className="aucun-resultat">Aucun compte fournisseur pour le moment.</p>
      )}
      {comptes.map((c) => (
        <CarteCompteFournisseur
          key={`${c.user_id}-${c.statut}-${c.nom_fournisseur}-${c.adresse || ''}`}
          compte={c}
          metiersConnus={metiersConnus}
          pointsCarte={pointsCarte}
          notifier={notifier}
          onModifie={() => {
            charger()
            if (onCarteChange) onCarteChange()
          }}
        />
      ))}
    </>
  )
}
