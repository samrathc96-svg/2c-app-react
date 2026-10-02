import { useState, useEffect, useRef } from 'react'
import { jsPDF } from 'jspdf'
import { supabase } from './supabaseClient'
import './App.css'

// =========================================================
// Informations d'entreprise pour la facture PDF
// =========================================================
// "nom" est déjà le vrai nom à afficher. Le reste (adresse, contact, TVA)
// est en attente : "donneesTest" à true fait apparaître un petit
// avertissement en bas de facture tant que ce n'est pas finalisé. Une
// fois les vraies infos en main, il suffit de compléter les champs
// ci-dessous et de repasser "donneesTest" à false.
const INFOS_ENTREPRISE = {
  nom: '2C',
  adresse: "Adresse de l'entreprise — à compléter",
  contact: 'contact@2cdelivery.ch • Téléphone à compléter',
  tvaNumero: null, // ex: 'CHE-123.456.789 TVA'
  tvaTaux: null,   // ex: 8.1 (en %), une fois le statut TVA connu
  donneesTest: true
}

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

// =========================================================
// Configurateur de transformation sur mesure (Gaines Quadratique)
// =========================================================
// Le catalogue ne liste que des transformations toutes faites (tailles
// voisines, ou quelques combinaisons rond/carré fixes). Ici, le client
// choisit lui-même l'entrée et la sortie de sa pièce, sans avoir à
// chercher si la combinaison existe déjà dans la liste.
// Les tailles proposées restent les tailles standards du catalogue (les
// seules réellement disponibles chez le fournisseur).
const DIAMETRES_RONDS = [80, 100, 125, 160, 200, 224, 250, 280, 315, 355, 400, 450]
const TAILLES_QUADRA = ['200x100', '300x150', '400x200', '500x250', '600x300', '800x400']

// Longueur maximale d'une pièce sur mesure, tous moyens de livraison
// confondus (scooter/moto/vélo cargo/petit utilitaire) : une seule limite
// globale pour l'instant, plutôt que de distinguer par véhicule. 2000mm (2m)
// est une valeur de départ raisonnable pour ce que peut transporter un
// deux-roues — à ajuster facilement ici si besoin, par exemple si on veut
// un jour autoriser des pièces plus longues spécifiquement pour les
// livreurs en utilitaire.
const LONGUEUR_MAX_MM = 2000

// Prix de base par taille, utilisés uniquement pour ESTIMER le prix d'une
// pièce sur mesure (ce sont les prix des manchons / piquages déjà au
// catalogue pour ces tailles). À ajuster le jour où le vrai tarif
// fournisseur pour ces pièces sur mesure sera disponible.
const PRIX_BASE_ROND = [4.50, 5.20, 6.20, 7.80, 9.80, 11.00, 12.50, 14.50, 17.00, 20.00, 24.00, 28.50]
const PRIX_BASE_QUADRA = [11.50, 14.00, 17.50, 21.50, 26.00, 33.00]

function libelleSection(forme, taille) {
  return forme === 'rond' ? `Rond Ø${taille}mm` : `Carré ${taille}mm`
}

function estimerPrixTransformation(formeEntree, tailleEntree, formeSortie, tailleSortie, longueur) {
  const baseRond = (taille) => PRIX_BASE_ROND[DIAMETRES_RONDS.indexOf(Number(taille))]
  const baseQuadra = (taille) => PRIX_BASE_QUADRA[TAILLES_QUADRA.indexOf(taille)]

  const baseEntree = formeEntree === 'rond' ? baseRond(tailleEntree) : baseQuadra(tailleEntree)
  const baseSortie = formeSortie === 'rond' ? baseRond(tailleSortie) : baseQuadra(tailleSortie)
  if (baseEntree === undefined || baseSortie === undefined) return null

  // Coefficient de façonnage observé sur les transformations déjà au
  // catalogue : environ 1.5x le prix de base des raccords standards des
  // mêmes tailles.
  let prix = ((baseEntree + baseSortie) / 2) * 1.5

  // Supplément longueur : au-delà de 300mm (une longueur "standard" pour
  // ce type de pièce), un petit forfait par tranche de 100mm en plus.
  const longueurMm = Number(longueur) || 300
  if (longueurMm > 300) {
    prix += Math.ceil((longueurMm - 300) / 100) * 1.20
  }

  return Math.round(prix * 20) / 20 // arrondi au 0.05 le plus proche, comme le reste du catalogue
}

// Petit bip de notification (livreur) généré directement dans le
// navigateur, sans fichier audio externe à héberger. Échoue silencieusement
// si l'audio n'est pas disponible (permissions navigateur, etc.).
function jouerSonNotification() {
  try {
    const ContexteAudio = window.AudioContext || window.webkitAudioContext
    const contexte = new ContexteAudio()
    const oscillateur = contexte.createOscillator()
    const gain = contexte.createGain()
    oscillateur.connect(gain)
    gain.connect(contexte.destination)
    oscillateur.type = 'sine'
    oscillateur.frequency.setValueAtTime(880, contexte.currentTime)
    gain.gain.setValueAtTime(0.2, contexte.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, contexte.currentTime + 0.4)
    oscillateur.start()
    oscillateur.stop(contexte.currentTime + 0.4)
  } catch (e) {
    // audio indisponible - on ignore silencieusement
  }
}

// Estimation (approximative) du créneau de livraison, à partir du nombre
// de courses déjà en attente. Purement indicatif : à ajuster une fois
// qu'on aura une vraie idée des temps de trajet réels.
function estimerCreneauLivraison(nombreEnAttente) {
  const base = 20 + nombreEnAttente * 8
  return {
    min: Math.min(base, 90),
    max: Math.min(base + 15, 105)
  }
}

// Construit le document PDF de la facture, sans l'envoyer : utilisé par
// l'envoi automatique par email une fois la commande livrée
// (envoyerFactureAutomatique).
function construireFacturePDF(commande) {
  const doc = new jsPDF()
  const accent = [255, 106, 19]
  const encre = [30, 27, 23]
  const muted = [121, 112, 95]

  const numeroFacture = `2C-${String(commande.id).padStart(5, '0')}`
  const dateFacture = new Date(commande.created_at).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  })

  let y = 20

  // En-tête : entreprise à gauche, "FACTURE" + références à droite
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...encre)
  doc.text(INFOS_ENTREPRISE.nom, 15, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...muted)
  doc.text(INFOS_ENTREPRISE.adresse, 15, y + 6)
  doc.text(INFOS_ENTREPRISE.contact, 15, y + 11)
  if (INFOS_ENTREPRISE.tvaNumero) {
    doc.text(`N° TVA : ${INFOS_ENTREPRISE.tvaNumero}`, 15, y + 16)
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...accent)
  doc.text('FACTURE', 195, y, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...encre)
  doc.text(`N° ${numeroFacture}`, 195, y + 7, { align: 'right' })
  doc.text(`Date : ${dateFacture}`, 195, y + 13, { align: 'right' })
  if (commande.numero_suivi) {
    doc.text(`Suivi : ${commande.numero_suivi}`, 195, y + 19, { align: 'right' })
  }

  y += 30
  doc.setDrawColor(...accent)
  doc.setLineWidth(0.6)
  doc.line(15, y, 195, y)
  y += 10

  // Coordonnées du client
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...encre)
  doc.text('Facturé à', 15, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(commande.nom_client || '—', 15, y)
  y += 5
  if (commande.adresse) { doc.text(commande.adresse, 15, y); y += 5 }
  if (commande.telephone) { doc.text(commande.telephone, 15, y); y += 5 }
  if (commande.email) { doc.text(commande.email, 15, y); y += 5 }

  y += 8

  // Tableau des produits
  const colProduit = 17
  const colPrix = 122
  const colQte = 150
  const colTotal = 168

  doc.setFillColor(...accent)
  doc.rect(15, y - 5, 180, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(255, 255, 255)
  doc.text('Produit', colProduit, y)
  doc.text('Prix', colPrix, y)
  doc.text('Qté', colQte, y)
  doc.text('Sous-total', colTotal, y)
  y += 8

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...encre)

  // Les commandes passées avant l'ajout du détail ligne par ligne n'ont
  // pas "produits_detail" : on retombe alors sur le texte résumé, sans
  // détail de prix par article.
  const lignes = commande.produits_detail && commande.produits_detail.length > 0
    ? commande.produits_detail
    : [{ nom: commande.produits, prix: null, quantite: null }]

  lignes.forEach((ligne, index) => {
    const nomAffiche = doc.splitTextToSize(ligne.nom, 100)
    const hauteurLigne = Math.max(7, nomAffiche.length * 5)

    if (index % 2 === 1) {
      doc.setFillColor(245, 242, 235)
      doc.rect(15, y - 5, 180, hauteurLigne, 'F')
    }

    doc.text(nomAffiche, colProduit, y)
    if (ligne.prix !== null) {
      doc.text(`${ligne.prix.toFixed(2)} CHF`, colPrix, y)
      doc.text(String(ligne.quantite), colQte, y)
      doc.text(`${(ligne.prix * ligne.quantite).toFixed(2)} CHF`, colTotal, y)
    }
    y += hauteurLigne
  })

  y += 5
  doc.setDrawColor(...muted)
  doc.setLineWidth(0.2)
  doc.line(15, y, 195, y)
  y += 8

  // Totaux : TVA affichée seulement si un taux a été renseigné
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...encre)
  if (INFOS_ENTREPRISE.tvaTaux) {
    const sousTotal = commande.total / (1 + INFOS_ENTREPRISE.tvaTaux / 100)
    const montantTVA = commande.total - sousTotal
    doc.text('Sous-total HT', 140, y)
    doc.text(`${sousTotal.toFixed(2)} CHF`, 195, y, { align: 'right' })
    y += 6
    doc.text(`TVA (${INFOS_ENTREPRISE.tvaTaux}%)`, 140, y)
    doc.text(`${montantTVA.toFixed(2)} CHF`, 195, y, { align: 'right' })
    y += 6
  } else {
    doc.setFontSize(8)
    doc.setTextColor(...muted)
    doc.text('TVA non applicable', 140, y)
    doc.setFontSize(10)
    doc.setTextColor(...encre)
    y += 6
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('Total à payer', 140, y)
  doc.text(`${commande.total.toFixed(2)} CHF`, 195, y, { align: 'right' })

  if (INFOS_ENTREPRISE.donneesTest) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...muted)
    doc.text(
      "Informations d'entreprise provisoires (test) — à compléter avant tout envoi officiel.",
      15, 285
    )
  }

  return { doc, numeroFacture }
}

// Facture groupée mensuelle pour un compte entreprise : une seule facture
// listant toutes les commandes livrées du mois, chacune avec son chantier
// et l'employé qui l'a passée, plus un total général en bas. Générée
// depuis l'admin (genererFactureMensuelle), jamais automatiquement.
function construireFactureGroupeePDF(entreprise, commandes, periodeLabel) {
  const doc = new jsPDF()
  const accent = [255, 106, 19]
  const encre = [30, 27, 23]
  const muted = [121, 112, 95]

  const numeroFacture = `2C-${entreprise.id.slice(0, 8).toUpperCase()}-${periodeLabel.replace('-', '')}`
  const totalGeneral = commandes.reduce((somme, commande) => somme + commande.total, 0)

  let y = 20

  function nouvellePage() {
    doc.addPage()
    y = 20
  }

  function enteteFacture() {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(...encre)
    doc.text(INFOS_ENTREPRISE.nom, 15, y)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...muted)
    doc.text(INFOS_ENTREPRISE.adresse, 15, y + 6)
    doc.text(INFOS_ENTREPRISE.contact, 15, y + 11)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.setTextColor(...accent)
    doc.text('FACTURE MENSUELLE', 195, y, { align: 'right' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...encre)
    doc.text(`N° ${numeroFacture}`, 195, y + 7, { align: 'right' })
    doc.text(`Période : ${periodeLabel}`, 195, y + 13, { align: 'right' })

    y += 30
    doc.setDrawColor(...accent)
    doc.setLineWidth(0.6)
    doc.line(15, y, 195, y)
    y += 10

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...encre)
    doc.text('Facturé à', 15, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(entreprise.nom || '—', 15, y)
    y += 5
    if (entreprise.email) { doc.text(entreprise.email, 15, y); y += 5 }
    y += 6
  }

  enteteFacture()

  commandes.forEach((commande, indexCommande) => {
    if (y > 245) nouvellePage()

    const dateCommande = new Date(commande.created_at).toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    })

    doc.setFillColor(245, 242, 235)
    doc.rect(15, y - 5, 180, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...encre)
    doc.text(`Chantier : ${commande.chantier || '—'}   •   Technicien : ${commande.technicien || '—'}   •   ${dateCommande}`, 17, y)
    y += 9

    const lignes = commande.produits_detail && commande.produits_detail.length > 0
      ? commande.produits_detail
      : [{ nom: commande.produits, prix: null, quantite: null }]

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    lignes.forEach((ligne) => {
      if (y > 270) nouvellePage()
      const nomAffiche = doc.splitTextToSize(ligne.nom, 110)
      doc.text(nomAffiche, 20, y)
      if (ligne.prix !== null) {
        doc.text(`${ligne.quantite} x ${ligne.prix.toFixed(2)} CHF`, 160, y, { align: 'right' })
      }
      y += Math.max(5, nomAffiche.length * 5)
    })

    doc.setFont('helvetica', 'bold')
    doc.text(`Sous-total : ${commande.total.toFixed(2)} CHF`, 195, y, { align: 'right' })
    y += 4
    doc.setDrawColor(...muted)
    doc.setLineWidth(0.15)
    doc.line(15, y, 195, y)
    y += 8

    if (indexCommande === commandes.length - 1 && y > 260) nouvellePage()
  })

  if (y > 265) nouvellePage()

  doc.setDrawColor(...accent)
  doc.setLineWidth(0.6)
  doc.line(15, y, 195, y)
  y += 10
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...encre)
  doc.text('Total à payer', 140, y)
  doc.text(`${totalGeneral.toFixed(2)} CHF`, 195, y, { align: 'right' })

  if (INFOS_ENTREPRISE.donneesTest) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...muted)
    doc.text(
      "Informations d'entreprise provisoires (test) — à compléter avant tout envoi officiel.",
      15, 290
    )
  }

  return { doc, numeroFacture, totalGeneral }
}

function retirerAccents(texte) {
  return texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Évalue grossièrement la robustesse d'un mot de passe pour donner un
// repère visuel à l'inscription (pas une vraie mesure d'entropie, juste
// de quoi décourager les mots de passe évidents).
function calculerForceMotDePasse(mdp) {
  if (!mdp) return null
  let score = 0
  if (mdp.length >= 8) score++
  if (mdp.length >= 12) score++
  if (/[a-z]/.test(mdp) && /[A-Z]/.test(mdp)) score++
  if (/[0-9]/.test(mdp)) score++
  if (/[^a-zA-Z0-9]/.test(mdp)) score++

  if (mdp.length < 6 || score <= 1) return { niveau: 'faible', libelle: 'Trop faible' }
  if (score <= 3) return { niveau: 'moyen', libelle: 'Correct' }
  return { niveau: 'fort', libelle: 'Solide' }
}

// Trie une liste de produits pour l'affichage catalogue, sans modifier la
// liste d'origine. "defaut" garde l'ordre du catalogue (celui d\u00e9j\u00e0 utilis\u00e9
// partout ailleurs, ex: table admin, export CSV).
function trierProduits(produits, tri) {
  if (tri === 'defaut') return produits
  const copie = [...produits]
  if (tri === 'prixAsc') return copie.sort((a, b) => a.prix - b.prix)
  if (tri === 'prixDesc') return copie.sort((a, b) => b.prix - a.prix)
  if (tri === 'alpha') return copie.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
  return copie
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
    parMetier[ligne.metier][ligne.sous_section].push({
      id: ligne.id,
      nom: ligne.nom,
      prix: ligne.prix,
      image_url: ligne.image_url,
      quantite_stock: ligne.quantite_stock
    })
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
  const [espace, setEspace] = useState('accueil')

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
  // Accès discret à l'inscription livreur : invisible pour les visiteurs
  // normaux (plus de bouton public depuis le retrait du recrutement sur
  // l'accueil), révélé uniquement via un lien contenant ?livreur, partagé
  // directement avec les candidats recrutés en physique.
  const [accesRecrutementLivreur, setAccesRecrutementLivreur] = useState(false)

  const [nomUtilisateur, setNomUtilisateur] = useState('')
  // Disponibilité du livreur connecté (bascule lui-même) et état d'envoi
  // pendant la mise à jour, pour désactiver le bouton le temps de la requête.
  const [disponibleLivreur, setDisponibleLivreur] = useState(true)
  const [changementDisponibiliteEnCours, setChangementDisponibiliteEnCours] = useState(false)
  // État des notifications navigateur pour les livreurs (permission
  // demandée explicitement via un clic, les navigateurs l'exigent).
  const [permissionNotifs, setPermissionNotifs] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  )
  // Mémorise, par course, le dernier statut déjà notifié au client — évite
  // de renotifier plusieurs fois pour le même changement (mise à jour
  // realtime redondante, re-render, etc.).
  const dernierStatutNotifieRef = useRef({})
  const [livreurs, setLivreurs] = useState([])
  const [demandesLivreur, setDemandesLivreur] = useState([])
  // Avis clients, pour la moyenne affichée dans "Gérer les livreurs". Déclaré
  // ici (et pas juste avant son useEffet de chargement plus bas) car
  // "livreursAvecStats" l'utilise dès le rendu suivant : une "const" lue
  // avant sa ligne de déclaration plante avec "Cannot access before
  // initialization" dès qu'un admin a au moins un livreur dans sa liste.
  const [avisAdmin, setAvisAdmin] = useState([])
  // Complément de candidature livreur (téléphone, moyen de livraison,
  // documents) : renseigné après confirmation du compte, tant que
  // l'admin n'a pas encore reçu de dossier complet à examiner.
  const [demandeSoumise, setDemandeSoumise] = useState(false)
  const [telephoneCandidature, setTelephoneCandidature] = useState('')
  const [moyenLivraisonCandidature, setMoyenLivraisonCandidature] = useState('scooter')
  const [fichierIdentite, setFichierIdentite] = useState(null)
  const [fichierCasier, setFichierCasier] = useState(null)
  const [erreurCandidature, setErreurCandidature] = useState('')
  const [envoiCandidatureEnCours, setEnvoiCandidatureEnCours] = useState(false)
  const [entreprises, setEntreprises] = useState([])
  const [moisFacturationParEntreprise, setMoisFacturationParEntreprise] = useState({})
  const [facturationEnCoursId, setFacturationEnCoursId] = useState(null)
  // Modifications de statut/livreur pas encore validées dans le tableau
  // admin : { [courseId]: { statut, livreurId } }. Rien n'est envoyé à la
  // base tant que l'admin n'a pas cliqué sur "Valider" pour cette ligne —
  // ça évite un changement accidentel en faisant glisser le tableau ou en
  // cliquant de travers sur mobile.
  const [modifsAdminEnAttente, setModifsAdminEnAttente] = useState({})
  const [validationEnCoursId, setValidationEnCoursId] = useState(null)
  const [filtreAdmin, setFiltreAdmin] = useState('toutes')
  const [rechercheAdmin, setRechercheAdmin] = useState('')

  const [metiers, setMetiers] = useState([])
  const [produitsBruts, setProduitsBruts] = useState([])
  const [chargement, setChargement] = useState(true)
  const [recherche, setRecherche] = useState('')
  const [triCatalogue, setTriCatalogue] = useState('defaut')

  const [nouveauSousSection, setNouveauSousSection] = useState('')
  const [nouveauNomProduit, setNouveauNomProduit] = useState('')
  const [nouveauPrixProduit, setNouveauPrixProduit] = useState('')
  const [nouveauImageProduit, setNouveauImageProduit] = useState('')
  const [nouveauStockProduit, setNouveauStockProduit] = useState('')
  const [erreurProduit, setErreurProduit] = useState('')
  const [rechercheProduitsAdmin, setRechercheProduitsAdmin] = useState('')
  const [editionProduitId, setEditionProduitId] = useState(null)
  const [editionSousSection, setEditionSousSection] = useState('')
  const [editionNomProduit, setEditionNomProduit] = useState('')
  const [editionPrixProduit, setEditionPrixProduit] = useState('')
  const [editionImageProduit, setEditionImageProduit] = useState('')
  const [editionStockProduit, setEditionStockProduit] = useState('')
  const [televersementEnCours, setTeleversementEnCours] = useState(false)

  const [vue, setVue] = useState('accueil')
  const [sousSectionActive, setSousSectionActive] = useState(null)
  const [panier, setPanier] = useState([])
  const [configFormeEntree, setConfigFormeEntree] = useState('rond')
  const [configTailleEntree, setConfigTailleEntree] = useState(DIAMETRES_RONDS[0])
  const [configFormeSortie, setConfigFormeSortie] = useState('carre')
  const [configTailleSortie, setConfigTailleSortie] = useState(TAILLES_QUADRA[0])
  const [configLongueur, setConfigLongueur] = useState(300)
  const [recapCommande, setRecapCommande] = useState('')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const [nomClient, setNomClient] = useState('')
  const [adresseClient, setAdresseClient] = useState('')
  const [telephoneClient, setTelephoneClient] = useState('')
  const [emailClient, setEmailClient] = useState('')
  const [technicienCommande, setTechnicienCommande] = useState('')
  const [chantierCommande, setChantierCommande] = useState('')

  const [courses, setCourses] = useState([])
  const [chargementCourses, setChargementCourses] = useState(true)
  const [courseSelectionnee, setCourseSelectionnee] = useState(null)

  const [mesCommandes, setMesCommandes] = useState([])
  const [chargementCommandes, setChargementCommandes] = useState(true)

  const [mesFactures, setMesFactures] = useState([])
  const [chargementFactures, setChargementFactures] = useState(true)
  const [telechargementFactureId, setTelechargementFactureId] = useState(null)
  const [commandeSelectionnee, setCommandeSelectionnee] = useState(null)
  const [confirmationAnnulation, setConfirmationAnnulation] = useState(false)

  // Avis client sur une course livrée : { [courseId]: { note, commentaire } }
  // pour savoir si une commande a déjà été notée, plus l'état du petit
  // formulaire (étoiles + commentaire) affiché dans le détail de commande.
  const [mesAvis, setMesAvis] = useState({})
  const [noteChoisie, setNoteChoisie] = useState(0)
  const [commentaireAvis, setCommentaireAvis] = useState('')
  const [envoiAvisEnCours, setEnvoiAvisEnCours] = useState(false)

  const [commandeInvite, setCommandeInvite] = useState(null)
  const [numeroSuiviInvite, setNumeroSuiviInvite] = useState('')
  const [nomSuiviInvite, setNomSuiviInvite] = useState('')
  const [erreurSuivi, setErreurSuivi] = useState('')
  const [chargementSuivi, setChargementSuivi] = useState(false)
  const [commandesRecentesLocales, setCommandesRecentesLocales] = useState([])

  const [notification, setNotification] = useState(null)
  const [creneauLivraison, setCreneauLivraison] = useState(null)

  const total = panier.reduce((somme, produit) => somme + produit.prix * produit.quantite, 0)
  const nombreArticles = panier.reduce((somme, produit) => somme + produit.quantite, 0)

  const sousSectionsDisponibles = metiers.flatMap((metier) => metier.sousSections)

  // Recherche transversale : cherche directement dans les produits de
  // toutes les catégories, plutôt que de se limiter aux noms de catégories.
  const rechercheNormalisee = retirerAccents(recherche.trim().toLowerCase())
  const produitsRecherches = rechercheNormalisee === ''
    ? []
    : sousSectionsDisponibles.flatMap((sousSection) =>
        sousSection.produits
          .filter((produit) => retirerAccents(produit.nom.toLowerCase()).includes(rechercheNormalisee))
          .map((produit) => ({ ...produit, sousSection: sousSection.nom }))
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
        const cible = retirerAccents(`${course.client || ''} ${course.adresse || ''} ${course.produits || ''} ${course.telephone || ''}`.toLowerCase())
        return cible.includes(retirerAccents(rechercheAdmin.toLowerCase()))
      })
  const statsAdmin = {
    total: courses.length,
    actives: coursesActives.length,
    livrees: coursesLivrees.length,
    annulees: courses.filter((course) => course.statut === 'Annulée').length,
    chiffreAffaires: courses.filter((course) => course.statut !== 'Annulée').reduce((somme, course) => somme + (course.prix || 0), 0)
  }

  // Chiffre d'affaires des 7 derniers jours, pour le petit graphique
  // du tableau de bord admin.
  const chiffreParJour = (() => {
    const jours = []
    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      jours.push({
        cle: date.toISOString().slice(0, 10),
        label: date.toLocaleDateString('fr-FR', { weekday: 'short' }),
        total: 0
      })
    }
    courses
      .filter((course) => course.statut !== 'Annulée' && course.created_at)
      .forEach((course) => {
        const cle = course.created_at.slice(0, 10)
        const jour = jours.find((j) => j.cle === cle)
        if (jour) jour.total += course.prix || 0
      })
    return jours
  })()

  const maxChiffreJournalier = Math.max(1, ...chiffreParJour.map((j) => j.total))

  // Petites stats par livreur pour le tableau admin : nombre de courses
  // livrées et date de la dernière course qui lui a été assignée.
  const livreursAvecStats = livreurs.map((livreur) => {
    const coursesDuLivreur = courses.filter((course) => course.livreur_id === livreur.id)
    const derniereActivite = coursesDuLivreur.reduce((plusRecente, course) => {
      if (!course.created_at) return plusRecente
      return !plusRecente || course.created_at > plusRecente ? course.created_at : plusRecente
    }, null)
    const avisDuLivreur = avisAdmin.filter((avis) => avis.livreur_id === livreur.id)
    const noteMoyenne = avisDuLivreur.length > 0
      ? avisDuLivreur.reduce((somme, avis) => somme + avis.note, 0) / avisDuLivreur.length
      : null
    return {
      ...livreur,
      nbLivrees: coursesDuLivreur.filter((course) => course.statut === 'Livrée').length,
      derniereActivite,
      noteMoyenne,
      nbAvis: avisDuLivreur.length
    }
  })

  // Produits les plus commandés (comptage à partir du texte "produits" de
  // chaque course, en tenant compte du "xN" ajouté quand un même produit
  // est présent plusieurs fois dans une commande) et adresses générant
  // le plus de chiffre d'affaires — pour les statistiques admin avancées.
  const produitsPopulaires = (() => {
    // Garde défensive : une commande suivie sans compte n'ajoute à "courses"
    // qu'un objet minimal (id, statut...) sans "produits" ni "prix" — voir
    // rechercherCommandeInvite ci-dessous. Sans ce "|| ''", le premier
    // visiteur qui suit sa commande sans compte faisait planter l'app
    // entière (cette section est calculée à chaque rendu, pas seulement
    // côté admin).
    const compteur = {}
    courses
      .filter((course) => course.statut !== 'Annulée')
      .forEach((course) => {
        (course.produits || '').split(', ').filter(Boolean).forEach((item) => {
          const correspondance = item.match(/^(.*) x(\d+)$/)
          const nom = correspondance ? correspondance[1] : item
          const quantite = correspondance ? parseInt(correspondance[2], 10) : 1
          compteur[nom] = (compteur[nom] || 0) + quantite
        })
      })
    return Object.entries(compteur)
      .map(([nom, quantite]) => ({ nom, quantite }))
      .sort((a, b) => b.quantite - a.quantite)
      .slice(0, 5)
  })()

  const adressesTop = (() => {
    const compteur = {}
    courses
      .filter((course) => course.statut !== 'Annulée' && course.adresse)
      .forEach((course) => {
        if (!compteur[course.adresse]) {
          compteur[course.adresse] = { adresse: course.adresse, chiffreAffaires: 0, nombre: 0 }
        }
        compteur[course.adresse].chiffreAffaires += course.prix || 0
        compteur[course.adresse].nombre += 1
      })
    return Object.values(compteur)
      .sort((a, b) => b.chiffreAffaires - a.chiffreAffaires)
      .slice(0, 5)
  })()

  useEffect(() => {
    if (!notification) return
    const minuteur = setTimeout(() => setNotification(null), 3500)
    return () => clearTimeout(minuteur)
  }, [notification])

  useEffect(() => {
    setConfirmationAnnulation(false)
  }, [commandeSelectionnee])

  // Pré-remplit le nom et l'email pour un compte connecté (client ou
  // entreprise), pour ne pas avoir à les retaper à chaque commande —
  // reste modifiable si besoin.
  useEffect(() => {
    if ((role === 'entreprise' || role === 'client') && session) {
      setNomClient((precedent) => precedent || nomUtilisateur)
      setEmailClient((precedent) => precedent || session.user.email || '')
    }
  }, [role, session, nomUtilisateur])

  function afficherNotification(message, type = 'erreur') {
    setNotification({ message, type })
  }

  // Demande la permission d'afficher des notifications navigateur (livreur).
  // Doit être déclenchée par un clic : les navigateurs refusent cette
  // demande si elle n'est pas liée à une action de l'utilisateur.
  async function demanderPermissionNotifications() {
    if (typeof Notification === 'undefined') {
      afficherNotification("Les notifications ne sont pas prises en charge par ce navigateur.")
      return
    }
    const resultat = await Notification.requestPermission()
    setPermissionNotifs(resultat)
    if (resultat === 'granted') {
      afficherNotification('Notifications activées : tu seras alerté même si l\'onglet est en arrière-plan.', 'info')
    } else {
      afficherNotification("Notifications refusées. Tu peux les activer dans les réglages du navigateur.")
    }
  }

  async function changerDisponibilite(nouvelleValeur) {
    setChangementDisponibiliteEnCours(true)
    const { error } = await supabase.rpc('changer_disponibilite', { p_disponible: nouvelleValeur })
    setChangementDisponibiliteEnCours(false)
    if (error) {
      console.error('Erreur de mise à jour de la disponibilité :', error)
      afficherNotification('La mise à jour a échoué, réessaie.')
      return
    }
    setDisponibleLivreur(nouvelleValeur)
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
    // Lien discret de recrutement livreur (ex: 2cdelivery.../?livreur) :
    // révèle l'option "Livreur" dans le formulaire d'inscription et
    // l'ouvre directement, préremplie sur ce rôle — sans rien changer
    // pour un visiteur normal. L'URL est nettoyée ensuite pour ne pas
    // laisser traîner le paramètre dans la barre d'adresse.
    const parametres = new URLSearchParams(window.location.search)
    if (parametres.has('livreur')) {
      setAccesRecrutementLivreur(true)
      setRoleChoisi('livreur')
      setAfficherAuth(true)
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [])

  useEffect(() => {
    async function chargerRole() {
      if (!session) return
      const { data, error } = await supabase
        .from('profils')
        .select('role, nom, disponible, demande_soumise')
        .eq('id', session.user.id)
        .single()

      if (!error && data) {
        setRole(data.role)
        setNomUtilisateur(data.nom || '')
        setDisponibleLivreur(data.disponible !== false)
        setDemandeSoumise(data.demande_soumise === true)
        if (!modeReinitialisation) {
          setEspace(
            data.role === 'livreur' ? 'livreur' :
            data.role === 'admin' ? 'admin' :
            data.role === 'livreur_en_attente' ? 'livreurEnAttente' :
            'catalogue'
          )
          setAfficherAuth(false)
        }
      } else if (error) {
        console.error('Erreur de chargement du rôle :', error)
        // Le profil n'existe plus (ex: compte supprimé côté admin dans
        // Supabase) alors que la session d'authentification est toujours
        // active dans ce navigateur : sans ça, l'icône reste "connectée"
        // mais le menu compte ne répond plus, avec des requêtes en échec
        // en boucle. On déconnecte proprement et on prévient la personne.
        await supabase.auth.signOut()
        setRole(null)
        setEspace('accueil')
        afficherNotification('Ta session a expiré, merci de te reconnecter.', 'info')
      }
      setChargementAuth(false)
    }
    chargerRole()
  }, [session, modeReinitialisation])

  useEffect(() => {
    if (role !== 'admin') return

    async function chargerLivreurs() {
      const { data, error } = await supabase.from('profils').select('id, nom, email, disponible').eq('role', 'livreur')
      if (!error && data) {
        setLivreurs(data)
      }
    }

    async function chargerEntreprises() {
      const { data, error } = await supabase.from('profils').select('id, nom, email').eq('role', 'entreprise')
      if (!error && data) {
        setEntreprises(data)
      }
    }

    async function chargerDemandesLivreur() {
      // Seules les candidatures complètes (téléphone, moyen de livraison et
      // documents fournis) remontent ici : tant que le candidat n'a pas
      // terminé son dossier, l'admin n'a rien à examiner.
      const { data, error } = await supabase
        .from('profils')
        .select('id, nom, email, telephone, moyen_livraison, document_identite_path, document_casier_path')
        .eq('role', 'livreur_en_attente')
        .eq('demande_soumise', true)
      if (!error && data) {
        setDemandesLivreur(data)
      }
    }

    chargerLivreurs()
    chargerEntreprises()
    chargerDemandesLivreur()

    const canal = supabase
      .channel('profils-en-direct')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profils' }, () => {
        chargerLivreurs()
        chargerEntreprises()
        chargerDemandesLivreur()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [role])

  useEffect(() => {
    if (role !== 'admin') return

    async function chargerAvisAdmin() {
      const { data, error } = await supabase.from('avis').select('livreur_id, note')
      if (!error && data) {
        setAvisAdmin(data)
      }
    }
    chargerAvisAdmin()

    const canal = supabase
      .channel('avis-en-direct')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'avis' }, () => {
        chargerAvisAdmin()
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
          // Alerte livreur : une nouvelle course vient d'apparaître et
          // n'est encore prise par personne — visuel (bandeau) + son.
          if (role === 'livreur' && disponibleLivreur && !payload.new.livreur_id && payload.new.statut === 'À livrer') {
            afficherNotification('Nouvelle course disponible !', 'info')
            jouerSonNotification()
            // Notification navigateur : visible même si l'onglet n'est pas
            // au premier plan (permission à activer une fois via le bouton
            // dédié de l'espace livreur). Échoue silencieusement sinon.
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              try {
                const notifNavigateur = new Notification('Nouvelle course disponible !', {
                  body: `${payload.new.client || 'Client'} — ${payload.new.adresse || ''}`,
                  tag: `course-${payload.new.id}`
                })
                notifNavigateur.onclick = () => {
                  window.focus()
                  notifNavigateur.close()
                }
              } catch (e) {
                // notifications indisponibles - on ignore silencieusement
              }
            }
          }
        } else if (payload.eventType === 'UPDATE') {
          setCourses((precedentes) =>
            precedentes.map((c) => (c.id === payload.new.id ? payload.new : c))
          )
          // Suivi client en direct : on prévient le client (ou l'entreprise)
          // quand sa commande passe à une étape qui le concerne, une seule
          // fois par changement grâce à dernierStatutNotifieRef.
          const etapesSuivies = ['En cours', 'Livrée', 'Annulée']
          if (
            (role === 'client' || role === 'entreprise') &&
            etapesSuivies.includes(payload.new.statut) &&
            dernierStatutNotifieRef.current[payload.new.id] !== payload.new.statut
          ) {
            dernierStatutNotifieRef.current[payload.new.id] = payload.new.statut
            const messages = {
              'En cours': 'Ta commande est en route !',
              'Livrée': 'Ta commande a été livrée !',
              'Annulée': 'Ta commande a été annulée.'
            }
            const message = messages[payload.new.statut]
            afficherNotification(message, payload.new.statut === 'Annulée' ? 'erreur' : 'info')
            jouerSonNotification()
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              try {
                const notifNavigateur = new Notification(message, {
                  body: payload.new.adresse || '',
                  tag: `commande-${payload.new.id}`
                })
                notifNavigateur.onclick = () => {
                  window.focus()
                  notifNavigateur.close()
                }
              } catch (e) {
                // notifications indisponibles - on ignore silencieusement
              }
            }
          }
        } else if (payload.eventType === 'DELETE') {
          setCourses((precedentes) => precedentes.filter((c) => c.id !== payload.old.id))
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [session, role, disponibleLivreur])

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

  useEffect(() => {
    async function chargerMesAvis() {
      if (!session) {
        setMesAvis({})
        return
      }
      const { data, error } = await supabase
        .from('avis')
        .select('course_id, note, commentaire')
        .eq('client_id', session.user.id)
      if (!error && data) {
        const parCourse = {}
        data.forEach((avis) => {
          parCourse[avis.course_id] = { note: avis.note, commentaire: avis.commentaire }
        })
        setMesAvis(parCourse)
      }
    }
    chargerMesAvis()
  }, [session])

  // Le petit formulaire de note repart à zéro à chaque changement de
  // commande consultée.
  useEffect(() => {
    setNoteChoisie(0)
    setCommentaireAvis('')
  }, [commandeSelectionnee])

  useEffect(() => {
    async function chargerFactures() {
      if (!session) {
        setMesFactures([])
        setChargementFactures(false)
        return
      }
      const { data, error } = await supabase
        .from('factures')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Erreur de chargement des factures :', error)
      } else {
        setMesFactures(data)
      }
      setChargementFactures(false)
    }
    chargerFactures()
  }, [session])

  // Télécharge une facture depuis l'espace "Mes factures" : on génère une
  // URL signée à la demande (le bucket est privé) plutôt que de garder un
  // lien permanent.
  async function telechargerFacture(facture) {
    setTelechargementFactureId(facture.id)
    const { data, error } = await supabase.storage
      .from('factures')
      .createSignedUrl(facture.chemin_pdf, 60)
    setTelechargementFactureId(null)

    if (error || !data) {
      console.error('Erreur de génération du lien de téléchargement :', error)
      afficherNotification('Impossible de récupérer cette facture, réessaie.')
      return
    }

    window.open(data.signedUrl, '_blank')
  }

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
    if (nouveauMotDePasse.length < 8) {
      setErreurReinitialisation('Le mot de passe doit contenir au moins 8 caractères.')
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
    if (motDePasseInscription.length < 8) {
      setErreurInscription('Le mot de passe doit contenir au moins 8 caractères.')
      return
    }
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

  // Complément de candidature livreur : dépose la pièce d'identité et le
  // justificatif de casier judiciaire dans un bucket privé (chaque
  // candidat ne peut écrire/lire que dans son propre dossier, cf. les
  // politiques RLS de stockage), puis enregistre téléphone + moyen de
  // livraison + chemins des fichiers via une fonction RPC dédiée — les
  // documents ne sont jamais lisibles publiquement.
  async function soumettreCandidatureLivreur() {
    setErreurCandidature('')
    if (!telephoneCandidature.trim()) {
      setErreurCandidature('Merci d\'indiquer un numéro de téléphone.')
      return
    }
    if (!fichierIdentite || !fichierCasier) {
      setErreurCandidature('La pièce d\'identité et le justificatif de casier judiciaire sont tous les deux requis.')
      return
    }
    setEnvoiCandidatureEnCours(true)
    try {
      const uid = session.user.id
      const extensionIdentite = fichierIdentite.name.split('.').pop()
      const extensionCasier = fichierCasier.name.split('.').pop()
      const cheminIdentite = `${uid}/piece-identite.${extensionIdentite}`
      const cheminCasier = `${uid}/casier-judiciaire.${extensionCasier}`

      const { error: erreurUploadIdentite } = await supabase.storage
        .from('documents-livreurs')
        .upload(cheminIdentite, fichierIdentite, { upsert: true })
      if (erreurUploadIdentite) throw erreurUploadIdentite

      const { error: erreurUploadCasier } = await supabase.storage
        .from('documents-livreurs')
        .upload(cheminCasier, fichierCasier, { upsert: true })
      if (erreurUploadCasier) throw erreurUploadCasier

      const { error: erreurRpc } = await supabase.rpc('soumettre_documents_livreur', {
        p_telephone: telephoneCandidature.trim(),
        p_moyen_livraison: moyenLivraisonCandidature,
        p_document_identite_path: cheminIdentite,
        p_document_casier_path: cheminCasier
      })
      if (erreurRpc) throw erreurRpc

      setDemandeSoumise(true)
      afficherNotification('Ta candidature a bien été envoyée.', 'info')
    } catch (erreur) {
      console.error('Erreur lors de l\'envoi de la candidature livreur :', erreur)
      setErreurCandidature('L\'envoi a échoué, réessaie.')
    } finally {
      setEnvoiCandidatureEnCours(false)
    }
  }

  // Lien de consultation temporaire (60 secondes) pour un document de
  // candidature livreur — évite qu'un lien reste valable indéfiniment
  // une fois ouvert par l'admin.
  async function voirDocumentLivreur(chemin) {
    if (!chemin) return
    const { data, error } = await supabase.storage
      .from('documents-livreurs')
      .createSignedUrl(chemin, 60)
    if (error || !data) {
      console.error('Erreur de génération du lien de document :', error)
      afficherNotification("Impossible d'ouvrir ce document, réessaie.")
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
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
    setEspace('accueil')
    setAfficherAuth(false)
  }

  function ouvrirSousSection(sousSection) {
    setSousSectionActive(sousSection)
    setVue('sousSection')
  }

  function ajouterAuPanier(produit) {
    if (produit.quantite_stock !== null && produit.quantite_stock !== undefined && produit.quantite_stock <= 0) {
      afficherNotification('Ce produit est en rupture de stock.')
      return
    }
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

  // Un produit dont le stock n'est pas suivi (quantite_stock = null) est
  // toujours considéré disponible.
  function estEnRupture(produit) {
    return produit.quantite_stock !== null && produit.quantite_stock !== undefined && produit.quantite_stock <= 0
  }

  function changerFormeEntree(forme) {
    setConfigFormeEntree(forme)
    setConfigTailleEntree(forme === 'rond' ? DIAMETRES_RONDS[0] : TAILLES_QUADRA[0])
  }

  function changerFormeSortie(forme) {
    setConfigFormeSortie(forme)
    setConfigTailleSortie(forme === 'rond' ? DIAMETRES_RONDS[0] : TAILLES_QUADRA[0])
  }

  function ajouterTransformationAuPanier() {
    if (Number(configLongueur) > LONGUEUR_MAX_MM) {
      afficherNotification(`La longueur maximale pour une pièce sur mesure est de ${LONGUEUR_MAX_MM}mm.`)
      return
    }
    const prix = estimerPrixTransformation(
      configFormeEntree, configTailleEntree, configFormeSortie, configTailleSortie, configLongueur
    )
    if (prix === null) {
      afficherNotification('Choisis une entrée et une sortie valides.')
      return
    }
    const nom = `Transformation sur mesure : ${libelleSection(configFormeEntree, configTailleEntree)} → ${libelleSection(configFormeSortie, configTailleSortie)} (long. ${configLongueur}mm)`
    const id = `transfo-${configFormeEntree}-${configTailleEntree}-${configFormeSortie}-${configTailleSortie}-${configLongueur}`
    ajouterAuPanier({ id, nom, prix })
    afficherNotification('Pièce sur mesure ajoutée au panier.', 'info')
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

  // La course liée à une commande (même donnée que statutCommande, mais
  // on a besoin de la ligne complète pour l'avis : id de la course et
  // livreur assigné).
  function courseDeCommande(commandeId) {
    return courses.find((c) => c.commande_id === commandeId)
  }

  async function envoyerAvis(courseId) {
    if (noteChoisie < 1) return
    setEnvoiAvisEnCours(true)
    const { error } = await supabase.rpc('laisser_avis', {
      p_course_id: courseId,
      p_note: noteChoisie,
      p_commentaire: commentaireAvis.trim() || null
    })
    setEnvoiAvisEnCours(false)
    if (error) {
      console.error("Erreur lors de l'envoi de l'avis :", error)
      afficherNotification("L'envoi de ton avis a échoué, réessaie.")
      return
    }
    setMesAvis((precedent) => ({
      ...precedent,
      [courseId]: { note: noteChoisie, commentaire: commentaireAvis.trim() || null }
    }))
    afficherNotification('Merci pour ton avis !', 'info')
  }

  // Résumé court des produits pour la liste "Mes commandes" (le détail
  // complet reste affiché quand on clique sur la commande) : évite
  // d'afficher toute la liste sur une seule ligne quand il y a
  // beaucoup d'articles.
  function resumeProduits(texte) {
    const items = texte.split(', ')
    if (items.length === 1) return items[0]
    return `${items[0]} +${items.length - 1} autre${items.length - 1 > 1 ? 's' : ''}`
  }

  async function mettreAJourCreneau() {
    const { data, error } = await supabase.rpc('compter_file_attente')
    if (!error && typeof data === 'number') {
      setCreneauLivraison(estimerCreneauLivraison(data))
    }
  }

  // Détail d'une commande, sous forme de tableau (produit, prix,
  // quantité, sous-total) quand on a le détail ligne par ligne. Les
  // commandes passées avant l'ajout de ce détail n'ont pas cette
  // information : on retombe alors sur la simple liste des noms.
  function detailCommande(commande) {
    if (commande.produits_detail && commande.produits_detail.length > 0) {
      return (
        <table className="tableau-produits-commande">
          <thead>
            <tr>
              <th>Produit</th>
              <th>Prix</th>
              <th>Qté</th>
              <th>Sous-total</th>
            </tr>
          </thead>
          <tbody>
            {commande.produits_detail.map((ligne, index) => (
              <tr key={index}>
                <td>{ligne.nom}</td>
                <td>{ligne.prix.toFixed(2)} CHF</td>
                <td>{ligne.quantite}</td>
                <td>{(ligne.prix * ligne.quantite).toFixed(2)} CHF</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    return (
      <ul className="liste-produits-commande">
        {(commande.produits || '').split(', ').filter(Boolean).map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    )
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
    if (role === 'entreprise' && (technicienCommande.trim() === '' || chantierCommande.trim() === '')) {
      afficherNotification("Merci de renseigner le nom du chantier et le nom de l'employé qui commande.")
      return
    }

    setEnvoiEnCours(true)

    const listeProduits = panier
      .map((produit) => (produit.quantite > 1 ? `${produit.nom} x${produit.quantite}` : produit.nom))
      .join(', ')

    // Détail ligne par ligne (nom, prix, quantité), pour pouvoir
    // afficher un vrai tableau dans le détail de la commande —
    // "listeProduits" ci-dessus ne garde qu'un texte résumé, sans prix.
    const detailProduits = panier.map((produit) => ({
      id: produit.id,
      nom: produit.nom,
      prix: produit.prix,
      quantite: produit.quantite
    }))

    const { data: nouvelleCommande, error: erreurCommande } = await supabase
      .rpc('creer_commande', {
        p_produits: listeProduits,
        p_produits_detail: detailProduits,
        p_total: total,
        p_nom_client: nomClient,
        p_adresse: adresseClient,
        p_telephone: telephoneClient,
        p_email: emailClient,
        p_user_id: session ? session.user.id : null,
        p_technicien: role === 'entreprise' ? technicienCommande.trim() : null,
        p_chantier: role === 'entreprise' ? chantierCommande.trim() : null
      })
      .single()

    setEnvoiEnCours(false)

    if (erreurCommande) {
      console.error("Erreur d'enregistrement de la commande :", erreurCommande)
      if (erreurCommande.message && erreurCommande.message.includes('Stock insuffisant')) {
        afficherNotification("Stock insuffisant pour un ou plusieurs produits de votre panier. Merci d'ajuster les quantités.")
      } else {
        afficherNotification("Une erreur est survenue, la commande n'a pas pu être enregistrée.")
      }
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
    // Pour un compte client ou entreprise connecté, on garde le nom et
    // l'email (toujours les mêmes) : seuls l'adresse (et, pour une
    // entreprise, le chantier/technicien) changent d'une commande à
    // l'autre. Pour une commande invité (sans compte), on repart de zéro.
    if (role !== 'entreprise' && role !== 'client') {
      setNomClient('')
      setEmailClient('')
    }
    setAdresseClient('')
    setTelephoneClient('')
    setTechnicienCommande('')
    setChantierCommande('')
    setVue('commande')
    mettreAJourCreneau()
  }

  function retourAccueil() {
    setVue('accueil')
    setSousSectionActive(null)
  }

  // Envoie automatiquement la facture par email au client dès que sa
  // commande passe au statut "Livrée" — comme ça, la facture correspond
  // toujours à une commande réellement livrée, jamais à une commande en
  // cours ou annulée. Se déroule en arrière-plan : si ça échoue (pas
  // d'email renseigné, souci réseau...), ça n'empêche jamais de valider
  // la livraison elle-même.
  // Exception : les commandes d'un compte entreprise (facturation_mensuelle)
  // ne partent jamais individuellement — elles sont regroupées dans la
  // facture mensuelle générée depuis l'admin (genererFactureMensuelle).
  // Sauvegarde une facture déjà générée (PDF) dans le Storage et dans la
  // table "factures", pour qu'elle reste consultable dans "Mes factures"
  // même après l'envoi de l'email. N'empêche jamais l'envoi de la facture
  // si ça échoue — juste loggé, l'email reste le canal principal.
  async function enregistrerFacture({ numeroFacture, userId, commandeId = null, periodeDebut = null, periodeFin = null, montant, doc }) {
    try {
      const cheminPdf = `${userId}/${numeroFacture}.pdf`
      const { error: erreurUpload } = await supabase.storage
        .from('factures')
        .upload(cheminPdf, doc.output('blob'), { contentType: 'application/pdf', upsert: true })

      if (erreurUpload) {
        console.error("Erreur d'enregistrement de la facture (storage) :", erreurUpload)
        return
      }

      const { error: erreurLigne } = await supabase.from('factures').insert({
        numero_facture: numeroFacture,
        user_id: userId,
        commande_id: commandeId,
        periode_debut: periodeDebut,
        periode_fin: periodeFin,
        montant_total: montant,
        chemin_pdf: cheminPdf
      })

      if (erreurLigne) {
        console.error("Erreur d'enregistrement de la facture (table) :", erreurLigne)
      }
    } catch (erreur) {
      console.error("Erreur inattendue lors de l'enregistrement de la facture :", erreur)
    }
  }

  async function envoyerFactureAutomatique(commandeId) {
    const { data, error } = await supabase
      .rpc('obtenir_commande_facture', { p_commande_id: commandeId })
      .single()

    if (error || !data || !data.email || data.facturation_mensuelle) {
      if (error) console.error('Erreur de récupération de la commande pour la facture :', error)
      return
    }

    const { doc, numeroFacture } = construireFacturePDF(data)
    const pdfBase64 = doc.output('datauristring').split(',')[1]

    supabase.functions
      .invoke('envoyer-facture-email', {
        body: { email: data.email, nomClient: data.nom_client, numeroFacture, pdfBase64 }
      })
      .catch((erreurEmail) => {
        console.error("Erreur d'envoi automatique de la facture :", erreurEmail)
      })

    // Copie consultable dans "Mes factures" — seulement pour les commandes
    // passées par un compte (un invité n'a pas d'espace où la retrouver,
    // il garde l'email).
    if (data.user_id) {
      enregistrerFacture({ numeroFacture, userId: data.user_id, commandeId, montant: data.total, doc })
    }
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

    if (nouveauStatut === 'Livrée' && course.commande_id) {
      envoyerFactureAutomatique(course.commande_id)
    }
  }

  async function annulerCommande(commande) {
    const estProprietaireConnecte = session && commande.user_id === session.user.id

    if (estProprietaireConnecte) {
      // Compte connecté : la ligne "courses" est déjà dans l'état local
      // (RLS l'autorise), on l'utilise pour cibler la mise à jour.
      const course = courses.find((c) => c.commande_id === commande.id)
      if (!course) return

      const { error } = await supabase.from('courses').update({ statut: 'Annulée' }).eq('id', course.id)
      if (error) {
        console.error("Erreur d'annulation :", error)
        afficherNotification("L'annulation a échoué, réessaie.")
        return
      }
      setCourses((precedentes) =>
        precedentes.map((c) => (c.id === course.id ? { ...c, statut: 'Annulée' } : c))
      )
    } else {
      // Sans compte : juste après la commande, "courses" ne contient pas
      // encore la ligne correspondante (elle n'est injectée que par une
      // recherche via rechercherCommandeInvite) — avant, le code
      // attendait cette ligne pour TOUT le monde et quittait silencieusement
      // si elle manquait, ce qui bloquait l'annulation juste après avoir
      // commandé. On appelle directement le RPC dédié (seule voie possible
      // sans compte, la table "courses" n'étant pas lisible directement),
      // puis on force le statut local puisqu'on ne peut pas la relire.
      const { error } = await supabase.rpc('annuler_commande_invite', {
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
        precedentes.some((c) => c.commande_id === commande.id)
          ? precedentes.map((c) => (c.commande_id === commande.id ? { ...c, statut: 'Annulée' } : c))
          : [...precedentes, { id: `invite-${commande.id}`, commande_id: commande.id, statut: 'Annulée' }]
      )
    }

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
    if (data[0].statut && data[0].statut !== 'Livrée' && data[0].statut !== 'Annulée') {
      mettreAJourCreneau()
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

    if (nouveauStatut === 'Livrée') {
      const course = courses.find((c) => c.id === courseId)
      if (course && course.commande_id) {
        envoyerFactureAutomatique(course.commande_id)
      }
    }
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

  // Validation/refus d'une demande de compte livreur (inscription en
  // attente) : ces deux opérations passent par des fonctions RPC
  // côté base de données, qui vérifient elles-mêmes que l'appelant est
  // bien admin — le client ne peut pas modifier le rôle d'un autre
  // compte directement.
  async function approuverLivreur(profilId) {
    const { error } = await supabase.rpc('approuver_livreur', { p_profil_id: profilId })
    if (error) {
      console.error("Erreur de validation du livreur :", error)
      afficherNotification("La validation a échoué, réessaie.")
      return
    }
    setDemandesLivreur(demandesLivreur.filter((d) => d.id !== profilId))
    afficherNotification('Compte livreur validé.', 'info')
    // Les documents d'identité ne servent plus une fois la décision prise :
    // suppression automatique du stockage (pas de conservation au-delà du
    // strict nécessaire pour la vérification).
    supabase.rpc('nettoyer_documents_livreur', { p_profil_id: profilId }).then(({ error: erreurNettoyage }) => {
      if (erreurNettoyage) console.error('Erreur de nettoyage des documents livreur :', erreurNettoyage)
    })
  }

  async function refuserDemandeLivreur(profilId) {
    if (!window.confirm('Refuser cette demande de compte livreur ? Le compte redevient un compte client normal.')) return
    const { error } = await supabase.rpc('refuser_demande_livreur', { p_profil_id: profilId })
    if (error) {
      console.error('Erreur de refus de la demande :', error)
      afficherNotification('Le refus a échoué, réessaie.')
      return
    }
    setDemandesLivreur(demandesLivreur.filter((d) => d.id !== profilId))
    afficherNotification('Demande refusée.', 'info')
    supabase.rpc('nettoyer_documents_livreur', { p_profil_id: profilId }).then(({ error: erreurNettoyage }) => {
      if (erreurNettoyage) console.error('Erreur de nettoyage des documents livreur :', erreurNettoyage)
    })
  }

  async function desactiverLivreur(profilId) {
    if (!window.confirm('Désactiver ce livreur ? Il repassera en compte client normal.')) return
    const { error } = await supabase.rpc('desactiver_livreur', { p_profil_id: profilId })
    if (error) {
      console.error('Erreur de désactivation du livreur :', error)
      afficherNotification('La désactivation a échoué, réessaie.')
      return
    }
    setLivreurs(livreurs.filter((livreur) => livreur.id !== profilId))
    afficherNotification('Livreur désactivé.', 'info')
  }

  // Y a-t-il, pour cette course, un choix de statut/livreur différent de
  // ce qui est enregistré et pas encore validé ?
  function aModificationEnAttente(course) {
    const modif = modifsAdminEnAttente[course.id]
    if (!modif) return false
    const statutChange = modif.statut !== undefined && modif.statut !== course.statut
    const livreurChange = modif.livreurId !== undefined && modif.livreurId !== (course.livreur_id || '')
    return statutChange || livreurChange
  }

  // Envoie réellement les changements en attente pour une ligne du
  // tableau admin (statut et/ou livreur), déclenché par le bouton
  // "Valider" plutôt qu'automatiquement à la sélection.
  async function validerModificationsAdmin(course) {
    const modif = modifsAdminEnAttente[course.id]
    if (!modif || !aModificationEnAttente(course)) return

    setValidationEnCoursId(course.id)

    if (modif.statut !== undefined && modif.statut !== course.statut) {
      await changerStatutAdmin(course.id, modif.statut)
    }
    if (modif.livreurId !== undefined && modif.livreurId !== (course.livreur_id || '')) {
      await assignerLivreur(course.id, modif.livreurId)
    }

    setValidationEnCoursId(null)
    setModifsAdminEnAttente((precedent) => {
      const copie = { ...precedent }
      delete copie[course.id]
      return copie
    })
  }

  // Envoie une vraie photo produit vers le stockage Supabase ("Storage",
  // bucket public "produits") et renvoie son URL publique, à mettre dans
  // image_url. Nécessite que ce bucket existe côté Supabase (voir
  // instructions données à part) : c'est la seule étape à faire une fois,
  // à la main, dans le dashboard.
  async function televerserImageProduit(fichier) {
    if (!fichier) return null
    setTeleversementEnCours(true)

    const extension = fichier.name.split('.').pop()
    const nomFichier = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`

    const { error } = await supabase.storage.from('produits').upload(nomFichier, fichier)
    setTeleversementEnCours(false)

    if (error) {
      console.error("Erreur d'envoi de l'image :", error)
      afficherNotification("L'envoi de la photo a échoué, réessaie (vérifie que le bucket \"produits\" existe et est public).")
      return null
    }

    const { data } = supabase.storage.from('produits').getPublicUrl(nomFichier)
    return data.publicUrl
  }

  // Export CSV des courses actuellement affichées à l'admin (respecte le
  // filtre de statut et la recherche en cours). Ouvre directement le
  // téléchargement dans le navigateur, sans passer par le serveur.
  function exporterCoursesCSV() {
    const entetes = ['ID', 'Client', 'Téléphone', 'Adresse', 'Produits', 'Prix (CHF)', 'Statut', 'Livreur', 'Date']
    const lignes = coursesFiltreesAdmin.map((course) => {
      const livreur = livreurs.find((l) => l.id === course.livreur_id)
      return [
        course.id,
        course.client,
        course.telephone || '',
        course.adresse,
        course.produits,
        (course.prix || 0).toFixed(2),
        course.statut,
        livreur ? livreur.nom : '',
        course.created_at ? new Date(course.created_at).toLocaleDateString('fr-FR') : ''
      ]
    })

    const echapper = (valeur) => `"${String(valeur).replace(/"/g, '""')}"`
    // Séparateur point-virgule et BOM UTF-8 : Excel en France/Suisse
    // interprète mieux les caractères accentués et les colonnes ainsi.
    const contenu = [entetes, ...lignes].map((ligne) => ligne.map(echapper).join(';')).join('\r\n')

    const blob = new Blob(['﻿' + contenu], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const lien = document.createElement('a')
    lien.href = url
    lien.download = `courses_2C_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(lien)
    lien.click()
    document.body.removeChild(lien)
    URL.revokeObjectURL(url)
  }

  // Génère et envoie la facture mensuelle groupée d'un compte entreprise,
  // pour le mois choisi (format "YYYY-MM", ex: "2026-09"). Regroupe toutes
  // ses commandes livrées sur ce mois en une seule facture PDF.
  async function genererFactureMensuelle(entreprise, moisValeur) {
    if (!moisValeur) {
      afficherNotification('Choisis un mois avant de générer la facture.')
      return
    }

    setFacturationEnCoursId(entreprise.id)

    const [annee, mois] = moisValeur.split('-').map(Number)
    const debut = new Date(Date.UTC(annee, mois - 1, 1)).toISOString()
    const fin = new Date(Date.UTC(mois === 12 ? annee + 1 : annee, mois === 12 ? 0 : mois, 1)).toISOString()

    const { data, error } = await supabase.rpc('obtenir_commandes_entreprise_periode', {
      p_entreprise_id: entreprise.id,
      p_debut: debut,
      p_fin: fin
    })

    setFacturationEnCoursId(null)

    if (error) {
      console.error('Erreur de récupération des commandes entreprise :', error)
      afficherNotification('Impossible de récupérer les commandes de cette entreprise, réessaie.')
      return
    }

    if (!data || data.length === 0) {
      afficherNotification('Aucune commande livrée pour cette entreprise sur ce mois.', 'info')
      return
    }

    const { doc, numeroFacture, totalGeneral } = construireFactureGroupeePDF(entreprise, data, moisValeur)
    const pdfBase64 = doc.output('datauristring').split(',')[1]

    const { error: erreurEnvoi } = await supabase.functions.invoke('envoyer-facture-email', {
      body: { email: entreprise.email, nomClient: entreprise.nom, numeroFacture, pdfBase64 }
    })

    if (erreurEnvoi) {
      console.error("Erreur d'envoi de la facture mensuelle :", erreurEnvoi)
      afficherNotification("L'envoi a échoué, réessaie.")
      return
    }

    enregistrerFacture({
      numeroFacture,
      userId: entreprise.id,
      periodeDebut: debut,
      periodeFin: fin,
      montant: totalGeneral,
      doc
    })

    afficherNotification(`Facture mensuelle envoyée à ${entreprise.nom} (${data.length} commande(s)).`, 'info')
  }

  async function ajouterProduit() {
    const prixNombre = parseFloat(nouveauPrixProduit.replace(',', '.'))
    const stockTexte = nouveauStockProduit.trim()
    const stockNombre = stockTexte === '' ? null : parseInt(stockTexte, 10)

    if (nouveauNomProduit.trim() === '' || nouveauSousSection.trim() === '' || nouveauPrixProduit.trim() === '') {
      setErreurProduit('Merci de remplir la sous-section, le nom et le prix.')
      return
    }
    if (isNaN(prixNombre) || prixNombre < 0) {
      setErreurProduit('Le prix doit être un nombre positif.')
      return
    }
    if (stockTexte !== '' && (isNaN(stockNombre) || stockNombre < 0)) {
      setErreurProduit('La quantité en stock doit être un nombre positif (ou vide si illimité).')
      return
    }

    setErreurProduit('')

    const { data, error } = await supabase
      .from('produits')
      .insert({
        metier: 'Ventilation',
        sous_section: nouveauSousSection.trim(),
        nom: nouveauNomProduit.trim(),
        prix: prixNombre,
        image_url: nouveauImageProduit.trim() || null,
        quantite_stock: stockNombre
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
    setNouveauImageProduit('')
    setNouveauStockProduit('')
    afficherNotification('Produit ajouté au catalogue.', 'info')
  }

  function commencerEditionProduit(produit) {
    setEditionProduitId(produit.id)
    setEditionSousSection(produit.sous_section)
    setEditionNomProduit(produit.nom)
    setEditionPrixProduit(String(produit.prix))
    setEditionImageProduit(produit.image_url || '')
    setEditionStockProduit(produit.quantite_stock === null || produit.quantite_stock === undefined ? '' : String(produit.quantite_stock))
  }

  function annulerEditionProduit() {
    setEditionProduitId(null)
  }

  async function enregistrerModificationProduit(id) {
    const prixNombre = parseFloat(editionPrixProduit.replace(',', '.'))
    const stockTexte = editionStockProduit.trim()
    const stockNombre = stockTexte === '' ? null : parseInt(stockTexte, 10)

    if (editionNomProduit.trim() === '' || editionSousSection.trim() === '' || isNaN(prixNombre) || prixNombre < 0) {
      afficherNotification('Champs invalides, vérifie le nom, la sous-section et le prix.')
      return
    }
    if (stockTexte !== '' && (isNaN(stockNombre) || stockNombre < 0)) {
      afficherNotification('La quantité en stock doit être un nombre positif (ou vide si illimité).')
      return
    }

    const { error } = await supabase
      .from('produits')
      .update({
        sous_section: editionSousSection.trim(),
        nom: editionNomProduit.trim(),
        prix: prixNombre,
        image_url: editionImageProduit.trim() || null,
        quantite_stock: stockNombre
      })
      .eq('id', id)

    if (error) {
      console.error('Erreur de modification du produit :', error)
      afficherNotification('La modification a échoué, réessaie.')
      return
    }

    const nouveauxProduits = produitsBruts.map((p) =>
      p.id === id
        ? {
            ...p,
            sous_section: editionSousSection.trim(),
            nom: editionNomProduit.trim(),
            prix: prixNombre,
            image_url: editionImageProduit.trim() || null,
            quantite_stock: stockNombre
          }
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
              {espace !== 'accueil' && !role && (
                <button onClick={() => { setEspace('accueil'); setAfficherMenu(false) }}>
                  <i className="bi bi-house"></i> Accueil
                </button>
              )}
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
              {role === 'admin' && (
                <button onClick={() => { setEspace('facturationEntreprises'); setAfficherMenu(false) }}>
                  <i className="bi bi-building"></i> Facturation entreprises
                </button>
              )}
              <button onClick={() => { setEspace('mentionsLegales'); setAfficherMenu(false) }}>
                <i className="bi bi-file-earmark-text"></i> Mentions légales
              </button>
              <button onClick={() => { setEspace('cgv'); setAfficherMenu(false) }}>
                <i className="bi bi-file-earmark-text"></i> Conditions générales
              </button>
              <button onClick={() => { setEspace('confidentialite'); setAfficherMenu(false) }}>
                <i className="bi bi-shield-lock"></i> Confidentialité
              </button>
            </nav>
          </div>
        </div>
      )}

      <div
        className="bloc-logo"
        role="button"
        tabIndex={0}
        title="Retour à l'accueil"
        onClick={() => { setEspace('accueil'); setAfficherAuth(false); setAfficherMenu(false) }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setEspace('accueil'); setAfficherAuth(false); setAfficherMenu(false) } }}
      >
        <div className="logo">
          <span className="lettre">C</span>
          <span className="chiffre">2</span>
        </div>
        <p className="sous-marque">
          <span className="sous-marque-accent">Deli</span>
          <span className="sous-marque-encre">very</span>
        </p>
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
                        onKeyDown={(e) => { if (e.key === 'Enter') connexion() }}
                      />
                      <input
                        type="password"
                        placeholder="Mot de passe"
                        value={motDePasseConnexion}
                        onChange={(e) => setMotDePasseConnexion(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') connexion() }}
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
                  <div className="choix-role">
                    <button className={roleChoisi === 'client' ? 'actif' : ''} onClick={() => setRoleChoisi('client')}>Client</button>
                    <button className={roleChoisi === 'entreprise' ? 'actif' : ''} onClick={() => setRoleChoisi('entreprise')}>Entreprise</button>
                    {accesRecrutementLivreur && (
                      <button className={roleChoisi === 'livreur' ? 'actif' : ''} onClick={() => setRoleChoisi('livreur')}>Livreur</button>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder={roleChoisi === 'entreprise' ? "Nom de l'entreprise" : 'Nom'}
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
                  {calculerForceMotDePasse(motDePasseInscription) && (
                    <p className={`force-mot-de-passe force-${calculerForceMotDePasse(motDePasseInscription).niveau}`}>
                      {calculerForceMotDePasse(motDePasseInscription).libelle}
                    </p>
                  )}
                  {motDePasseInscription.length > 0 && motDePasseInscription.length < 8 && (
                    <p className="souligne">8 caractères minimum.</p>
                  )}
                  {roleChoisi === 'entreprise' && (
                    <p className="souligne-configurateur">
                      Compte partagé : tes employés pourront se connecter avec ce même
                      identifiant pour commander (en indiquant leur nom à chaque commande).
                      Toutes les commandes livrées seront regroupées en une seule facture,
                      envoyée chaque mois.
                    </p>
                  )}
                  {roleChoisi === 'livreur' && (
                    <p className="souligne-configurateur">
                      Ton inscription sera examinée avant validation. Conditions requises : pièce
                      d'identité valide, casier judiciaire vierge, et disposer d'un moyen de livraison
                      (scooter, moto, vélo cargo ou petit utilitaire).
                    </p>
                  )}
                  {erreurInscription && <p className="souligne">{erreurInscription}</p>}
                  {messageInscription && <p className="souligne">{messageInscription}</p>}
                  <button className="valider" disabled={motDePasseInscription.length > 0 && motDePasseInscription.length < 8} onClick={inscription}>S'inscrire</button>
                </div>
              </div>
            )}

            {!modeReinitialisation && !chargementAuth && session && (
              <div className="carte-auth">
                <p className="slogan">{nomUtilisateur || session.user.email}</p>
                <p className="slogan">
                  Rôle : {
                    role === 'livreur' ? 'Livreur' :
                    role === 'livreur_en_attente' ? 'Livreur (en attente de validation)' :
                    role === 'admin' ? 'Admin' :
                    role === 'entreprise' ? 'Entreprise' :
                    'Client'
                  }
                </p>
                {role === 'livreur' && espace !== 'livreur' && (
                  <button className="valider" onClick={() => { setEspace('livreur'); setAfficherAuth(false) }}>
                    Aller à mon espace livreur
                  </button>
                )}
                {role === 'livreur_en_attente' && espace !== 'livreurEnAttente' && (
                  <button className="valider" onClick={() => { setEspace('livreurEnAttente'); setAfficherAuth(false) }}>
                    Voir ma demande
                  </button>
                )}
                {role === 'admin' && espace !== 'admin' && (
                  <button className="valider" onClick={() => { setEspace('admin'); setAfficherAuth(false) }}>
                    Aller à mon espace admin
                  </button>
                )}
                {(espace === 'livreur' || espace === 'admin' || espace === 'livreurEnAttente') && (
                  <button className="valider" onClick={() => { setEspace('catalogue'); setAfficherAuth(false) }}>
                    Voir le catalogue
                  </button>
                )}
                {espace !== 'mesCommandes' && (
                  <button className="valider" onClick={() => { setEspace('mesCommandes'); setCommandeSelectionnee(null); setAfficherAuth(false) }}>
                    Voir mes commandes
                  </button>
                )}
                {(role === 'client' || role === 'entreprise') && espace !== 'mesFactures' && (
                  <button className="valider" onClick={() => { setEspace('mesFactures'); setAfficherAuth(false) }}>
                    Voir mes factures
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
                placeholder="Rechercher un produit..."
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />

              {rechercheNormalisee === '' && (
                <div className="grille-categories">
                  {sousSectionsDisponibles.map((sousSection, index) => (
                    <div key={`${sousSection.nom}-${index}`} className="carte-categorie" onClick={() => ouvrirSousSection(sousSection)}>
                      <span className="icon-categorie"><i className={`bi bi-${iconsParSousSection[sousSection.nom] || 'box-seam'}`}></i></span>
                      <span>{sousSection.nom}</span>
                    </div>
                  ))}
                </div>
              )}

              {rechercheNormalisee !== '' && produitsRecherches.length > 0 && (
                <select className="tri-catalogue" value={triCatalogue} onChange={(e) => setTriCatalogue(e.target.value)}>
                  <option value="defaut">Trier par défaut</option>
                  <option value="prixAsc">Prix croissant</option>
                  <option value="prixDesc">Prix décroissant</option>
                  <option value="alpha">Ordre alphabétique</option>
                </select>
              )}

              {rechercheNormalisee !== '' && (
                <ul className="liste-produits">
                  {trierProduits(produitsRecherches, triCatalogue).map((produit) => (
                    <li key={produit.id}>
                      {produit.image_url && (
                        <img src={produit.image_url} alt="" className="vignette-produit-catalogue" />
                      )}
                      <span>
                        {produit.nom}
                        <br />
                        <span className="souligne">{produit.sousSection}</span>
                      </span>
                      <span className="prix">{produit.prix.toFixed(2)} CHF</span>
                      {estEnRupture(produit) ? (
                        <span className="rupture-stock">Rupture de stock</span>
                      ) : (
                        <>
                          {produit.quantite_stock !== null && produit.quantite_stock !== undefined && produit.quantite_stock <= 3 && (
                            <span className="stock-faible">Plus que {produit.quantite_stock} en stock</span>
                          )}
                          <button onClick={() => ajouterAuPanier(produit)}>Ajouter</button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {rechercheNormalisee !== '' && produitsRecherches.length === 0 && (
                <p className="aucun-resultat">Aucun produit trouvé pour cette recherche.</p>
              )}
            </>
          )}

          {vue === 'sousSection' && (
            <>
              <p className="retour" onClick={retourAccueil}>← Retour</p>
              <div className="fil-ariane">
                <span onClick={retourAccueil}>Accueil</span>
                <span className="separateur-fil">›</span>
                <span className="actif">{sousSectionActive.nom}</span>
              </div>
              <h3>{sousSectionActive.nom}</h3>

              {sousSectionActive.nom === 'Gaines Quadratique' && (
                <div className="carte-faq carte-configurateur">
                  <strong>Composer ma pièce sur mesure</strong>
                  <p className="souligne-configurateur">
                    Transformation, réduction... choisis directement l'entrée et la sortie de ta pièce,
                    sans chercher si la combinaison existe déjà ci-dessous.
                  </p>

                  <div className="ligne-configurateur">
                    <span className="etiquette-configurateur">Entrée</span>
                    <select value={configFormeEntree} onChange={(e) => changerFormeEntree(e.target.value)}>
                      <option value="rond">Rond</option>
                      <option value="carre">Carré / rectangulaire</option>
                    </select>
                    <select value={configTailleEntree} onChange={(e) => setConfigTailleEntree(e.target.value)}>
                      {(configFormeEntree === 'rond' ? DIAMETRES_RONDS : TAILLES_QUADRA).map((taille) => (
                        <option key={taille} value={taille}>
                          {configFormeEntree === 'rond' ? `Ø${taille}mm` : `${taille}mm`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="ligne-configurateur">
                    <span className="etiquette-configurateur">Sortie</span>
                    <select value={configFormeSortie} onChange={(e) => changerFormeSortie(e.target.value)}>
                      <option value="rond">Rond</option>
                      <option value="carre">Carré / rectangulaire</option>
                    </select>
                    <select value={configTailleSortie} onChange={(e) => setConfigTailleSortie(e.target.value)}>
                      {(configFormeSortie === 'rond' ? DIAMETRES_RONDS : TAILLES_QUADRA).map((taille) => (
                        <option key={taille} value={taille}>
                          {configFormeSortie === 'rond' ? `Ø${taille}mm` : `${taille}mm`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="ligne-configurateur">
                    <span className="etiquette-configurateur">Longueur</span>
                    <input
                      type="number"
                      min="50"
                      max={LONGUEUR_MAX_MM}
                      step="10"
                      value={configLongueur}
                      onChange={(e) => setConfigLongueur(e.target.value)}
                    />
                    <span className="souligne">mm</span>
                  </div>

                  {Number(configLongueur) > LONGUEUR_MAX_MM && (
                    <p className="avertissement-configurateur">
                      La longueur maximale pour une pièce sur mesure est de {LONGUEUR_MAX_MM}mm.
                    </p>
                  )}

                  <div className="pied-configurateur">
                    <span className="prix-configurateur">
                      ≈ {(estimerPrixTransformation(configFormeEntree, configTailleEntree, configFormeSortie, configTailleSortie, configLongueur) || 0).toFixed(2)} CHF
                    </span>
                    <button
                      onClick={ajouterTransformationAuPanier}
                      disabled={Number(configLongueur) > LONGUEUR_MAX_MM}
                    >
                      Ajouter
                    </button>
                  </div>
                  <p className="souligne-configurateur">
                    Prix estimé, ajusté si besoin après validation. Longueur maximale : {LONGUEUR_MAX_MM}mm.
                  </p>
                </div>
              )}

              {sousSectionActive.produits.length > 1 && (
                <select className="tri-catalogue" value={triCatalogue} onChange={(e) => setTriCatalogue(e.target.value)}>
                  <option value="defaut">Trier par défaut</option>
                  <option value="prixAsc">Prix croissant</option>
                  <option value="prixDesc">Prix décroissant</option>
                  <option value="alpha">Ordre alphabétique</option>
                </select>
              )}

              <ul className="liste-produits">
                {trierProduits(sousSectionActive.produits, triCatalogue).map((produit) => (
                  <li key={produit.nom}>
                    {produit.image_url && (
                      <img src={produit.image_url} alt="" className="vignette-produit-catalogue" />
                    )}
                    <span>{produit.nom}</span>
                    <span className="prix">{produit.prix.toFixed(2)} CHF</span>
                    {estEnRupture(produit) ? (
                      <span className="rupture-stock">Rupture de stock</span>
                    ) : (
                      <>
                        {produit.quantite_stock !== null && produit.quantite_stock !== undefined && produit.quantite_stock <= 3 && (
                          <span className="stock-faible">Plus que {produit.quantite_stock} en stock</span>
                        )}
                        <button onClick={() => ajouterAuPanier(produit)}>Ajouter</button>
                      </>
                    )}
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
                  placeholder={role === 'entreprise' ? "Nom de l'entreprise" : 'Nom du client'}
                  value={nomClient}
                  onChange={(e) => setNomClient(e.target.value)}
                />
                {role === 'entreprise' && (
                  <>
                    <input
                      type="text"
                      placeholder="Nom du chantier"
                      value={chantierCommande}
                      onChange={(e) => setChantierCommande(e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Nom de l'employé qui commande"
                      value={technicienCommande}
                      onChange={(e) => setTechnicienCommande(e.target.value)}
                    />
                  </>
                )}
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
              {role === 'entreprise' && (
                <p className="souligne">
                  Cette commande sera incluse dans la facture mensuelle de l'entreprise, une fois livrée.
                </p>
              )}
              {creneauLivraison && (
                <p className="creneau-estime">
                  <i className="bi bi-clock"></i> Livraison estimée sous {creneauLivraison.min} à {creneauLivraison.max} min
                </p>
              )}
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

          {permissionNotifs !== 'granted' && permissionNotifs !== 'unsupported' && (
            <button className="bouton-petit" onClick={demanderPermissionNotifications}>
              <i className="bi bi-bell"></i> Être notifié de l'avancement
            </button>
          )}
          {permissionNotifs === 'granted' && (
            <p className="souligne"><i className="bi bi-bell-fill"></i> Notifications activées</p>
          )}

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
              <ul className="liste-mes-commandes">
                {mesCommandes.map((commande, index) => (
                  <li
                    key={commande.id}
                    onClick={() => {
                      setCommandeSelectionnee(index)
                      if (statutCommande(commande.id) !== 'Livrée' && statutCommande(commande.id) !== 'Annulée') {
                        mettreAJourCreneau()
                      }
                    }}
                  >
                    <span>
                      {resumeProduits(commande.produits)}
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
              <p className="souligne">Produits commandés :</p>
              {detailCommande(mesCommandes[commandeSelectionnee])}
              {mesCommandes[commandeSelectionnee].chantier && (
                <p className="souligne">Chantier : {mesCommandes[commandeSelectionnee].chantier}</p>
              )}
              {mesCommandes[commandeSelectionnee].technicien && (
                <p className="souligne">Commandé par : {mesCommandes[commandeSelectionnee].technicien}</p>
              )}
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

                  {statutCommande(mesCommandes[commandeSelectionnee].id) !== 'Livrée' && creneauLivraison && (
                    <p className="creneau-estime">
                      <i className="bi bi-clock"></i> Livraison estimée sous {creneauLivraison.min} à {creneauLivraison.max} min
                    </p>
                  )}

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

                  {statutCommande(mesCommandes[commandeSelectionnee].id) === 'Livrée' && (() => {
                    const course = courseDeCommande(mesCommandes[commandeSelectionnee].id)
                    if (!course) return null
                    const avisExistant = mesAvis[course.id]
                    return (
                      <div className="carte-avis">
                        {avisExistant ? (
                          <>
                            <strong>Ton avis</strong>
                            <p className="etoiles-avis">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <i key={n} className={`bi ${n <= avisExistant.note ? 'bi-star-fill' : 'bi-star'}`}></i>
                              ))}
                            </p>
                            {avisExistant.commentaire && <p className="souligne">{avisExistant.commentaire}</p>}
                          </>
                        ) : (
                          <>
                            <strong>Comment s'est passée la livraison ?</strong>
                            <p className="etoiles-avis etoiles-choix">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <i
                                  key={n}
                                  className={`bi ${n <= noteChoisie ? 'bi-star-fill' : 'bi-star'}`}
                                  onClick={() => setNoteChoisie(n)}
                                ></i>
                              ))}
                            </p>
                            <textarea
                              className="commentaire-avis"
                              placeholder="Un commentaire ? (optionnel)"
                              value={commentaireAvis}
                              onChange={(e) => setCommentaireAvis(e.target.value)}
                            />
                            <button
                              className="valider"
                              disabled={noteChoisie < 1 || envoiAvisEnCours}
                              onClick={() => envoyerAvis(course.id)}
                            >
                              {envoiAvisEnCours ? 'Envoi...' : 'Envoyer mon avis'}
                            </button>
                          </>
                        )}
                      </div>
                    )
                  })()}
                </>
              )}
            </>
          )}
        </>
      )}

      {espace === 'mesFactures' && (role === 'client' || role === 'entreprise') && (
        <>
          <p className="retour" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>
          <h3>Mes factures</h3>

          {chargementFactures && (
            <div className="skeleton-liste">
              <div className="skeleton-ligne"></div>
              <div className="skeleton-ligne"></div>
            </div>
          )}

          {!chargementFactures && mesFactures.length === 0 && (
            <p className="aucun-resultat">
              Aucune facture pour l'instant{role === 'entreprise' ? " — elles apparaîtront ici une fois la première facture mensuelle envoyée." : '.'}
            </p>
          )}

          {!chargementFactures && mesFactures.length > 0 && (
            <ul className="liste-mes-commandes liste-factures">
              {mesFactures.map((facture) => (
                <li key={facture.id}>
                  <span>
                    N° {facture.numero_facture}
                    <br />
                    <span className="souligne">
                      {facture.periode_debut
                        ? `Facture mensuelle — ${new Date(facture.periode_debut).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`
                        : new Date(facture.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                      {' · '}{facture.montant_total.toFixed(2)} CHF
                    </span>
                  </span>
                  <button
                    className="bouton-secondaire"
                    disabled={telechargementFactureId === facture.id}
                    onClick={() => telechargerFacture(facture)}
                  >
                    {telechargementFactureId === facture.id ? '...' : 'Télécharger'}
                  </button>
                </li>
              ))}
            </ul>
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
              <p className="souligne">Produits commandés :</p>
              {detailCommande(commandeInvite)}
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

                  {statutCommande(commandeInvite.id) !== 'Livrée' && creneauLivraison && (
                    <p className="creneau-estime">
                      <i className="bi bi-clock"></i> Livraison estimée sous {creneauLivraison.min} à {creneauLivraison.max} min
                    </p>
                  )}

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

      {espace === 'accueil' && (
        <>
          <p className="accueil-intro">
            La livraison de matériel de chantier, pensée pour les artisans : commande en quelques clics,
            un livreur proche de toi s'en charge, et ta commande arrive directement sur le chantier.
          </p>

          <div className="boutons-hero">
            <button className="valider" onClick={() => setEspace('catalogue')}>
              <i className="bi bi-shop"></i> Voir le catalogue
            </button>
          </div>

          <h3 className="titre-accueil">Comment ça marche</h3>
          <div className="grille-etapes">
            <div className="etape-accueil">
              <span className="numero-etape">1</span>
              <i className="bi bi-cart-check"></i>
              <strong>Tu commandes</strong>
              <p>Choisis tes produits dans le catalogue, avec ou sans compte.</p>
            </div>
            <div className="etape-accueil">
              <span className="numero-etape">2</span>
              <i className="bi bi-bicycle"></i>
              <strong>Un livreur prend en charge</strong>
              <p>Un livreur disponible à proximité récupère et prépare ta commande.</p>
            </div>
            <div className="etape-accueil">
              <span className="numero-etape">3</span>
              <i className="bi bi-geo-alt"></i>
              <strong>Livraison sur chantier</strong>
              <p>Ta commande arrive directement où tu en as besoin, avec un suivi en temps réel.</p>
            </div>
          </div>

          <h3 className="titre-accueil">Pourquoi 2C Delivery</h3>
          <div className="grille-avantages">
            <div className="avantage-accueil">
              <i className="bi bi-lightning-charge"></i>
              <span>Livraison rapide, directement sur chantier</span>
            </div>
            <div className="avantage-accueil">
              <i className="bi bi-person-check"></i>
              <span>Aucun compte nécessaire pour commander</span>
            </div>
            <div className="avantage-accueil">
              <i className="bi bi-star"></i>
              <span>Livreurs notés par les clients</span>
            </div>
            <div className="avantage-accueil">
              <i className="bi bi-signpost-2"></i>
              <span>Suivi de commande en temps réel</span>
            </div>
          </div>

          <p className="lien-carte" onClick={() => setEspace('apropos')}>
            En savoir plus sur nous →
          </p>
        </>
      )}

      {espace === 'faq' && (
        <>
          <p className="retour" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>
          <h3>FAQ</h3>

          <div className="carte-faq">
            <strong>Comment suivre ma commande ?</strong>
            <p>
              Utilise le numéro de suivi reçu à la validation de ta commande, via le menu ☰ → "Suivre ma commande".
              Si tu as créé un compte, tu la retrouves aussi automatiquement dans "Mes commandes".
            </p>
          </div>

          <div className="carte-faq">
            <strong>Dois-je créer un compte pour commander ?</strong>
            <p>
              Non, tu peux commander sans compte : un numéro de suivi t'est donné à la fin.
              Créer un compte te permet simplement de retrouver tout ton historique de commandes automatiquement.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Puis-je annuler ma commande ?</strong>
            <p>
              Oui, tant qu'elle est encore au statut "À livrer", depuis l'écran de suivi ou "Mes commandes".
              Une fois "En cours", l'annulation n'est plus possible.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Comment se fait la livraison ?</strong>
            <p>
              Selon le livreur qui prend en charge ta commande et le format de celle-ci : scooter, moto, vélo cargo ou petit utilitaire.
              Ce choix n'est pas fait par le client, il dépend de la disponibilité et du véhicule du livreur.
            </p>
          </div>

          <div className="carte-faq">
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

          <p className="slogan">Du rayon au chantier, en un clic.</p>

          <div className="carte-faq">
            <strong>Notre mission</strong>
            <p>
              <strong>2C</strong> est un service de livraison pensé pour les artisans du bâtiment : on livre rapidement,
              directement sur chantier, les petits consommables qui manquent au dernier moment — sans avoir à quitter le chantier
              pour aller en magasin.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Nos métiers</strong>
            <p>
              On démarre avec le métier de la <strong>ventilation</strong> (montage de gaines quadratiques et spiro, du
              supportage à la finition), avec l'ambition d'ajouter d'autres métiers du BTP par la suite.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Notre livraison</strong>
            <p>
              Nos livreurs se déplacent en scooter, moto, vélo cargo ou petit utilitaire pour aller vite, même en ville ou sur des accès difficiles.
            </p>
          </div>
        </>
      )}

      {espace === 'mentionsLegales' && (
        <>
          <p className="retour" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>
          <h3>Mentions légales</h3>

          <p className="aucun-resultat">
            L'immatriculation de l'entreprise est en cours de finalisation. Les informations marquées
            <strong> [à compléter]</strong> seront mises à jour dès que la raison sociale sera enregistrée.
          </p>

          <div className="carte-faq">
            <strong>Éditeur du site</strong>
            <p>
              2C Delivery, exploité par Samrath Chau.<br />
              Adresse : <strong>[adresse du siège à compléter]</strong><br />
              Numéro d'immatriculation (IDE / RC) : <strong>[à compléter]</strong><br />
              Email de contact : <strong>contact@2cdelivery.ch</strong>
            </p>
          </div>

          <div className="carte-faq">
            <strong>Responsable de publication</strong>
            <p>Samrath Chau.</p>
          </div>

          <div className="carte-faq">
            <strong>Hébergement</strong>
            <p>
              Site hébergé par Vercel Inc. (vercel.com).<br />
              Base de données et authentification hébergées par Supabase Inc. (supabase.com).<br />
              Suivi technique des erreurs assuré par Sentry (sentry.io) — aucune donnée de paiement n'y transite.
            </p>
          </div>
        </>
      )}

      {espace === 'cgv' && (
        <>
          <p className="retour" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>
          <h3>Conditions générales</h3>

          <p className="aucun-resultat">
            Version provisoire, à faire valider par un professionnel avant la mise en ligne définitive du service
            — notamment les points marqués <strong>[à compléter]</strong>.
          </p>

          <div className="carte-faq">
            <strong>Objet</strong>
            <p>
              2C Delivery propose un service de commande et de livraison de petits consommables pour les
              métiers du bâtiment, directement sur chantier.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Commande</strong>
            <p>
              La commande se fait depuis le catalogue, avec ou sans compte. Un numéro de suivi est fourni à la
              validation. Le client peut annuler sa commande tant qu'elle est au statut "À livrer" ; l'annulation
              n'est plus possible une fois la commande "En cours".
            </p>
          </div>

          <div className="carte-faq">
            <strong>Délais de livraison</strong>
            <p>
              Les créneaux affichés sont estimatifs et dépendent du nombre de courses en attente au moment de la
              commande. Ils ne constituent pas un engagement horaire ferme.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Prix et paiement</strong>
            <p><strong>[Modalités de paiement à compléter]</strong></p>
          </div>

          <div className="carte-faq">
            <strong>Droit de rétractation</strong>
            <p><strong>[À compléter avec un professionnel, selon le droit applicable]</strong></p>
          </div>

          <div className="carte-faq">
            <strong>Responsabilité</strong>
            <p>
              2C Delivery met tout en œuvre pour livrer les commandes dans les meilleurs délais, sans garantir
              un horaire précis. La responsabilité de 2C Delivery ne saurait être engagée en cas de retard dû à
              des circonstances hors de son contrôle (météo, trafic, indisponibilité temporaire d'un livreur).
            </p>
          </div>

          <div className="carte-faq">
            <strong>Droit applicable et litiges</strong>
            <p>
              2C Delivery est basée en France ; le droit français est applicable, sous réserve des dispositions
              impératives protégeant les consommateurs dans leur pays de résidence (notamment pour la clientèle
              basée en Suisse, à Genève notamment). <strong>[Point à faire valider avec un professionnel du droit
              compte tenu de la vente transfrontalière France–Suisse]</strong>
            </p>
          </div>
        </>
      )}

      {espace === 'confidentialite' && (
        <>
          <p className="retour" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>
          <h3>Politique de confidentialité</h3>

          <div className="carte-faq">
            <strong>Données collectées</strong>
            <p>
              Nom, adresse de livraison, numéro de téléphone, email, et historique des commandes. Pour les
              comptes créés, le mot de passe est stocké de façon sécurisée (haché) via Supabase Auth et n'est
              jamais visible par 2C Delivery.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Pourquoi ces données</strong>
            <p>
              Uniquement pour traiter et livrer la commande, contacter le client si besoin, envoyer la
              confirmation de commande, et — pour les comptes entreprise — établir la facturation mensuelle.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Qui y a accès</strong>
            <p>
              L'équipe 2C Delivery (administration) et le livreur assigné à la commande, uniquement le temps
              nécessaire à la livraison.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Prestataires techniques</strong>
            <p>
              Supabase (hébergement de la base de données), Vercel (hébergement du site), Sentry (détection
              d'erreurs techniques, sans donnée de paiement).
            </p>
          </div>

          <div className="carte-faq">
            <strong>Durée de conservation</strong>
            <p><strong>[À compléter — durée légale de conservation à valider]</strong></p>
          </div>

          <div className="carte-faq">
            <strong>Tes droits</strong>
            <p>
              Tu peux demander l'accès, la rectification ou la suppression de tes données en écrivant à
              <strong> contact@2cdelivery.ch</strong>.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Cookies</strong>
            <p>
              Le site n'utilise pas de cookies publicitaires. Seuls des éléments techniques nécessaires au
              fonctionnement (connexion) et l'outil de suivi d'erreurs Sentry sont utilisés.
            </p>
          </div>
        </>
      )}

      {espace === 'livreurEnAttente' && role === 'livreur_en_attente' && (
        <>
          <p className="retour" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>

          {!demandeSoumise ? (
            <>
              <h3>Compléter ta candidature</h3>
              <div className="carte-auth">
                <p className="souligne-configurateur">
                  Ton compte a bien été créé. Il manque encore les informations demandées à
                  l'inscription pour que l'admin puisse examiner ta candidature : téléphone, moyen
                  de livraison, pièce d'identité et justificatif de casier judiciaire.
                </p>
                <input
                  type="tel"
                  placeholder="Numéro de téléphone"
                  value={telephoneCandidature}
                  onChange={(e) => setTelephoneCandidature(e.target.value)}
                />
                <select
                  value={moyenLivraisonCandidature}
                  onChange={(e) => setMoyenLivraisonCandidature(e.target.value)}
                >
                  <option value="scooter">Scooter</option>
                  <option value="moto">Moto</option>
                  <option value="velo_cargo">Vélo cargo</option>
                  <option value="utilitaire">Petit utilitaire</option>
                </select>
                <label className="champ-fichier">
                  Pièce d'identité (carte d'identité ou passeport)
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setFichierIdentite(e.target.files?.[0] || null)}
                  />
                </label>
                <label className="champ-fichier">
                  Justificatif de casier judiciaire (extrait vierge)
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setFichierCasier(e.target.files?.[0] || null)}
                  />
                </label>
                <p className="souligne-configurateur">
                  Ces documents ne sont visibles que par l'administrateur, le temps de l'examen de
                  ta candidature, puis supprimés automatiquement dès qu'une décision est prise.
                </p>
                {erreurCandidature && <p className="souligne">{erreurCandidature}</p>}
                <button
                  className="valider"
                  disabled={envoiCandidatureEnCours}
                  onClick={soumettreCandidatureLivreur}
                >
                  {envoiCandidatureEnCours ? 'Envoi en cours...' : 'Envoyer ma candidature'}
                </button>
              </div>
            </>
          ) : (
            <>
              <h3>Demande en cours</h3>
              <div className="carte-faq">
                <strong>Ta demande est en cours de validation</strong>
                <p>
                  Ton dossier a bien été reçu. Un administrateur doit encore valider ton
                  compte avant que tu puisses accéder aux courses disponibles — tu recevras l'accès dès que ce sera fait.
                </p>
              </div>
            </>
          )}
        </>
      )}

      {espace === 'livreur' && role === 'livreur' && (
        <>
          <p className="retour" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>

          <button
            className={`bouton-disponibilite ${disponibleLivreur ? 'actif' : ''}`}
            disabled={changementDisponibiliteEnCours}
            onClick={() => changerDisponibilite(!disponibleLivreur)}
          >
            <i className={`bi ${disponibleLivreur ? 'bi-toggle-on' : 'bi-toggle-off'}`}></i>
            {disponibleLivreur ? 'Disponible' : 'Indisponible'}
          </button>

          {permissionNotifs !== 'granted' && permissionNotifs !== 'unsupported' && (
            <button className="bouton-petit" onClick={demanderPermissionNotifications}>
              <i className="bi bi-bell"></i> Activer les notifications
            </button>
          )}
          {permissionNotifs === 'granted' && (
            <p className="souligne"><i className="bi bi-bell-fill"></i> Notifications activées</p>
          )}

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
                    <span className="prix">{(course.prix || 0).toFixed(2)} CHF</span>
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
                    <span className="prix">{(course.prix || 0).toFixed(2)} CHF</span>
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
                        <span className="prix">{(course.prix || 0).toFixed(2)} CHF</span>
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
              <a
                className="bouton-petit"
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(courses[courseSelectionnee].adresse)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <i className="bi bi-signpost-2"></i> Itinéraire
              </a>
              {courses[courseSelectionnee].chantier && (
                <p className="souligne">Chantier : {courses[courseSelectionnee].chantier}</p>
              )}
              {courses[courseSelectionnee].technicien && (
                <p className="souligne">Commandé par : {courses[courseSelectionnee].technicien}</p>
              )}
              {courses[courseSelectionnee].telephone && (
                <p className="souligne">
                  <a href={`tel:${courses[courseSelectionnee].telephone}`}>
                    <i className="bi bi-telephone"></i> {courses[courseSelectionnee].telephone}
                  </a>
                </p>
              )}
              <p className="total-panier">{(courses[courseSelectionnee].prix || 0).toFixed(2)} CHF</p>

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
          <button className="bouton-petit" onClick={() => setEspace('facturationEntreprises')}>
            <i className="bi bi-building"></i> Facturation entreprises
          </button>
          <button className="bouton-petit" onClick={() => setEspace('livreursListe')}>
            <i className="bi bi-people"></i> Gérer les livreurs
          </button>

          {demandesLivreur.length > 0 && (
            <div className="carte-faq">
              <strong>Demandes de compte livreur ({demandesLivreur.length})</strong>
              {demandesLivreur.map((demande) => (
                <div key={demande.id} className="ligne-demande-livreur">
                  <div className="details-demande-livreur">
                    <span>{demande.nom || demande.email}</span>
                    <span className="souligne">
                      {demande.telephone || 'Téléphone non fourni'}
                      {' · '}
                      {demande.moyen_livraison === 'moto' ? 'Moto' :
                        demande.moyen_livraison === 'velo_cargo' ? 'Vélo cargo' :
                        demande.moyen_livraison === 'scooter' ? 'Scooter' :
                        demande.moyen_livraison === 'utilitaire' ? 'Petit utilitaire' : 'Moyen non précisé'}
                    </span>
                    <div className="boutons-demande-livreur">
                      <button className="bouton-document-livreur" onClick={() => voirDocumentLivreur(demande.document_identite_path)}>
                        <i className="bi bi-file-earmark-person"></i> Pièce d'identité
                      </button>
                      <button className="bouton-document-livreur" onClick={() => voirDocumentLivreur(demande.document_casier_path)}>
                        <i className="bi bi-file-earmark-text"></i> Casier judiciaire
                      </button>
                    </div>
                  </div>
                  <div className="boutons-demande-livreur">
                    <button className="bouton-approuver" onClick={() => approuverLivreur(demande.id)}>
                      Approuver
                    </button>
                    <button className="bouton-refuser" onClick={() => refuserDemandeLivreur(demande.id)}>
                      Refuser
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

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

          <p className="souligne" style={{ textAlign: 'center' }}>7 derniers jours</p>
          <div className="graphique-ca">
            {chiffreParJour.map((jour) => (
              <div key={jour.cle} className="barre-jour" title={`${jour.total.toFixed(2)} CHF`}>
                <div
                  className="barre-jour-valeur"
                  style={{ height: `${Math.max(4, (jour.total / maxChiffreJournalier) * 100)}%` }}
                ></div>
                <span className="barre-jour-label">{jour.label}</span>
              </div>
            ))}
          </div>

          <h3 className="titre-accueil">Produits les plus commandés</h3>
          {produitsPopulaires.length === 0 ? (
            <p className="aucun-resultat">Pas encore assez de données.</p>
          ) : (
            <div className="liste-top">
              {produitsPopulaires.map((produit, index) => (
                <div key={produit.nom} className="ligne-top">
                  <span className="rang-top">{index + 1}</span>
                  <span className="libelle-top">{produit.nom}</span>
                  <span className="valeur-top">{produit.quantite}×</span>
                </div>
              ))}
            </div>
          )}

          <h3 className="titre-accueil">Meilleures adresses (chiffre d'affaires)</h3>
          {adressesTop.length === 0 ? (
            <p className="aucun-resultat">Pas encore assez de données.</p>
          ) : (
            <div className="liste-top">
              {adressesTop.map((adresse, index) => (
                <div key={adresse.adresse} className="ligne-top">
                  <span className="rang-top">{index + 1}</span>
                  <span className="libelle-top">
                    {adresse.adresse}
                    <span className="souligne"> ({adresse.nombre} commande{adresse.nombre > 1 ? 's' : ''})</span>
                  </span>
                  <span className="valeur-top">{adresse.chiffreAffaires.toFixed(2)} CHF</span>
                </div>
              ))}
            </div>
          )}

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

          <button className="bouton-secondaire" onClick={exporterCoursesCSV}>
            <i className="bi bi-download"></i> Exporter en CSV ({coursesFiltreesAdmin.length})
          </button>

          {chargementCourses && (
            <div className="skeleton-liste">
              <div className="skeleton-ligne"></div>
              <div className="skeleton-ligne"></div>
              <div className="skeleton-ligne"></div>
            </div>
          )}

          {!chargementCourses && coursesFiltreesAdmin.length > 0 && (
            <>
              <p className="indice-defilement-tableau">← Fais glisser le tableau pour voir le statut et le livreur →</p>
              <div className="tableau-scroll">
              <table className="tableau-admin">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Adresse</th>
                    <th>Produits</th>
                    <th>Prix</th>
                    <th>Statut</th>
                    <th>Livreur</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {coursesFiltreesAdmin.map((course) => {
                    const modif = modifsAdminEnAttente[course.id]
                    const statutAffiche = modif?.statut ?? course.statut
                    const livreurAffiche = modif?.livreurId ?? (course.livreur_id || '')
                    const modifie = aModificationEnAttente(course)

                    return (
                    <tr key={course.id} className={modifie ? 'ligne-modifiee' : ''}>
                      <td>
                        {course.client}
                        {course.telephone && <><br /><span className="souligne">{course.telephone}</span></>}
                      </td>
                      <td>{course.adresse}</td>
                      <td>
                        <ul className="liste-produits-table">
                          {(course.produits || '').split(', ').filter(Boolean).map((item, index) => (
                            <li key={index}>{item}</li>
                          ))}
                        </ul>
                      </td>
                      <td>{(course.prix || 0).toFixed(2)} CHF</td>
                      <td>
                        <select
                          value={statutAffiche}
                          onChange={(e) =>
                            setModifsAdminEnAttente((precedent) => ({
                              ...precedent,
                              [course.id]: { statut: e.target.value, livreurId: precedent[course.id]?.livreurId ?? (course.livreur_id || '') }
                            }))
                          }
                        >
                          {[...STATUTS, 'Annulée'].map((statut) => (
                            <option key={statut} value={statut}>{statut}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={livreurAffiche}
                          onChange={(e) =>
                            setModifsAdminEnAttente((precedent) => ({
                              ...precedent,
                              [course.id]: { statut: precedent[course.id]?.statut ?? course.statut, livreurId: e.target.value }
                            }))
                          }
                        >
                          <option value="">Non assigné</option>
                          {livreurs.map((livreur) => (
                            <option key={livreur.id} value={livreur.id}>{livreur.nom || 'Sans nom'}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          className="bouton-valider-ligne"
                          disabled={!modifie || validationEnCoursId === course.id}
                          onClick={() => validerModificationsAdmin(course)}
                        >
                          {validationEnCoursId === course.id ? '...' : 'Valider'}
                        </button>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}
          {!chargementCourses && coursesFiltreesAdmin.length === 0 && (
            <p className="aucun-resultat">Aucune commande pour ce filtre.</p>
          )}
        </>
      )}

      {espace === 'facturationEntreprises' && role === 'admin' && (
        <>
          <p className="retour" onClick={() => setEspace('admin')}>← Retour au tableau de bord</p>
          <h3>Facturation entreprises</h3>
          <p className="souligne-configurateur">
            Une facture par mois, regroupant toutes les commandes livrées sur la période choisie.
          </p>

          {entreprises.length === 0 && (
            <p className="aucun-resultat">Aucun compte entreprise inscrit pour l'instant.</p>
          )}

          {entreprises.map((entreprise) => (
            <div key={entreprise.id} className="carte-faq carte-entreprise">
              <strong>{entreprise.nom || 'Entreprise sans nom'}</strong>
              <p className="souligne">{entreprise.email}</p>
              <div className="ligne-configurateur">
                <input
                  type="month"
                  value={moisFacturationParEntreprise[entreprise.id] || ''}
                  onChange={(e) =>
                    setMoisFacturationParEntreprise((precedent) => ({ ...precedent, [entreprise.id]: e.target.value }))
                  }
                />
                <button
                  className="valider"
                  disabled={facturationEnCoursId === entreprise.id}
                  onClick={() => genererFactureMensuelle(entreprise, moisFacturationParEntreprise[entreprise.id])}
                >
                  {facturationEnCoursId === entreprise.id ? 'Envoi en cours...' : 'Générer et envoyer'}
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {espace === 'livreursListe' && role === 'admin' && (
        <>
          <p className="retour" onClick={() => setEspace('admin')}>← Retour au tableau de bord</p>
          <h3>Livreurs</h3>

          {livreursAvecStats.length === 0 && (
            <p className="aucun-resultat">Aucun livreur pour l'instant.</p>
          )}

          {livreursAvecStats.length > 0 && (
            <div className="tableau-scroll">
              <table className="tableau-admin">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Email</th>
                    <th>Statut</th>
                    <th>Courses livrées</th>
                    <th>Note moyenne</th>
                    <th>Dernière activité</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {livreursAvecStats.map((livreur) => (
                    <tr key={livreur.id}>
                      <td>{livreur.nom || 'Sans nom'}</td>
                      <td>{livreur.email}</td>
                      <td>
                        <span className={`badge-disponibilite ${livreur.disponible ? 'actif' : ''}`}>
                          {livreur.disponible ? 'Disponible' : 'Indisponible'}
                        </span>
                      </td>
                      <td>{livreur.nbLivrees}</td>
                      <td>
                        {livreur.noteMoyenne !== null
                          ? `${livreur.noteMoyenne.toFixed(1)} ★ (${livreur.nbAvis})`
                          : '—'}
                      </td>
                      <td>
                        {livreur.derniereActivite
                          ? new Date(livreur.derniereActivite).toLocaleDateString('fr-FR')
                          : '—'}
                      </td>
                      <td>
                        <button className="bouton-refuser" onClick={() => desactiverLivreur(livreur.id)}>
                          Désactiver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <input
              type="text"
              inputMode="numeric"
              placeholder="Quantité en stock (vide = illimité)"
              value={nouveauStockProduit}
              onChange={(e) => setNouveauStockProduit(e.target.value)}
            />
            <input
              type="text"
              placeholder="URL de l'image (facultatif)"
              value={nouveauImageProduit}
              onChange={(e) => setNouveauImageProduit(e.target.value)}
            />
            <label className="bouton-secondaire bouton-televerser">
              <i className="bi bi-camera"></i>{' '}
              {televersementEnCours ? 'Envoi en cours...' : 'Ou envoyer une photo depuis mon appareil'}
              <input
                type="file"
                accept="image/*"
                disabled={televersementEnCours}
                onChange={async (e) => {
                  const fichier = e.target.files[0]
                  e.target.value = ''
                  const url = await televerserImageProduit(fichier)
                  if (url) setNouveauImageProduit(url)
                }}
              />
            </label>
            {nouveauImageProduit && (
              <img src={nouveauImageProduit} alt="Aperçu" className="vignette-produit" />
            )}
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
                    <th>Stock</th>
                    <th>Image</th>
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
                            <input
                              type="text"
                              inputMode="numeric"
                              placeholder="Vide = illimité"
                              value={editionStockProduit}
                              onChange={(e) => setEditionStockProduit(e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              placeholder="URL de l'image"
                              value={editionImageProduit}
                              onChange={(e) => setEditionImageProduit(e.target.value)}
                            />
                            <label className="bouton-petit bouton-televerser-petit" title="Envoyer une photo">
                              <i className="bi bi-camera"></i>
                              <input
                                type="file"
                                accept="image/*"
                                disabled={televersementEnCours}
                                onChange={async (e) => {
                                  const fichier = e.target.files[0]
                                  e.target.value = ''
                                  const url = await televerserImageProduit(fichier)
                                  if (url) setEditionImageProduit(url)
                                }}
                              />
                            </label>
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
                            {produit.quantite_stock === null || produit.quantite_stock === undefined ? (
                              <span className="souligne">Illimité</span>
                            ) : produit.quantite_stock <= 0 ? (
                              <span className="rupture-stock">Rupture</span>
                            ) : (
                              produit.quantite_stock
                            )}
                          </td>
                          <td>
                            {produit.image_url ? (
                              <img src={produit.image_url} alt="" className="vignette-produit" />
                            ) : (
                              <span className="souligne">Aucune</span>
                            )}
                          </td>
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
