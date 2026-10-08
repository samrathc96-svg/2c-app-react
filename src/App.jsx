import { useState, useEffect, useRef } from 'react'
import { jsPDF } from 'jspdf'
import { supabase } from './supabaseClient'
import { EspaceFournisseur, AdminComptesFournisseurs } from './EspaceFournisseur'
import { jouerSonnerie } from './alerteSonore'
import { useAlerteFournisseur } from './useAlerteFournisseur'
import { ActivationNotifications } from './ActivationNotifications'
import { pushActifLocalement } from './notificationsPush'
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
  iban: null,      // ex: 'CH00 0000 0000 0000 0000 0' : affiché sur les factures mensuelles
  donneesTest: true
}

// Paiement en ligne (Stripe). Laisser à false tant que les fonctions
// serveur Stripe ne sont pas déployées dans Supabase : l'application
// continue alors de fonctionner exactement comme avant (commande sans
// paiement). Passer à true une fois tout en place, puis redéployer.
const PAIEMENT_EN_LIGNE_ACTIF = true

const iconsParMetier = {
  'Maçonnerie & Gros œuvre': 'bricks',
  'Plâtrerie & Cloisons': 'layers',
  'Peinture & Finitions': 'brush',
  'Plomberie & Sanitaire': 'droplet',
  'Électricité': 'lightning-charge',
  'Menuiserie & Serrurerie': 'wrench',
  'Carrelage & Revêtements': 'grid-3x3',
  'Couverture & Étanchéité': 'house',
  'Chauffage & Climatisation': 'fan',
  'Ventilation': 'wind'
}

// Icône d'un métier : cherche une correspondance (sans accents ni majuscules)
// dans la liste ci-dessus, pour que "Plomberie" ou "Électricité" aient
// leur icône même si le nom saisi par l'admin est plus court.
function iconePourMetier(nom) {
  const normaliser = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const cible = normaliser(nom)
  if (!cible) return 'grid'
  for (const cle of Object.keys(iconsParMetier)) {
    const c = normaliser(cle)
    if (c === cible || c.startsWith(cible) || cible.startsWith(c.split(' ')[0])) return iconsParMetier[cle]
  }
  const motsCles = [
    ['outil', 'wrench'], ['fixation', 'tools'], ['visserie', 'tools'], ['jardin', 'flower1'],
    ['peinture', 'brush'], ['quincaillerie', 'tools'], ['securite', 'shield-check'], ['sanitaire', 'droplet']
  ]
  for (const [mot, icone] of motsCles) if (cible.includes(mot)) return icone
  return 'grid'
}

// Nom affiché pour les produits qui n'ont pas (encore) de fournisseur
// renseigné dans le catalogue admin.
const FOURNISSEUR_PAR_DEFAUT = '2C Delivery'

// Métiers annoncés sur l'accueil mais pas encore ouverts (aucun produit).
const METIERS_A_VENIR = [
  { nom: 'Plomberie', icone: 'droplet' },
  { nom: 'Électricité', icone: 'lightning-charge' },
  { nom: 'Chauffage', icone: 'fire' },
  { nom: 'Outillage', icone: 'wrench' },
  { nom: 'Fixation', icone: 'tools' }
]

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
// Habillage desktop / grand écran (colonnes latérales, hors accueil admin/livreur)
// =========================================================
// Espaces de gestion interne : on n'affiche jamais les colonnes là-dessus,
// l'admin et le livreur ont besoin de toute la largeur pour travailler.
const ESPACES_SANS_PANNEAUX_DESKTOP = [
  'admin',
  'catalogueAdmin',
  'fournisseursAdmin',
  'entreprisesAdmin',
  'comptesFournisseursAdmin',
  'fournisseurEspace',
  'livreur',
  'livreurEnAttente',
  'livreursListe'
]

const AVANTAGES_PANNEAU_GAUCHE = [
  { icone: 'lightning-charge', titre: 'Livraison rapide', texte: "Directement sur chantier, sans détour par un dépôt." },
  { icone: 'grid', titre: 'Plusieurs métiers', texte: "Des fournisseurs sélectionnés pour chaque corps de métier." },
  { icone: 'person-check', titre: 'Sans compte', texte: "Commande en quelques clics, sans inscription obligatoire." },
  { icone: 'star', titre: 'Livreurs notés', texte: "Évalués par les clients à chaque livraison." }
]

// Diaporama décoratif (colonne de droite) : vraies photos de chantier /
// plans de ventilation fournies par Samrath.
const SLIDES_DIAPORAMA = [
  {
    image: '/diaporama/chantier-1-plan.jpg',
    titre: 'Des plans pensés pour le bâtiment',
    texte: "Chaque projet part d'un plan clair : gaines, conduites et diffuseurs repérés au mètre près."
  },
  {
    image: '/diaporama/chantier-2-gaine.jpg',
    titre: 'Sur le terrain, avec vous',
    texte: "Du matériel adapté à la réalité du chantier, prêt à poser."
  },
  {
    image: '/diaporama/chantier-3-livraison.jpg',
    titre: 'Livraison durable à Genève',
    texte: "Une livraison rapide, discrète et respectueuse de la ville."
  }
]

// =========================================================
// Carte interactive des fournisseurs (Leaflet + OpenStreetMap)
// =========================================================
// Leaflet est chargé à la demande depuis un CDN, uniquement quand le
// client ouvre l'onglet "Carte" : aucune installation supplémentaire.
function chargerLeaflet() {
  if (window.L) return Promise.resolve(window.L)
  if (window.__promesseLeaflet) return window.__promesseLeaflet
  window.__promesseLeaflet = new Promise((resolve, reject) => {
    const lien = document.createElement('link')
    lien.rel = 'stylesheet'
    lien.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(lien)
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.async = true
    script.onload = () => resolve(window.L)
    script.onerror = () => {
      window.__promesseLeaflet = null
      reject(new Error('Leaflet indisponible'))
    }
    document.head.appendChild(script)
  })
  return window.__promesseLeaflet
}

// Centre par défaut : Genève (utilisé tant qu'aucun fournisseur n'est placé).
const CENTRE_CARTE_DEFAUT = [46.2044, 6.1432]

function CarteFournisseurs({ points, surOuvrir }) {
  const conteneur = useRef(null)
  const carte = useRef(null)
  const couche = useRef(null)
  const rappel = useRef(surOuvrir)
  rappel.current = surOuvrir
  const [version, setVersion] = useState(0)
  const [erreur, setErreur] = useState(false)
  const signature = JSON.stringify(points)

  useEffect(() => {
    let annule = false
    chargerLeaflet()
      .then((L) => {
        if (annule || !conteneur.current) return
        if (!carte.current) {
          carte.current = L.map(conteneur.current).setView(CENTRE_CARTE_DEFAUT, 11)
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
          }).addTo(carte.current)
          couche.current = L.layerGroup().addTo(carte.current)
          setTimeout(() => { if (carte.current) carte.current.invalidateSize() }, 150)
        }
        setVersion((v) => v + 1)
      })
      .catch(() => { if (!annule) setErreur(true) })
    return () => {
      annule = true
      if (carte.current) {
        carte.current.remove()
        carte.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!carte.current || !couche.current || !window.L) return
    const L = window.L
    couche.current.clearLayers()
    const coordonnees = []
    points.forEach((point) => {
      const icone = L.divIcon({
        className: '',
        html: `<span class="repere-carte${point.actif ? ' actif' : ''}"></span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -26]
      })
      const contenu = document.createElement('div')
      contenu.className = 'popup-carte'
      const titre = document.createElement('strong')
      titre.textContent = point.nom
      contenu.appendChild(titre)
      if (point.metier || point.adresse) {
        const detail = document.createElement('span')
        detail.textContent = [point.metier, point.adresse].filter(Boolean).join(' · ')
        contenu.appendChild(detail)
      }
      if (point.actif) {
        const bouton = document.createElement('button')
        bouton.type = 'button'
        bouton.textContent = 'Voir les produits'
        bouton.addEventListener('click', () => rappel.current(point.nomCatalogue))
        contenu.appendChild(bouton)
      } else {
        const bientot = document.createElement('em')
        bientot.textContent = 'Bientôt disponible sur 2C Delivery'
        contenu.appendChild(bientot)
      }
      L.marker([point.lat, point.lng], { icon: icone, title: point.nom }).bindPopup(contenu).addTo(couche.current)
      coordonnees.push([point.lat, point.lng])
    })
    if (coordonnees.length === 1) {
      carte.current.setView(coordonnees[0], 13)
    } else if (coordonnees.length > 1) {
      carte.current.fitBounds(coordonnees, { padding: [40, 40], maxZoom: 14 })
    }
  }, [version, signature]) // eslint-disable-line react-hooks/exhaustive-deps

  if (erreur) {
    return <div className="carte-indisponible">La carte n'a pas pu se charger. Vérifie ta connexion et réessaie.</div>
  }
  return <div ref={conteneur} className="carte-leaflet" role="region" aria-label="Carte des fournisseurs"></div>
}

function DiaporamaChantier() {
  const [indexDiapo, setIndexDiapo] = useState(0)

  useEffect(() => {
    const minuteur = setInterval(() => {
      setIndexDiapo((precedent) => (precedent + 1) % SLIDES_DIAPORAMA.length)
    }, 8500)
    return () => clearInterval(minuteur)
  }, [])

  const diapoActive = SLIDES_DIAPORAMA[indexDiapo]

  return (
    <div className="diaporama-chantier">
      <div className="diaporama-visuel">
        {SLIDES_DIAPORAMA.map((slide, i) => (
          <img
            key={slide.image}
            src={slide.image}
            alt={slide.titre}
            className={`image-diaporama ${i === indexDiapo ? 'actif' : ''}`}
          />
        ))}
      </div>
      <strong>{diapoActive.titre}</strong>
      <p>{diapoActive.texte}</p>
      <div className="diaporama-puces">
        {SLIDES_DIAPORAMA.map((_, i) => (
          <span
            key={i}
            className={`puce-diaporama ${i === indexDiapo ? 'actif' : ''}`}
            onClick={() => setIndexDiapo(i)}
          ></span>
        ))}
      </div>
    </div>
  )
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

// Sonnerie brève de notification (livreur, client) : voir alerteSonore.js.
// Échoue silencieusement si l'audio n'est pas disponible.
function jouerSonNotification() {
  // Notifications push actives : c'est la notification du téléphone qui sonne
  if (pushActifLocalement()) return
  jouerSonnerie()
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

  // Compte entreprise : 2C ne facture que la livraison (les produits sont
  // facturés par le fournisseur).
  const livraisonSeule = Boolean(commande.livraison_seule)
  const montantFacture = livraisonSeule ? Number(commande.frais_livraison || 0) : commande.total

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
  if (livraisonSeule && commande.chantier) { doc.text(`Chantier : ${commande.chantier}`, 15, y); y += 5 }
  if (livraisonSeule && commande.technicien) { doc.text(`Commandé par : ${commande.technicien}`, 15, y); y += 5 }
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
  doc.text(livraisonSeule ? 'Prestation' : 'Produit', colProduit, y)
  doc.text('Prix', colPrix, y)
  doc.text('Qté', colQte, y)
  doc.text('Sous-total', colTotal, y)
  y += 8

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...encre)

  // Les commandes passées avant l'ajout du détail ligne par ligne n'ont
  // pas "produits_detail" : on retombe alors sur le texte résumé, sans
  // détail de prix par article.
  const lignes = livraisonSeule
    ? [{
        nom: `Livraison 2C Delivery — commande ${commande.numero_suivi || commande.id}`,
        prix: montantFacture,
        quantite: 1
      }]
    : commande.produits_detail && commande.produits_detail.length > 0
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
    const sousTotal = montantFacture / (1 + INFOS_ENTREPRISE.tvaTaux / 100)
    const montantTVA = montantFacture - sousTotal
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
  doc.text(commande.deja_regle ? 'Total' : 'Total à payer', 140, y)
  doc.text(`${montantFacture.toFixed(2)} CHF`, 195, y, { align: 'right' })

  if (livraisonSeule) {
    // Contenu de la commande : sert de preuve en cas de litige de livraison
    // (à comparer avec ce que le fournisseur a remis au livreur).
    y += 14
    if (y > 240) {
      doc.addPage()
      y = 20
    }
    doc.setFillColor(...accent)
    doc.rect(15, y - 5, 180, 8, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(255, 255, 255)
    doc.text('Contenu de la commande remis au livreur', 17, y)
    doc.text('Qté', 190, y, { align: 'right' })
    y += 8
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...encre)
    const contenu = commande.produits_detail && commande.produits_detail.length > 0
      ? commande.produits_detail
      : [{ nom: commande.produits, quantite: null }]
    contenu.forEach((ligne, index) => {
      const nomLignes = doc.splitTextToSize(String(ligne.nom || ''), 150)
      const hauteur = Math.max(7, nomLignes.length * 5)
      if (y + hauteur > 270) {
        doc.addPage()
        y = 20
      }
      if (index % 2 === 1) {
        doc.setFillColor(245, 242, 235)
        doc.rect(15, y - 5, 180, hauteur, 'F')
      }
      doc.setFontSize(9)
      doc.text(nomLignes, 17, y)
      if (ligne.quantite !== null && ligne.quantite !== undefined) {
        doc.text(String(ligne.quantite), 190, y, { align: 'right' })
      }
      y += hauteur
    })
    y += 8
    if (y > 270) {
      doc.addPage()
      y = 20
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...muted)
    if (commande.mention_paiement) {
      doc.text(commande.mention_paiement, 15, y)
      y += 5
    }
    doc.text(
      `Valeur de la commande fournisseur : ${Number(commande.total).toFixed(2)} CHF — facturée séparément par le fournisseur.`,
      15, y
    )
  }

  ajouterQrCompte(doc, y)

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

// QR code d'accès au compte (lien : https://2cdelivery.ch/?compte=1), dessiné
// en vectoriel dans les PDF. "1" = module noir.
const QR_COMPTE = ["1111111010001000001111111", "1000001000100110001000001", "1011101001000110101011101", "1011101001101110001011101", "1011101001100110101011101", "1000001000111110001000001", "1111111010101010101111111", "0000000010100110100000000", "1101101001100011101000001", "0101100001110011000111110", "0110001010111111011001001", "0000010011111011000001111", "1010101101010001001000001", "1001100100010011100110010", "1111111110100101011011111", "1000100100000010101101101", "1111111111101110111110110", "0000000011000100100010110", "1111111001010000101010001", "1000001000110101100010010", "1011101010111001111110010", "1011101010110100111000011", "1011101001010100110011111", "1000001010101010001110111", "1111111010111000101001001"]

function ajouterQrCompte(doc, yContenu) {
  if (yContenu > 228) doc.addPage()
  const taille = 28
  const module = taille / QR_COMPTE.length
  const x0 = 195 - taille
  const y0 = 245
  doc.setFillColor(0, 0, 0)
  QR_COMPTE.forEach((ligne, r) => {
    for (let k = 0; k < ligne.length; k += 1) {
      if (ligne[k] === '1') doc.rect(x0 + k * module, y0 + r * module, module + 0.02, module + 0.02, 'F')
    }
  })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(30, 27, 23)
  doc.text('Votre espace 2C', 15, y0 + 6)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(121, 112, 95)
  doc.text('Retrouvez vos commandes et vos factures depuis votre compte :', 15, y0 + 12)
  doc.text('2cdelivery.ch  (ou scannez le QR code)', 15, y0 + 17)
}

// Libellé de la période d'une facture mensuelle : "octobre 2026" si elle couvre
// un mois entier, sinon "du 01.10.2026 au 15.10.2026".
function libellePeriodeFacture(d) {
  const debut = new Date(d.periode_debut)
  const fin = new Date(d.periode_fin)
  const memeMois = debut.getFullYear() === fin.getFullYear() && debut.getMonth() === fin.getMonth()
  const jourFin = new Date(fin.getFullYear(), fin.getMonth() + 1, 0).getDate()
  if (memeMois && debut.getDate() === 1 && fin.getDate() === jourFin) {
    return debut.toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' })
  }
  const f = (v) => v.toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `du ${f(debut)} au ${f(fin)}`
}

// Facture mensuelle des frais de livraison d'une entreprise (mode "mensuel").
// `d` = données renvoyées par la base (admin_creer_facture_mensuelle).
function construireFactureMensuellePDF(d) {
  const doc = new jsPDF()
  const accent = [255, 106, 19]
  const encre = [30, 27, 23]
  const muted = [121, 112, 95]
  const dateCH = (v) => new Date(v).toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const montant = Number(d.montant_total || 0)

  let y = 20
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...encre)
  doc.text(INFOS_ENTREPRISE.nom, 15, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...muted)
  doc.text(INFOS_ENTREPRISE.adresse, 15, y + 6)
  doc.text(INFOS_ENTREPRISE.contact, 15, y + 11)
  if (INFOS_ENTREPRISE.tvaNumero) doc.text(`N° TVA : ${INFOS_ENTREPRISE.tvaNumero}`, 15, y + 16)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...accent)
  doc.text('FACTURE MENSUELLE', 195, y, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...encre)
  doc.text(`N° ${d.numero}`, 195, y + 7, { align: 'right' })
  doc.text(`Date : ${dateCH(d.emise_le)}`, 195, y + 13, { align: 'right' })
  doc.text(`Période : ${dateCH(d.periode_debut)} au ${dateCH(d.periode_fin)}`, 195, y + 19, { align: 'right' })
  doc.setFontSize(9)
  doc.setTextColor(...muted)
  doc.text(
    `Récapitulatif mensuel : ${(d.lignes || []).length} livraison${(d.lignes || []).length > 1 ? 's' : ''} — ${libellePeriodeFacture(d)}`,
    195, y + 25, { align: 'right' }
  )
  doc.setFontSize(10)
  doc.setTextColor(...encre)

  y += 34
  doc.setDrawColor(...accent)
  doc.setLineWidth(0.6)
  doc.line(15, y, 195, y)
  y += 10

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Facturé à', 15, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(d.entreprise_nom || '—', 15, y)
  y += 5
  if (d.responsable_nom) { doc.text(d.responsable_nom, 15, y); y += 5 }
  if (d.responsable_email) { doc.text(d.responsable_email, 15, y); y += 5 }
  y += 8

  const entete = () => {
    doc.setFillColor(...accent)
    doc.rect(15, y - 5, 180, 8, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(255, 255, 255)
    doc.text('Date', 17, y)
    doc.text('Suivi', 40, y)
    doc.text('Chantier / commandé par', 72, y)
    doc.text('Livraison', 193, y, { align: 'right' })
    y += 8
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...encre)
  }
  entete()

  ;(d.lignes || []).forEach((ligne, index) => {
    const detail = [ligne.chantier, ligne.technicien].filter(Boolean).join(' — ') || '—'
    const detailLignes = doc.splitTextToSize(detail, 95)
    // Produits de la livraison (preuve en cas de litige), en petit sous la ligne.
    const produitsTexte = Array.isArray(ligne.produits_detail) && ligne.produits_detail.length > 0
      ? ligne.produits_detail.map((p) => `${p.quantite} x ${p.nom}`).join(' ; ')
      : ligne.produits_texte || ''
    const produitsLignes = produitsTexte ? doc.splitTextToSize(`Contenu : ${produitsTexte}`, 170) : []
    const hauteur = Math.max(7, detailLignes.length * 5) + produitsLignes.length * 4
    if (y + hauteur > 262) {
      doc.addPage()
      y = 20
      entete()
    }
    if (index % 2 === 1) {
      doc.setFillColor(245, 242, 235)
      doc.rect(15, y - 5, 180, hauteur, 'F')
    }
    doc.setFontSize(9)
    doc.text(dateCH(ligne.date), 17, y)
    doc.text(String(ligne.numero_suivi || '—'), 40, y)
    doc.text(detailLignes, 72, y)
    doc.text(`${Number(ligne.frais || 0).toFixed(2)} CHF`, 193, y, { align: 'right' })
    if (produitsLignes.length > 0) {
      doc.setFontSize(8)
      doc.setTextColor(...muted)
      doc.text(produitsLignes, 17, y + Math.max(7, detailLignes.length * 5) - 1)
      doc.setTextColor(...encre)
    }
    y += hauteur
  })

  if (y > 235) {
    doc.addPage()
    y = 20
  }
  y += 5
  doc.setDrawColor(...muted)
  doc.setLineWidth(0.2)
  doc.line(15, y, 195, y)
  y += 8
  doc.setFontSize(10)
  if (INFOS_ENTREPRISE.tvaTaux) {
    const sousTotal = montant / (1 + INFOS_ENTREPRISE.tvaTaux / 100)
    doc.text('Sous-total HT', 140, y)
    doc.text(`${sousTotal.toFixed(2)} CHF`, 195, y, { align: 'right' })
    y += 6
    doc.text(`TVA (${INFOS_ENTREPRISE.tvaTaux}%)`, 140, y)
    doc.text(`${(montant - sousTotal).toFixed(2)} CHF`, 195, y, { align: 'right' })
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
  doc.text(`${montant.toFixed(2)} CHF`, 195, y, { align: 'right' })

  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...muted)
  doc.text(`Frais de livraison 2C Delivery uniquement : les produits sont facturés séparément par le fournisseur.`, 15, y)
  y += 5
  doc.text(`À régler avant le ${dateCH(d.echeance)} (${d.delai_jours} jours), par virement.`, 15, y)
  if (INFOS_ENTREPRISE.iban) {
    y += 5
    doc.text(`IBAN : ${INFOS_ENTREPRISE.iban} — référence : ${d.numero}`, 15, y)
  }

  ajouterQrCompte(doc, y)

  if (INFOS_ENTREPRISE.donneesTest) {
    doc.setFontSize(8)
    doc.text(
      "Informations d'entreprise provisoires (test) — à compléter avant tout envoi officiel.",
      15, 285
    )
  }
  return doc
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
      quantite_stock: ligne.quantite_stock,
      fournisseur: ligne.fournisseur || null
    })
  })

  return Object.keys(parMetier).map((nomMetier) => ({
    nom: nomMetier,
    icone: iconePourMetier(nomMetier),
    sousSections: Object.keys(parMetier[nomMetier]).map((nomSousSection) => ({
      nom: nomSousSection,
      produits: parMetier[nomMetier][nomSousSection]
    }))
  }))
}

const STATUTS = ['À livrer', 'En cours', 'Livrée']

// "06/10/2026 à 11:23" : date et heure de prise de commande d'une course,
// pour la retrouver facilement dans les listes du livreur.
const dateHeureCourse = (course) => {
  if (!course || !course.created_at) return ''
  const d = new Date(course.created_at)
  return `${d.toLocaleDateString('fr-CH')} à ${d.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}`
}

const lienItineraire = (destination, etapes = []) => {
  const base = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
  return etapes.length > 0 ? `${base}&waypoints=${encodeURIComponent(etapes.join('|'))}` : base
}

// Retrouve les fournisseurs à passer pour une course, à partir du texte
// de la commande (les noms de produits les plus longs sont cherchés en
// premier pour éviter qu'un nom court ne "mange" un nom plus long).
function fournisseursDeLaCourse(course, produits, fournisseursCarte) {
  let texte = course.produits || ''
  const noms = []
  ;[...produits]
    .sort((a, b) => b.nom.length - a.nom.length)
    .forEach((produit) => {
      if (produit.nom && texte.includes(produit.nom)) {
        texte = texte.replace(produit.nom, '')
        const nom = produit.fournisseur || FOURNISSEUR_PAR_DEFAUT
        if (!noms.includes(nom)) noms.push(nom)
      }
    })
  return noms.map((nom) => {
    const fiche = fournisseursCarte.find((f) => f.nom === nom)
    return { nom, adresse: fiche && fiche.adresse ? fiche.adresse : null }
  })
}

// Code de livraison à 4 chiffres : le client le donne au livreur à la
// remise de la commande. Le code est lu via une fonction sécurisée de la
// base (le livreur ne peut jamais le lire). Si la fonction n'existe pas
// encore (SQL pas exécuté), rien ne s'affiche.
function BlocCodeLivraison({ numero, nom, statut }) {
  const [info, setInfo] = useState(null)

  useEffect(() => {
    let annule = false
    if (!numero) return undefined
    supabase
      .rpc('obtenir_code_livraison', { p_numero: numero, p_nom: nom || null })
      .then(({ data, error }) => {
        if (annule) return
        setInfo(!error && data && data.length > 0 ? data[0] : null)
      })
    return () => {
      annule = true
    }
  }, [numero, nom, statut])

  if (!info) return null

  if (info.valide) {
    return (
      <div className="code-livraison code-livraison-ok">
        <i className="bi bi-patch-check"></i>
        <span>
          Livraison confirmée{info.recu_par ? ` — reçue par ${info.recu_par}` : ''}
          {info.valide_le ? ` le ${new Date(info.valide_le).toLocaleDateString('fr-CH')} à ${new Date(info.valide_le).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
      </div>
    )
  }

  if (!info.code) return null

  return (
    <div className="code-livraison">
      <span className="code-livraison-titre"><i className="bi bi-shield-lock"></i> Code de livraison</span>
      <span className="code-livraison-chiffres" aria-label={`Code ${info.code.split('').join(' ')}`}>{info.code}</span>
      <span className="code-livraison-aide">
        Donnez ce code au livreur uniquement quand vous avez votre commande en main. Ne le communiquez à personne d'autre.
      </span>
    </div>
  )
}

// =========================================================
// Comptes entreprise : responsable + employés
// =========================================================
const DATE_HEURE_CH = (valeur) => {
  if (!valeur) return ''
  const d = new Date(valeur)
  return `${d.toLocaleDateString('fr-CH')} à ${d.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}`
}

const LIBELLE_STATUT_ENTREPRISE = {
  en_attente: 'En cours de validation par 2C',
  validee: 'Compte validé',
  suspendue: 'Compte suspendu'
}

// Page "Mon équipe" du responsable : lien d'invitation, membres et
// commandes de toute l'équipe.
function PageEquipe({ entreprise, onRetour, afficherNotification }) {
  const [equipe, setEquipe] = useState([])
  const [commandes, setCommandes] = useState([])
  const [statuts, setStatuts] = useState({})
  const [chargement, setChargement] = useState(true)
  const [erreurChargement, setErreurChargement] = useState(false)
  const [code, setCode] = useState(entreprise.code_invitation || '')
  const [confirmationRegeneration, setConfirmationRegeneration] = useState(false)

  const lien = `${window.location.origin}/?equipe=${code}`

  async function charger() {
    const [resEquipe, resCommandes, resStatuts] = await Promise.all([
      supabase.rpc('equipe_entreprise'),
      supabase.rpc('commandes_equipe'),
      supabase.rpc('statuts_equipe')
    ])
    if (resEquipe.error || resCommandes.error) {
      console.error('Erreur de chargement de l’équipe :', resEquipe.error || resCommandes.error)
      setErreurChargement(true)
    } else {
      setErreurChargement(false)
    }
    setEquipe(resEquipe.data || [])
    setCommandes(resCommandes.data || [])
    const parCommande = {}
    ;(resStatuts.data || []).forEach((s) => {
      parCommande[String(s.commande_id)] = s.statut
    })
    setStatuts(parCommande)
    setChargement(false)
  }

  useEffect(() => {
    charger()
  }, [])

  async function copierLien() {
    try {
      await navigator.clipboard.writeText(lien)
      afficherNotification("Lien d'invitation copié.", 'info')
    } catch (e) {
      window.prompt("Copiez ce lien d'invitation :", lien)
    }
  }

  async function partagerLien() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Rejoindre ${entreprise.entreprise_nom} sur 2C Delivery`,
          text: `Créez votre session pour commander au nom de ${entreprise.entreprise_nom} :`,
          url: lien
        })
        return
      } catch (e) {
        // partage annulé : on ne fait rien
        return
      }
    }
    copierLien()
  }

  async function regenererLien() {
    const { data, error } = await supabase.rpc('regenerer_invitation')
    if (error || !data) {
      console.error('Erreur de régénération du lien :', error)
      afficherNotification('Impossible de renouveler le lien, réessayez.')
      return
    }
    setCode(data)
    setConfirmationRegeneration(false)
    afficherNotification("Nouveau lien créé. L'ancien ne fonctionne plus.", 'info')
  }

  async function changerAcces(membre, actif) {
    const { error } = await supabase.rpc('changer_acces_employe', {
      p_user_id: membre.user_id,
      p_actif: actif
    })
    if (error) {
      console.error("Erreur de changement d'accès :", error)
      afficherNotification("La modification a échoué, réessayez.")
      return
    }
    afficherNotification(actif ? 'Accès réactivé.' : 'Accès désactivé.', 'info')
    charger()
  }

  const nomParUtilisateur = {}
  equipe.forEach((m) => {
    nomParUtilisateur[m.user_id] = m.nom || m.email
  })

  return (
    <>
      <p className="retour" onClick={onRetour}>← Retour</p>
      <div className="entete-page">
        <h2>Mon équipe</h2>
        <p className="souligne">
          {entreprise.entreprise_nom}
          {' · '}
          <span className={`etiquette-statut-entreprise statut-${entreprise.statut_entreprise}`}>
            {LIBELLE_STATUT_ENTREPRISE[entreprise.statut_entreprise] || ''}
          </span>
        </p>
      </div>

      <div className="carte-auth">
        <h3>Inviter un employé</h3>
        <p className="souligne">
          Envoyez ce lien à vos employés : ils créent leur propre session et commandent au nom de
          votre entreprise. Vous suivez toutes leurs commandes ici.
        </p>
        <div className="lien-invitation">{lien}</div>
        <div className="boutons-confirmation">
          <button className="valider" onClick={partagerLien}>
            <i className="bi bi-share"></i> Partager
          </button>
          <button className="annuler-secondaire" onClick={copierLien}>
            <i className="bi bi-clipboard"></i> Copier
          </button>
        </div>
        {confirmationRegeneration ? (
          <div className="confirmation-annulation">
            <p className="aucun-resultat">
              L'ancien lien ne fonctionnera plus. Les employés déjà inscrits ne sont pas affectés.
            </p>
            <div className="boutons-confirmation">
              <button className="annuler-secondaire" onClick={() => setConfirmationRegeneration(false)}>
                Annuler
              </button>
              <button className="valider" onClick={regenererLien}>
                Créer un nouveau lien
              </button>
            </div>
          </div>
        ) : (
          <p className="retour" onClick={() => setConfirmationRegeneration(true)}>
            Créer un nouveau lien (l'ancien sera désactivé)
          </p>
        )}
      </div>

      {chargement && (
        <div className="skeleton-liste">
          <div className="skeleton-ligne"></div>
          <div className="skeleton-ligne"></div>
        </div>
      )}

      {erreurChargement && !chargement && (
        <p className="aucun-resultat">
          Impossible de charger l'équipe pour le moment. Vérifiez votre connexion et réessayez.
        </p>
      )}

      {!chargement && !erreurChargement && (
        <>
          <h3>Membres ({equipe.length})</h3>
          <ul className="liste-membres">
            {equipe.map((membre) => (
              <li key={membre.user_id} className={membre.actif ? '' : 'membre-inactif'}>
                <span className="texte-membre">
                  <strong>{membre.nom || membre.email}</strong>
                  <span className="souligne">
                    {membre.role_entreprise === 'responsable' ? 'Responsable' : 'Employé'}
                    {' · '}
                    {membre.email}
                    {' · '}
                    {membre.nb_commandes} commande{Number(membre.nb_commandes) > 1 ? 's' : ''}
                    {!membre.actif ? ' · accès désactivé' : ''}
                  </span>
                </span>
                {membre.role_entreprise === 'employe' && (
                  membre.actif ? (
                    <button className="bouton-refuser" onClick={() => changerAcces(membre, false)}>
                      Désactiver
                    </button>
                  ) : (
                    <button className="bouton-approuver" onClick={() => changerAcces(membre, true)}>
                      Réactiver
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>

          <h3>Commandes de l'équipe</h3>
          {commandes.length === 0 ? (
            <p className="aucun-resultat">Aucune commande pour le moment.</p>
          ) : (
            <ul className="liste-mes-commandes liste-commandes-equipe">
              {commandes.map((commande) => (
                <li key={commande.id} className="commande-equipe">
                  <span>
                    {commande.chantier ? <strong>{commande.chantier}</strong> : <strong>Sans chantier</strong>}
                    <br />
                    <span className="souligne">
                      {commande.produits}
                    </span>
                    <br />
                    <span className="souligne">
                      {DATE_HEURE_CH(commande.created_at)}
                      {' · par '}
                      {commande.technicien || nomParUtilisateur[commande.user_id] || '—'}
                      {' · '}
                      {statuts[String(commande.id)] || 'À livrer'}
                    </span>
                  </span>
                  <span className="prix">{Number(commande.total).toFixed(2)} CHF</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  )
}

// Fiche d'une entreprise dans l'admin : statut, mode de paiement convenu,
// plafond et fournisseurs avec lesquels un accord existe.
function CarteEntrepriseAdmin({ entreprise, fournisseursDisponibles, onEnregistrer, solde, encours, onCrediter, onApercuFacture, onCreerFacture, onListerFactures, onRenvoyerFacture }) {
  const [statut, setStatut] = useState(entreprise.statut)
  const [mode, setMode] = useState(entreprise.mode_paiement)
  const [plafond, setPlafond] = useState(
    entreprise.plafond_mensuel === null || entreprise.plafond_mensuel === undefined ? '' : String(entreprise.plafond_mensuel)
  )
  const [fournisseurs, setFournisseurs] = useState(entreprise.fournisseurs || [])
  const [enCours, setEnCours] = useState(false)
  const [montantCredit, setMontantCredit] = useState('')
  const [noteCredit, setNoteCredit] = useState('')
  const [mois, setMois] = useState(() => {
    const maintenant = new Date()
    const precedent = new Date(maintenant.getFullYear(), maintenant.getMonth() - 1, 1)
    return `${precedent.getFullYear()}-${String(precedent.getMonth() + 1).padStart(2, '0')}`
  })
  const [apercuFacture, setApercuFacture] = useState(null)
  const [facturesEmises, setFacturesEmises] = useState([])
  const [versionFactures, setVersionFactures] = useState(0)

  const mensuelEnregistre = entreprise.mode_paiement === 'mensuel'
  useEffect(() => {
    if (!mensuelEnregistre) return
    let annule = false
    onListerFactures(entreprise.id).then((liste) => {
      if (!annule) setFacturesEmises(liste || [])
    })
    return () => {
      annule = true
    }
  }, [mensuelEnregistre, entreprise.id, versionFactures])

  // Bornes du mois choisi : du 1er inclus au 1er du mois suivant exclu.
  function bornesMois() {
    const [annee, m] = mois.split('-').map(Number)
    const suivant = new Date(Date.UTC(annee, m, 1))
    const fin = `${suivant.getUTCFullYear()}-${String(suivant.getUTCMonth() + 1).padStart(2, '0')}-01`
    return { debut: `${mois}-01`, fin }
  }

  async function calculerFacture() {
    setEnCours(true)
    try {
      const { debut, fin } = bornesMois()
      setApercuFacture(await onApercuFacture(entreprise.id, debut, fin))
    } catch (e) {
      console.error("Erreur de calcul de l'aperçu :", e)
    } finally {
      setEnCours(false)
    }
  }

  async function creerFacture() {
    setEnCours(true)
    let ok = false
    try {
      const { debut, fin } = bornesMois()
      ok = await onCreerFacture(entreprise.id, debut, fin)
    } catch (e) {
      console.error('Erreur inattendue à la création de la facture mensuelle :', e)
    } finally {
      setEnCours(false)
    }
    if (ok) {
      setApercuFacture(null)
      setVersionFactures((v) => v + 1)
    }
  }

  async function crediter() {
    const montant = Number(montantCredit.replace(',', '.'))
    if (!Number.isFinite(montant) || montant === 0) return
    setEnCours(true)
    const ok = await onCrediter(entreprise.id, montant, noteCredit)
    setEnCours(false)
    if (ok) {
      setMontantCredit('')
      setNoteCredit('')
    }
  }

  function basculerFournisseur(nom) {
    setFournisseurs((precedent) =>
      precedent.includes(nom) ? precedent.filter((f) => f !== nom) : [...precedent, nom]
    )
  }

  async function enregistrer() {
    setEnCours(true)
    await onEnregistrer(entreprise.id, {
      statut,
      mode,
      plafond: mode === 'mensuel' && plafond.trim() !== '' ? Number(plafond) : null,
      fournisseurs
    })
    setEnCours(false)
  }

  // Fournisseurs déjà choisis mais absents de la liste actuelle : on les garde visibles.
  const tousLesFournisseurs = [...new Set([...fournisseursDisponibles, ...fournisseurs])].sort((a, b) =>
    a.localeCompare(b, 'fr')
  )

  return (
    <div className="carte-auth carte-entreprise-admin">
      <div className="entete-entreprise-admin">
        <h3>{entreprise.nom}</h3>
        <span className="souligne">
          {entreprise.nb_membres} membre{Number(entreprise.nb_membres) > 1 ? 's' : ''}
          {' · inscrite le '}
          {new Date(entreprise.created_at).toLocaleDateString('fr-CH')}
        </span>
      </div>
      <p className="souligne">
        Responsable : {entreprise.responsable_nom || '—'}
        {entreprise.responsable_email ? ` (${entreprise.responsable_email})` : ''}
      </p>

      <label className="champ-admin-entreprise">
        <span>Statut</span>
        <select value={statut} onChange={(e) => setStatut(e.target.value)}>
          <option value="en_attente">En attente de validation</option>
          <option value="validee">Validée</option>
          <option value="suspendue">Suspendue (ne peut plus commander)</option>
        </select>
      </label>

      <label className="champ-admin-entreprise">
        <span>Mode de paiement convenu</span>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="carte">Carte (par défaut)</option>
          <option value="prepaye">Compte prépayé</option>
          <option value="mensuel">Facturation mensuelle</option>
        </select>
      </label>

      {mode === 'prepaye' && (
        <div className="champ-admin-entreprise">
          <span>
            Solde prépayé actuel : <strong>{Number(solde || 0).toFixed(2)} CHF</strong>
            {mode !== entreprise.mode_paiement && ' (enregistrez d\'abord le changement de mode)'}
          </span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="Montant reçu par virement (négatif pour corriger)"
            value={montantCredit}
            onChange={(e) => setMontantCredit(e.target.value)}
          />
          <input
            type="text"
            placeholder="Note (ex. virement du 12.10)"
            value={noteCredit}
            onChange={(e) => setNoteCredit(e.target.value)}
          />
          <button className="bouton-secondaire" disabled={enCours || montantCredit.trim() === ''} onClick={crediter}>
            Créditer le solde
          </button>
        </div>
      )}

      {mode === 'mensuel' && (
        <p className="souligne">
          La facturation mensuelle n'est possible que pour une entreprise « Validée ». Encours à facturer :{' '}
          <strong>{Number(encours || 0).toFixed(2)} CHF</strong>.
        </p>
      )}

      {mode === 'mensuel' && (
        <label className="champ-admin-entreprise">
          <span>Plafond mensuel (CHF)</span>
          <input
            type="number"
            min="0"
            step="50"
            placeholder="Ex. 2000"
            value={plafond}
            onChange={(e) => setPlafond(e.target.value)}
          />
        </label>
      )}

      {mode === 'mensuel' && mensuelEnregistre && (
        <div className="champ-admin-entreprise bloc-facturation-mensuelle">
          <span>Facture mensuelle (livraisons effectuées, pas encore facturées)</span>
          <input
            type="month"
            value={mois}
            onChange={(e) => {
              setMois(e.target.value)
              setApercuFacture(null)
            }}
          />
          <button className="bouton-secondaire" disabled={enCours || !mois} onClick={calculerFacture}>
            Calculer
          </button>
          {apercuFacture && (
            <p className="souligne">
              {apercuFacture.nb === 0
                ? 'Aucune livraison à facturer sur ce mois.'
                : `${apercuFacture.nb} livraison(s) à facturer : ${Number(apercuFacture.total).toFixed(2)} CHF.`}
            </p>
          )}
          {apercuFacture && apercuFacture.nb > 0 && (
            <button className="valider" disabled={enCours} onClick={creerFacture}>
              Créer et envoyer la facture au responsable
            </button>
          )}
          {facturesEmises.length > 0 && (
            <ul className="liste-factures-emises">
              {facturesEmises.map((f) => (
                <li key={f.facture_id}>
                  <span>
                    {f.numero} — {new Date(f.periode_debut).toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' })} — {Number(f.montant).toFixed(2)} CHF
                  </span>
                  <button className="bouton-secondaire" disabled={enCours} onClick={() => onRenvoyerFacture(f.facture_id)}>
                    Renvoyer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="champ-admin-entreprise">
        <span>Fournisseurs avec accord (commande sur compte)</span>
        {tousLesFournisseurs.length === 0 ? (
          <p className="souligne">Aucun fournisseur enregistré pour le moment.</p>
        ) : (
          <div className="cases-fournisseurs">
            {tousLesFournisseurs.map((nom) => (
              <label key={nom} className="case-fournisseur">
                <input
                  type="checkbox"
                  checked={fournisseurs.includes(nom)}
                  onChange={() => basculerFournisseur(nom)}
                />
                <span>{nom}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <button className="valider" disabled={enCours} onClick={enregistrer}>
        {enCours ? 'Enregistrement...' : 'Enregistrer'}
      </button>
    </div>
  )
}


// Mémorise la section ouverte (onglet du navigateur seulement) pour qu'un
// rechargement de page ne renvoie pas à l'accueil.
const CLE_ESPACE_MEMORISE = 'espace2C'
const ESPACES_PUBLICS = ['catalogue', 'suivi', 'faq', 'apropos', 'mentionsLegales', 'cgv', 'confidentialite']
function lireEspaceMemorise() {
  try {
    const brut = window.sessionStorage.getItem(CLE_ESPACE_MEMORISE)
    return brut ? JSON.parse(brut) : null
  } catch (e) {
    return null
  }
}
function ecrireEspaceMemorise(valeur) {
  try {
    window.sessionStorage.setItem(CLE_ESPACE_MEMORISE, JSON.stringify(valeur))
  } catch (e) {
    // stockage indisponible - on ignore silencieusement
  }
}

function App() {
  const [session, setSession] = useState(null)
  const utilisateurRedirige = useRef(null)
  // Lien d'une notification push (2cdelivery.ch/?ouvrir=commandes) : ouvre
  // directement les commandes du fournisseur après la connexion.
  const [ouvrirAuDemarrage, setOuvrirAuDemarrage] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('ouvrir')
    } catch (e) {
      return null
    }
  })
  const [role, setRole] = useState(null)
  const [chargementAuth, setChargementAuth] = useState(true)
  const [afficherAuth, setAfficherAuth] = useState(false)
  // Une seule fenêtre à la fois : 'connexion' ou 'inscription'.
  const [modeAuth, setModeAuth] = useState('connexion')
  const [afficherMenu, setAfficherMenu] = useState(false)
  const [espace, setEspace] = useState(() => {
    const memorisee = lireEspaceMemorise()
    return memorisee && !memorisee.userId && ESPACES_PUBLICS.includes(memorisee.espace) ? memorisee.espace : 'catalogue'
  })

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
  const [nomEntrepriseInscription, setNomEntrepriseInscription] = useState('')
  // Lien d'invitation d'équipe (?equipe=CODE) : { code, nom } tant que la
  // personne n'a pas fini de s'inscrire.
  const [invitationEquipe, setInvitationEquipe] = useState(null)
  // Rattachement du compte entreprise connecté (réponse de la base) :
  // { statut: 'ok' | 'invitation_invalide', entreprise_nom, role_entreprise, actif, ... }
  const [entreprise, setEntreprise] = useState(null)
  const [entreprisesAdmin, setEntreprisesAdmin] = useState([])
  const [soldesAdmin, setSoldesAdmin] = useState({})
  const [tarifAdmin, setTarifAdmin] = useState({ forfait: '', km_inclus: '', prix_km: '', delai_paiement_jours: '' })
  const [roleChoisi, setRoleChoisi] = useState('client')
  const [erreurInscription, setErreurInscription] = useState('')
  const [messageInscription, setMessageInscription] = useState('')
  // Accès discret à l'inscription livreur : invisible pour les visiteurs
  // normaux (plus de bouton public depuis le retrait du recrutement sur
  // l'accueil), révélé uniquement via un lien contenant ?livreur, partagé
  // directement avec les candidats recrutés en physique.
  const [accesRecrutementLivreur, setAccesRecrutementLivreur] = useState(false)
  // Inscription fournisseur : révélée uniquement par le lien ?fournisseur
  // (partagé avec les fournisseurs partenaires). Le compte reste "en attente"
  // jusqu'à validation par 2C ; il est lié au profil par la table
  // fournisseur_comptes (le rôle du profil reste "client").
  const [accesInscriptionFournisseur, setAccesInscriptionFournisseur] = useState(false)
  const [nomFournisseurInscription, setNomFournisseurInscription] = useState('')
  const [telephoneFournisseurInscription, setTelephoneFournisseurInscription] = useState('')
  const [adresseFournisseurInscription, setAdresseFournisseurInscription] = useState('')
  const [compteFournisseur, setCompteFournisseur] = useState(null)

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

  const [nouveauFournisseur, setNouveauFournisseur] = useState('')
  const [editionFournisseur, setEditionFournisseur] = useState('')
  const [nouveauMetierProduit, setNouveauMetierProduit] = useState('')
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
  // Nouvelle navigation : bascule Fournisseurs / Produits, filtre par
  // métier et fournisseur ouvert (null = on est sur l'accueil).
  const [modeAccueil, setModeAccueil] = useState('fournisseurs')
  const [metierFiltre, setMetierFiltre] = useState(null)
  const [fournisseurActif, setFournisseurActif] = useState(null)
  const [categorieFournisseur, setCategorieFournisseur] = useState(null)
  // Fournisseurs placés sur la carte (table "fournisseurs" de Supabase)
  const [fournisseursCarte, setFournisseursCarte] = useState([])
  const [nouveauNomFournisseur, setNouveauNomFournisseur] = useState('')
  const [nouvelleAdresseFournisseur, setNouvelleAdresseFournisseur] = useState('')
  const [nouveauMetierFournisseur, setNouveauMetierFournisseur] = useState('')
  const [erreurFournisseurAdmin, setErreurFournisseurAdmin] = useState('')
  const [envoiFournisseurEnCours, setEnvoiFournisseurEnCours] = useState(false)
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
  // Adresse de livraison saisie en trois champs ; adresseClient en est la
  // version complète ("Rue du Rhône 12, 1204 Genève"), utilisée partout ailleurs.
  const [rueClient, setRueClient] = useState('')
  const [codePostalClient, setCodePostalClient] = useState('')
  const [villeClient, setVilleClient] = useState('')
  const [telephoneClient, setTelephoneClient] = useState('')
  const [emailClient, setEmailClient] = useState('')
  const [technicienCommande, setTechnicienCommande] = useState('')
  const [chantierCommande, setChantierCommande] = useState('')

  function composerAdresse(rue, codePostal, ville) {
    const fin = [codePostal.trim(), ville.trim()].filter(Boolean).join(' ')
    return [rue.trim(), fin].filter(Boolean).join(', ')
  }

  function modifierAdresse(rue, codePostal, ville) {
    setRueClient(rue)
    setCodePostalClient(codePostal)
    setVilleClient(ville)
    setAdresseClient(composerAdresse(rue, codePostal, ville))
  }

  const [courses, setCourses] = useState([])
  const [chargementCourses, setChargementCourses] = useState(true)
  const [courseSelectionnee, setCourseSelectionnee] = useState(null)
  const [formulaireLivraisonOuvert, setFormulaireLivraisonOuvert] = useState(false)
  const [codeSaisi, setCodeSaisi] = useState('')
  const [recuParSaisi, setRecuParSaisi] = useState('')
  const [erreurCodeLivraison, setErreurCodeLivraison] = useState('')
  const [validationLivraisonEnCours, setValidationLivraisonEnCours] = useState(false)
  const [priseEnChargeAConfirmer, setPriseEnChargeAConfirmer] = useState(null)

  const [mesCommandes, setMesCommandes] = useState([])
  const [chargementCommandes, setChargementCommandes] = useState(true)

  const [mesFactures, setMesFactures] = useState([])
  // Statut de livraison des commandes des autres membres de l'équipe (visible
  // du responsable seulement) : { [id de commande]: statut }
  const [statutsEquipe, setStatutsEquipe] = useState({})
  // Mode de paiement / tarif de livraison de l'entreprise du compte connecté
  const [infosPaiement, setInfosPaiement] = useState(null)
  const [versionInfosPaiement, setVersionInfosPaiement] = useState(0)
  const [montantRecharge, setMontantRecharge] = useState('')
  const [rechargeEnCours, setRechargeEnCours] = useState(false)
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

  // Liste à plat de tous les produits, avec leur métier, leur sous-section
  // et leur fournisseur (FOURNISSEUR_PAR_DEFAUT si non renseigné).
  const produitsTous = metiers.flatMap((metier) =>
    metier.sousSections.flatMap((sousSection) =>
      sousSection.produits.map((produit) => ({
        ...produit,
        metier: metier.nom,
        sousSection: sousSection.nom,
        fournisseur: produit.fournisseur || FOURNISSEUR_PAR_DEFAUT
      }))
    )
  )

  const sousSectionsAffichees = metiers
    .filter((metier) => !metierFiltre || metier.nom === metierFiltre)
    .flatMap((metier) => metier.sousSections)

  // Fournisseurs, avec leurs produits (filtrés par métier si besoin).
  const fournisseursListe = Object.values(
    produitsTous
      .filter((produit) => !metierFiltre || produit.metier === metierFiltre)
      .reduce((acc, produit) => {
        if (!acc[produit.fournisseur]) {
          acc[produit.fournisseur] = { nom: produit.fournisseur, produits: [], categories: [] }
        }
        acc[produit.fournisseur].produits.push(produit)
        if (!acc[produit.fournisseur].categories.includes(produit.sousSection)) {
          acc[produit.fournisseur].categories.push(produit.sousSection)
        }
        return acc
      }, {})
  ).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))

  const nombreFournisseursTotal = new Set(produitsTous.map((produit) => produit.fournisseur)).size

  // Sous-sections du fournisseur ouvert.
  const sousSectionsFournisseur = fournisseurActif
    ? Object.values(
        produitsTous
          .filter((produit) => produit.fournisseur === fournisseurActif)
          .reduce((acc, produit) => {
            if (!acc[produit.sousSection]) acc[produit.sousSection] = { nom: produit.sousSection, produits: [] }
            acc[produit.sousSection].produits.push(produit)
            return acc
          }, {})
      )
    : []

  // Panier regroupé par fournisseur (on garde l'index d'origine pour les
  // boutons + / −).
  const groupesPanier = Object.values(
    panier.reduce((acc, produit, index) => {
      const nom = produit.fournisseur || FOURNISSEUR_PAR_DEFAUT
      if (!acc[nom]) acc[nom] = { nom, lignes: [] }
      acc[nom].lignes.push({ produit, index })
      return acc
    }, {})
  )

  // Recherche transversale : cherche directement dans les produits de
  // toutes les catégories, plutôt que de se limiter aux noms de catégories.
  const rechercheNormalisee = retirerAccents(recherche.trim().toLowerCase())
  const produitsRecherches = rechercheNormalisee === ''
    ? []
    : sousSectionsDisponibles.flatMap((sousSection) =>
        sousSection.produits
          .filter((produit) => retirerAccents(produit.nom.toLowerCase()).includes(rechercheNormalisee))
          .map((produit) => ({ ...produit, sousSection: sousSection.nom, fournisseur: produit.fournisseur || FOURNISSEUR_PAR_DEFAUT }))
      )

  const produitsFiltresAdmin = produitsBruts.filter((produit) => {
    const cible = retirerAccents(`${produit.nom} ${produit.sous_section}`.toLowerCase())
    return cible.includes(retirerAccents(rechercheProduitsAdmin.toLowerCase()))
  })

  const coursesActives = courses.filter((course) => course.statut !== 'Livrée' && course.statut !== 'Annulée')
  const coursesLivrees = courses.filter((course) => course.statut === 'Livrée')

  // Les plus récentes d'abord, pour les retrouver facilement.
  const plusRecenteDabord = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))
  const coursesDisponibles = coursesActives.filter((course) => !course.livreur_id).sort(plusRecenteDabord)
  const coursesMoi = session ? coursesActives.filter((course) => course.livreur_id === session.user.id).sort(plusRecenteDabord) : []
  const coursesLivreesMoi = session ? coursesLivrees.filter((course) => course.livreur_id === session.user.id).sort(plusRecenteDabord) : []

  const coursesFiltreesStatut = filtreAdmin === 'toutes' ? courses : courses.filter((course) => course.statut === filtreAdmin)
  // Date de prise de commande affichée dans le tableau admin (ex. "05/10/2026")
  // et heure associée (ex. "14:32"), pour retrouver une commande facilement.
  const dateCommandeAdmin = (course) =>
    course.created_at ? new Date(course.created_at).toLocaleDateString('fr-FR') : ''
  const heureCommandeAdmin = (course) =>
    course.created_at
      ? new Date(course.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : ''

  const coursesFiltreesAdmin = rechercheAdmin.trim() === ''
    ? coursesFiltreesStatut
    : coursesFiltreesStatut.filter((course) => {
        const cible = retirerAccents(`${course.client || ''} ${course.adresse || ''} ${course.produits || ''} ${course.telephone || ''} ${dateCommandeAdmin(course)}`.toLowerCase())
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
      // Compte entreprise : le "client" de la commande est l'entreprise, et
      // la personne qui commande est celle qui est connectée.
      if (role === 'client') {
        setNomClient((precedent) => precedent || nomUtilisateur)
      } else if (entreprise && entreprise.entreprise_nom) {
        setNomClient((precedent) => precedent || entreprise.entreprise_nom)
      }
      setEmailClient((precedent) => precedent || session.user.email || '')
      if (role === 'entreprise' && nomUtilisateur) {
        setTechnicienCommande((precedent) => precedent || nomUtilisateur)
      }
    }
  }, [role, session, nomUtilisateur, entreprise])

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
    // Même personne = même objet de session. Supabase renvoie un événement
    // (SIGNED_IN, TOKEN_REFRESHED...) à chaque retour sur l'onglet du
    // navigateur : sans ce garde-fou, le site rechargeait le profil et
    // renvoyait la personne à l'accueil à chaque changement d'onglet.
    function garderSessionSiMemePersonne(precedente, nouvelle) {
      if (precedente && nouvelle && precedente.user && nouvelle.user && precedente.user.id === nouvelle.user.id) {
        return precedente
      }
      return nouvelle
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession((precedente) => garderSessionSiMemePersonne(precedente, session))
      if (!session) setChargementAuth(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (_event === 'USER_UPDATED' || _event === 'PASSWORD_RECOVERY' || _event === 'SIGNED_OUT') {
        setSession(session)
      } else {
        setSession((precedente) => garderSessionSiMemePersonne(precedente, session))
      }
      if (_event === 'PASSWORD_RECOVERY') {
        setModeReinitialisation(true)
        setAfficherAuth(true)
      }
      if (!session) {
        utilisateurRedirige.current = null
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
      setModeAuth('inscription')
      setAfficherAuth(true)
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [])

  // Lien d'inscription fournisseur (2cdelivery.ch/?fournisseur).
  useEffect(() => {
    const parametres = new URLSearchParams(window.location.search)
    if (!parametres.has('fournisseur')) return
    window.history.replaceState({}, document.title, window.location.pathname)
    setAccesInscriptionFournisseur(true)
    setRoleChoisi('fournisseur')
    setModeAuth('inscription')
    setAfficherAuth(true)
  }, [])

  // Compte fournisseur : rattaché à la connexion à partir des données de
  // l'inscription (la base crée la demande "en attente" la première fois).
  useEffect(() => {
    const nomMeta = session && session.user && session.user.user_metadata
      ? session.user.user_metadata.fournisseur_nom
      : null
    if (!session || !nomMeta) {
      setCompteFournisseur(null)
      return undefined
    }
    let annule = false
    supabase.rpc('initialiser_compte_fournisseur').then(({ data, error }) => {
      if (annule) return
      if (error) {
        console.error('Erreur de rattachement du compte fournisseur :', error)
        setCompteFournisseur(null)
        return
      }
      setCompteFournisseur(data || null)
    })
    return () => {
      annule = true
    }
  }, [session])

  // Alerte sonore + bandeau quand une nouvelle commande est à préparer
  // (fournisseur validé, quelle que soit la page ouverte du site).
  useAlerteFournisseur(compteFournisseur, afficherNotification)

  // Retire le paramètre ?ouvrir= de la barre d'adresse (déjà lu plus haut).
  useEffect(() => {
    const parametres = new URLSearchParams(window.location.search)
    if (!parametres.has('ouvrir')) return
    window.history.replaceState({}, document.title, window.location.pathname)
  }, [])

  // Lien « Accéder à mon compte » des emails et QR code des factures
  // (2cdelivery.ch/?compte=1) : ouvre le panneau du compte (connexion si
  // la personne n'est pas connectée). Le QR ne contient aucun secret.
  useEffect(() => {
    const parametres = new URLSearchParams(window.location.search)
    if (!parametres.has('compte')) return
    window.history.replaceState({}, document.title, window.location.pathname)
    setModeAuth('connexion')
    setAfficherAuth(true)
  }, [])

  // Lien « Créer mon compte » des emails envoyés après une commande sans compte.
  useEffect(() => {
    const parametres = new URLSearchParams(window.location.search)
    if (!parametres.has('inscription')) return
    window.history.replaceState({}, document.title, window.location.pathname)
    setModeAuth('inscription')
    setAfficherAuth(true)
  }, [])

  // Lien d'invitation d'une équipe (ex: 2cdelivery.ch/?equipe=CODE) : ouvre
  // l'inscription entreprise, qui rattachera la personne comme employé.
  useEffect(() => {
    const parametres = new URLSearchParams(window.location.search)
    const code = parametres.get('equipe')
    if (!code) return
    window.history.replaceState({}, document.title, window.location.pathname)
    setInvitationEquipe({ code, nom: '' })
    setRoleChoisi('entreprise')
    setModeAuth('inscription')
    setAfficherAuth(true)
    supabase.rpc('nom_entreprise_invitation', { p_code: code }).then(({ data, error }) => {
      if (error) {
        console.error("Erreur de lecture de l'invitation :", error)
        return
      }
      if (data) setInvitationEquipe({ code, nom: data })
      else setInvitationEquipe({ code, nom: null })
    })
  }, [])

  // Retour depuis la recharge du solde prépayé (?recharge=ok ou ?recharge=annule).
  useEffect(() => {
    const parametres = new URLSearchParams(window.location.search)
    const retour = parametres.get('recharge')
    if (!retour) return
    window.history.replaceState({}, document.title, window.location.pathname)
    if (retour === 'ok') {
      afficherNotification('Paiement reçu : le solde de votre entreprise est mis à jour.', 'info')
      // Le crédit est fait par le serveur en quelques secondes : on relit le solde.
      ;[0, 3000, 7000].forEach((delai) => {
        setTimeout(() => setVersionInfosPaiement((v) => v + 1), delai)
      })
    } else {
      afficherNotification("Recharge annulée : rien n'a été débité.", 'info')
    }
  }, [])

  // Retour depuis la page de paiement Stripe (?paiement=ok ou ?paiement=annule).
  useEffect(() => {
    const parametres = new URLSearchParams(window.location.search)
    const retour = parametres.get('paiement')
    if (!retour) return
    const identifiantSession = parametres.get('session_id')
    window.history.replaceState({}, document.title, window.location.pathname)

    if (retour === 'annule') {
      // Le client a quitté la page de paiement : rien n'a été débité ni
      // enregistré, on lui rend son panier et ses coordonnées.
      try {
        const brut = window.localStorage.getItem('panierEnAttente2C')
        if (brut) {
          const sauvegarde = JSON.parse(brut)
          setPanier(sauvegarde.panier || [])
          setNomClient(sauvegarde.nomClient || '')
          if (sauvegarde.rueClient || sauvegarde.codePostalClient || sauvegarde.villeClient) {
            modifierAdresse(sauvegarde.rueClient || '', sauvegarde.codePostalClient || '', sauvegarde.villeClient || '')
          } else {
            // ancienne sauvegarde : adresse en un seul morceau
            modifierAdresse(sauvegarde.adresseClient || '', '', '')
          }
          setTelephoneClient(sauvegarde.telephoneClient || '')
          setEmailClient(sauvegarde.emailClient || '')
          setVue('panier')
        }
      } catch (e) {
        // stockage indisponible - on ignore silencieusement
      }
      afficherNotification("Paiement annulé : ta commande n'a pas été enregistrée, ton panier est conservé.", 'info')
      return
    }

    if (retour === 'ok' && identifiantSession) {
      confirmerRetourPaiement(identifiantSession)
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
          // Redirection vers l'espace de la personne seulement à la
          // connexion (changement de personne), jamais lors d'un simple
          // rafraîchissement de session : elle reste où elle était.
          if (utilisateurRedirige.current !== session.user.id) {
            utilisateurRedirige.current = session.user.id
            // Page rechargée (le navigateur met parfois un onglet en
            // veille) : on rouvre la section où la personne se trouvait.
            const memorisee = lireEspaceMemorise()
            if (ouvrirAuDemarrage === 'commandes') {
              setEspace('fournisseurEspace')
            } else if (memorisee && memorisee.userId === session.user.id && memorisee.role === data.role && memorisee.espace) {
              setEspace(memorisee.espace)
            } else {
              setEspace(
                data.role === 'livreur' ? 'livreur' :
                data.role === 'admin' ? 'admin' :
                data.role === 'livreur_en_attente' ? 'livreurEnAttente' :
                'catalogue'
              )
            }
          }
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
        setEspace('catalogue')
        afficherNotification('Ta session a expiré, merci de te reconnecter.', 'info')
      }
      setChargementAuth(false)
    }
    chargerRole()
  }, [session, modeReinitialisation])

  // Mémorise la section en cours (voir lireEspaceMemorise).
  useEffect(() => {
    if (chargementAuth) return
    if (session && role) {
      ecrireEspaceMemorise({ userId: session.user.id, role, espace })
    } else if (!session) {
      ecrireEspaceMemorise({ userId: null, role: null, espace })
    }
  }, [espace, session, role, chargementAuth])

  // Compte entreprise : la base rattache la personne à son entreprise à la
  // première connexion (responsable si elle crée l'entreprise, employé si
  // elle est arrivée par un lien d'invitation). Si le script SQL n'a pas
  // encore été exécuté, on ignore simplement : tout continue comme avant.
  useEffect(() => {
    if (role !== 'entreprise' || !session) {
      setEntreprise(null)
      return undefined
    }
    let annule = false
    supabase.rpc('initialiser_compte_entreprise').then(({ data, error }) => {
      if (annule) return
      if (error) {
        console.error("Erreur de rattachement à l'entreprise :", error)
        setEntreprise(null)
        return
      }
      setEntreprise(data && data.statut !== 'non_entreprise' ? data : null)
    })
    return () => {
      annule = true
    }
  }, [role, session])

  async function chargerEntreprisesAdmin() {
    const { data, error } = await supabase.rpc('admin_entreprises')
    if (error) {
      console.error('Erreur de chargement des entreprises :', error)
      return
    }
    setEntreprisesAdmin(data || [])

    const { data: soldes, error: erreurSoldes } = await supabase.rpc('admin_soldes_entreprises')
    if (!erreurSoldes && soldes) {
      const parEntreprise = {}
      soldes.forEach((l) => {
        parEntreprise[l.entreprise_id] = l
      })
      setSoldesAdmin(parEntreprise)
    }
  }

  async function chargerTarifAdmin() {
    const { data, error } = await supabase.from('tarif_livraison').select('*').eq('id', 1).maybeSingle()
    if (error || !data) {
      if (error) console.error('Erreur de chargement du tarif de livraison :', error)
      return
    }
    setTarifAdmin({
      forfait: String(data.forfait),
      km_inclus: String(data.km_inclus),
      prix_km: String(data.prix_km),
      delai_paiement_jours: data.delai_paiement_jours === undefined ? '10' : String(data.delai_paiement_jours)
    })
  }

  useEffect(() => {
    if (role === 'admin') {
      chargerEntreprisesAdmin()
      chargerTarifAdmin()
    }
  }, [role])

  async function apercuFactureMensuelle(id, debut, fin) {
    const { data, error } = await supabase.rpc('admin_apercu_facture_mensuelle', {
      p_entreprise: id,
      p_debut: debut,
      p_fin: fin
    })
    if (error) {
      console.error("Erreur d'aperçu de la facture mensuelle :", error)
      afficherNotification("Impossible de calculer l'aperçu de la facture.")
      return null
    }
    return data
  }

  // Fabrique le PDF, le dépose dans le dossier du responsable et l'envoie par email.
  async function publierFactureMensuelle(donnees) {
    const doc = construireFactureMensuellePDF(donnees)
    const { error: erreurUpload } = await supabase.storage
      .from('factures')
      .upload(donnees.chemin_pdf, doc.output('blob'), { contentType: 'application/pdf', upsert: true })
    if (erreurUpload) {
      console.error("Erreur d'enregistrement du PDF de la facture mensuelle :", erreurUpload)
      return { pdf: false, email: false }
    }
    if (!donnees.responsable_email) return { pdf: true, email: false }
    const pdfBase64 = doc.output('datauristring').split(',')[1]
    const { error: erreurEmail } = await supabase.functions.invoke('envoyer-facture-email', {
      body: {
        email: donnees.responsable_email,
        nomClient: donnees.entreprise_nom,
        numeroFacture: donnees.numero,
        pdfBase64,
        mensuelle: true,
        periode: libellePeriodeFacture(donnees)
      }
    })
    if (erreurEmail) console.error("Erreur d'envoi de la facture mensuelle :", erreurEmail)
    return { pdf: true, email: !erreurEmail }
  }

  async function creerFactureMensuelle(id, debut, fin) {
    const { data, error } = await supabase.rpc('admin_creer_facture_mensuelle', {
      p_entreprise: id,
      p_debut: debut,
      p_fin: fin
    })
    if (error || !data) {
      console.error('Erreur de création de la facture mensuelle :', error)
      const message = (error && error.message) || ''
      afficherNotification(
        message.includes('Aucune livraison')
          ? 'Aucune livraison à facturer sur cette période.'
          : message.includes('Aucun responsable')
            ? "Cette entreprise n'a pas de responsable actif."
            : "La facture n'a pas pu être créée."
      )
      return false
    }
    let resultat
    try {
      resultat = await publierFactureMensuelle(data)
    } catch (e) {
      console.error('Erreur de fabrication du PDF de la facture mensuelle :', e)
      resultat = { pdf: false, email: false }
    }
    if (!resultat.pdf) {
      afficherNotification(`Facture ${data.numero} créée, mais son PDF n'a pas pu être enregistré : utilisez « Renvoyer » dans la liste.`)
    } else if (!resultat.email) {
      afficherNotification(`Facture ${data.numero} créée, mais l'email n'est pas parti : utilisez « Renvoyer » dans la liste.`)
    } else {
      afficherNotification(`Facture ${data.numero} créée et envoyée à ${data.responsable_email}.`, 'info')
    }
    chargerEntreprisesAdmin()
    return true
  }

  async function listerFacturesMensuelles(id) {
    const { data, error } = await supabase.rpc('admin_factures_mensuelles', { p_entreprise: id })
    if (error) {
      console.error('Erreur de chargement des factures mensuelles :', error)
      return []
    }
    return data || []
  }

  async function renvoyerFactureMensuelle(factureId) {
    const { data, error } = await supabase.rpc('admin_donnees_facture_mensuelle', { p_facture_id: factureId })
    if (error || !data) {
      console.error('Erreur de relecture de la facture mensuelle :', error)
      afficherNotification("Impossible de relire cette facture.")
      return
    }
    const resultat = await publierFactureMensuelle(data)
    afficherNotification(
      resultat.pdf && resultat.email
        ? `Facture ${data.numero} renvoyée à ${data.responsable_email}.`
        : "L'envoi a échoué, réessayez dans un instant.",
      resultat.pdf && resultat.email ? 'info' : undefined
    )
  }

  async function enregistrerTarifAdmin() {
    const nombre = (v) => Number(String(v).replace(',', '.'))
    const forfait = nombre(tarifAdmin.forfait)
    const kmInclus = nombre(tarifAdmin.km_inclus || 0)
    const prixKm = nombre(tarifAdmin.prix_km || 0)
    if (!Number.isFinite(forfait) || forfait < 0.5 || !Number.isFinite(kmInclus) || kmInclus < 0 || !Number.isFinite(prixKm) || prixKm < 0) {
      afficherNotification('Tarif invalide : forfait d\'au moins 0.50 CHF, autres valeurs positives.')
      return
    }
    const { error } = await supabase.rpc('admin_modifier_tarif', {
      p_forfait: forfait,
      p_km_inclus: kmInclus,
      p_prix_km: prixKm
    })
    if (error) {
      console.error("Erreur d'enregistrement du tarif :", error)
      afficherNotification("L'enregistrement du tarif a échoué.")
      return
    }
    const delai = Number(String(tarifAdmin.delai_paiement_jours).replace(',', '.'))
    if (Number.isInteger(delai) && delai >= 0) {
      const { error: erreurDelai } = await supabase.rpc('admin_modifier_delai_paiement', { p_jours: delai })
      if (erreurDelai) {
        console.error("Erreur d'enregistrement du délai de paiement :", erreurDelai)
        afficherNotification("Le tarif est enregistré, mais pas le délai de paiement (SQL de la facture mensuelle lancé ?).")
        return
      }
    }
    afficherNotification('Tarif de livraison enregistré.', 'info')
  }

  async function crediterPrepayeAdmin(id, montant, note) {
    const { error } = await supabase.rpc('admin_crediter_prepaye', {
      p_entreprise: id,
      p_montant: montant,
      p_note: note
    })
    if (error) {
      console.error('Erreur de crédit du solde :', error)
      afficherNotification('Le crédit du solde a échoué.')
      return false
    }
    afficherNotification('Solde mis à jour.', 'info')
    chargerEntreprisesAdmin()
    return true
  }

  async function enregistrerEntrepriseAdmin(id, { statut, mode, plafond, fournisseurs }) {
    const { error } = await supabase.rpc('admin_modifier_entreprise', {
      p_id: id,
      p_statut: statut,
      p_mode_paiement: mode,
      p_plafond: plafond,
      p_fournisseurs: fournisseurs
    })
    if (error) {
      console.error("Erreur d'enregistrement de l'entreprise :", error)
      afficherNotification("L'enregistrement a échoué, réessayez.")
      return
    }
    afficherNotification('Entreprise mise à jour.', 'info')
    chargerEntreprisesAdmin()
  }

  useEffect(() => {
    if (role !== 'admin') return

    async function chargerLivreurs() {
      const { data, error } = await supabase.from('profils').select('id, nom, email, disponible').eq('role', 'livreur')
      if (!error && data) {
        setLivreurs(data)
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
    chargerDemandesLivreur()

    const canal = supabase
      .channel('profils-en-direct')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profils' }, () => {
        chargerLivreurs()
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

  // Catalogue public : seuls les produits "publiés" sont affichés (les
  // produits d'un fournisseur en attente de validation restent cachés).
  // Si la colonne n'existe pas encore (script SQL fournisseur pas exécuté),
  // on retombe sur l'ancien chargement sans filtre.
  async function chargerProduits() {
    let { data, error } = await supabase.from('produits').select('*').eq('statut_validation', 'publie')
    if (error) {
      const secours = await supabase.from('produits').select('*')
      data = secours.data
      error = secours.error
    }
    if (error) {
      console.error('Erreur de chargement :', error)
    } else {
      setProduitsBruts(data)
      setMetiers(grouperProduits(data))
    }
    setChargement(false)
  }

  useEffect(() => {
    chargerProduits()
  }, [])

  async function chargerFournisseursCarte() {
    const { data, error } = await supabase.from('fournisseurs').select('*')
    if (error) {
      // La table n'existe peut-être pas encore : la carte reste simplement vide.
      console.error('Chargement des fournisseurs de la carte :', error)
      return
    }
    setFournisseursCarte(data || [])
  }

  useEffect(() => {
    chargerFournisseursCarte()
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
            if (!pushActifLocalement() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
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
            if (!pushActifLocalement() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
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
      // Responsable d'entreprise : "Mes commandes" regroupe celles de toute
      // l'équipe (les siennes comprises). Autres comptes : les siennes.
      const responsable = Boolean(
        entreprise && entreprise.statut === 'ok' && entreprise.role_entreprise === 'responsable'
      )
      if (responsable) {
        const [resCommandes, resStatuts] = await Promise.all([
          supabase.rpc('commandes_equipe'),
          supabase.rpc('statuts_equipe')
        ])
        if (!resCommandes.error) {
          setMesCommandes(resCommandes.data || [])
          const parCommande = {}
          ;(resStatuts.data || []).forEach((st) => {
            parCommande[String(st.commande_id)] = st.statut
          })
          setStatutsEquipe(parCommande)
          setChargementCommandes(false)
          return
        }
        console.error("Erreur de chargement des commandes de l'équipe :", resCommandes.error)
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
  }, [session, entreprise])

  useEffect(() => {
    if (!session || role !== 'entreprise' || !entreprise || entreprise.statut !== 'ok') {
      setInfosPaiement(null)
      return
    }
    let annule = false
    supabase.rpc('infos_paiement_entreprise').then(({ data, error }) => {
      if (annule) return
      if (error) {
        console.error('Erreur de chargement du mode de paiement :', error)
        setInfosPaiement(null)
      } else {
        setInfosPaiement(data)
      }
    })
    return () => {
      annule = true
    }
  }, [session, role, entreprise, versionInfosPaiement])

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
      // Responsable d'entreprise : factures de toute l'équipe.
      if (entreprise && entreprise.statut === 'ok' && entreprise.role_entreprise === 'responsable') {
        const { data: donneesEquipe, error: erreurEquipe } = await supabase.rpc('factures_equipe')
        if (!erreurEquipe) {
          setMesFactures(donneesEquipe || [])
          setChargementFactures(false)
          return
        }
        console.error("Erreur de chargement des factures de l'équipe :", erreurEquipe)
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
  }, [session, entreprise])

  // Télécharge une facture depuis l'espace "Mes factures" : on génère une
  // URL signée à la demande (le bucket est privé) plutôt que de garder un
  // lien permanent.
  async function telechargerFacture(facture) {
    setTelechargementFactureId(facture.id)
    // Nom du fichier téléchargé. Avec l'option "download", le serveur répond
    // en pièce jointe : le téléchargement démarre dans la même page, sans
    // ouvrir de nouvel onglet (les navigateurs mobiles bloquent un onglet
    // ouvert après une attente réseau, d'où l'ancien "rien ne se passe").
    const nomFichier = `Facture_${String(facture.numero_facture || facture.id).replace(/[^a-zA-Z0-9_-]/g, '')}.pdf`
    const { data, error } = await supabase.storage
      .from('factures')
      .createSignedUrl(facture.chemin_pdf, 120, { download: nomFichier })
    setTelechargementFactureId(null)

    if (error || !data) {
      console.error('Erreur de génération du lien de téléchargement :', error)
      afficherNotification('Impossible de récupérer cette facture, réessaie.')
      return
    }

    const lien = document.createElement('a')
    lien.href = data.signedUrl
    lien.download = nomFichier
    lien.rel = 'noopener'
    document.body.appendChild(lien)
    lien.click()
    document.body.removeChild(lien)
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
    const inscriptionFournisseur = roleChoisi === 'fournisseur'
    if (inscriptionFournisseur) {
      if (nomFournisseurInscription.trim() === '') {
        setErreurInscription("Merci d'indiquer le nom de votre société.")
        return
      }
      if (adresseFournisseurInscription.trim() === '') {
        setErreurInscription("Merci d'indiquer l'adresse de votre société (rue, code postal, ville) : elle sert à vous placer sur la carte.")
        return
      }
      if (nomInscription.trim() === '') {
        setErreurInscription("Merci d'indiquer votre nom et prénom.")
        return
      }
    }
    const inscriptionEntreprise = roleChoisi === 'entreprise'
    const viaInvitation = inscriptionEntreprise && invitationEquipe && invitationEquipe.nom
    if (inscriptionEntreprise && invitationEquipe && !invitationEquipe.nom) {
      setErreurInscription(
        invitationEquipe.nom === null
          ? "Ce lien d'invitation n'est plus valable. Demandez-en un nouveau au responsable de votre entreprise."
          : "Vérification de l'invitation en cours, réessayez dans un instant."
      )
      return
    }
    if (inscriptionEntreprise && !viaInvitation && nomEntrepriseInscription.trim() === '') {
      setErreurInscription("Merci d'indiquer le nom de votre entreprise.")
      return
    }
    if (inscriptionEntreprise && nomInscription.trim() === '') {
      setErreurInscription('Merci d\'indiquer votre nom et prénom.')
      return
    }
    // Pour un compte entreprise : le nom de l'entreprise (responsable) ou le
    // code du lien d'invitation (employé) voyagent avec l'inscription ; la
    // base s'en sert à la première connexion pour rattacher la personne.
    const donneesEntreprise = !inscriptionEntreprise
      ? {}
      : viaInvitation
        ? { invitation: invitationEquipe.code }
        : { entreprise_nom: nomEntrepriseInscription.trim() }
    const { data, error } = await supabase.auth.signUp({
      email: emailInscription,
      password: motDePasseInscription,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          // Le rôle du profil reste "client" pour un fournisseur : son accès
          // à l'espace fournisseur passe par la table fournisseur_comptes.
          role: inscriptionFournisseur ? 'client' : roleChoisi,
          nom: nomInscription,
          ...donneesEntreprise,
          ...(inscriptionFournisseur
            ? {
                fournisseur_nom: nomFournisseurInscription.trim(),
                fournisseur_telephone: telephoneFournisseurInscription.trim(),
                fournisseur_adresse: adresseFournisseurInscription.trim()
              }
            : {})
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
    // L'invitation est consommée : le rattachement à l'équipe se fait à la
    // première connexion, à partir des données envoyées avec l'inscription.
    setInvitationEquipe(null)
    setNomEntrepriseInscription('')
    if (!data.session) {
      // Pas de session tout de suite : la confirmation par email est
      // active, il faut prévenir le client plutôt que de le laisser
      // sans aucun retour après avoir cliqué sur "S'inscrire".
      setMessageInscription("Inscription bien reçue ! Vérifie ta boîte mail (et tes spams) et clique sur le lien de confirmation pour activer ton compte.")
      setEmailInscription('')
      setMotDePasseInscription('')
      setNomInscription('')
      setNomEntrepriseInscription('')
      setNomFournisseurInscription('')
      setTelephoneFournisseurInscription('')
      setAdresseFournisseurInscription('')
      setInvitationEquipe(null)
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
    setNomInscription('')
    setEmailInscription('')
    setMotDePasseInscription('')
    setErreurInscription('')
    setMessageInscription('')
    setAfficherMotDePasseOublie(false)
    setEmailOubli('')
    setMessageOubli('')
    setErreurOubli('')
    setEspace('catalogue')
    setVue('accueil')
    setAfficherAuth(false)
  }

  function ouvrirSousSection(sousSection) {
    setSousSectionActive(sousSection)
    setVue('sousSection')
  }

  function ouvrirFournisseur(nom) {
    setFournisseurActif(nom)
    setCategorieFournisseur(null)
    setVue('fournisseur')
    window.scrollTo({ top: 0 })
  }

  // Depuis une catégorie : retour au fournisseur si on en vient, sinon à l'accueil.
  function retourDeSousSection() {
    if (fournisseurActif) {
      setSousSectionActive(null)
      setVue('fournisseur')
    } else {
      retourAccueil()
    }
  }

  // Onglet "Commandes" de la barre du bas : selon le rôle.
  function ouvrirOngletCommandes() {
    setCommandeSelectionnee(null)
    if (role === 'client' || role === 'entreprise') setEspace('mesCommandes')
    else if (role === 'livreur') setEspace('livreur')
    else if (role === 'livreur_en_attente') setEspace('livreurEnAttente')
    else if (role === 'admin') setEspace('admin')
    else setEspace('suivi')
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
      return [...precedent, { id: produit.id, nom: produit.nom, prix: produit.prix, quantite: 1, fournisseur: produit.fournisseur || null }]
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
    if (course) return course.statut
    // Commande d'un autre membre de l'équipe (vue du responsable)
    return statutsEquipe[String(commandeId)] || 'À livrer'
  }

  // Vrai pour le responsable qui consulte la commande d'un de ses employés.
  function estCommandeDunAutre(commande) {
    return Boolean(
      session && commande && commande.user_id && commande.user_id !== session.user.id &&
      entreprise && entreprise.role_entreprise === 'responsable'
    )
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

  // Lance le paiement en ligne : le serveur recalcule le prix, met le panier
  // de côté et renvoie l'adresse de la page de paiement Stripe. La commande
  // n'est créée qu'une fois le paiement confirmé par Stripe.
  async function payerEnLigne() {
    setEnvoiEnCours(true)

    try {
      window.localStorage.setItem(
        'panierEnAttente2C',
        JSON.stringify({ panier, nomClient, adresseClient, rueClient, codePostalClient, villeClient, telephoneClient, emailClient })
      )
    } catch (e) {
      // stockage indisponible - le paiement fonctionne quand même
    }

    const { data, error } = await supabase.functions.invoke('creer-paiement', {
      body: {
        panier: panier.map((produit) => ({
          id: produit.id,
          nom: produit.nom,
          prix: produit.prix,
          quantite: produit.quantite
        })),
        nomClient,
        adresse: adresseClient,
        telephone: telephoneClient,
        email: emailClient,
        chantier: role === 'entreprise' ? chantierCommande.trim() : null,
        technicien: role === 'entreprise' ? technicienCommande.trim() : null
      }
    })

    // Entreprise en mode prépayé / mensuel : la commande est créée directement
    if (!error && data && data.commande) {
      setEnvoiEnCours(false)
      afficherConfirmationCommande(data.commande)
      return
    }

    if (error || !data || !data.url) {
      setEnvoiEnCours(false)
      let message = "Le paiement n'a pas pu être lancé, réessaie."
      try {
        const corps = await error.context.json()
        if (corps && corps.error) message = corps.error
      } catch (e) {
        // on garde le message par défaut
      }
      afficherNotification(message)
      return
    }

    window.location.href = data.url
  }

  // Au retour du paiement : on attend que la commande soit créée côté
  // serveur (quelques secondes au plus), puis on affiche la confirmation.
  async function confirmerRetourPaiement(identifiantSession) {
    setEnvoiEnCours(true)
    let commande = null
    for (let essai = 0; essai < 15 && !commande; essai++) {
      const { data, error } = await supabase.rpc('commande_apres_paiement', {
        p_session_id: identifiantSession
      })
      if (!error && data && data.length > 0) {
        commande = data[0]
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
    setEnvoiEnCours(false)

    try {
      window.localStorage.removeItem('panierEnAttente2C')
    } catch (e) {
      // stockage indisponible - on ignore silencieusement
    }
    setPanier([])

    if (!commande) {
      afficherNotification(
        'Paiement reçu : ta commande est en cours de validation. Tu vas recevoir un email de confirmation dans quelques instants.',
        'info'
      )
      return
    }

    afficherConfirmationCommande(commande)
  }

  // Après une annulation, rembourse automatiquement si la commande avait
  // été payée en ligne (le serveur vérifie tout : payée, bien annulée, pas
  // déjà remboursée). Sans effet pour une commande non payée en ligne.
  async function demanderRemboursement(commandeId) {
    if (!PAIEMENT_EN_LIGNE_ACTIF) return
    try {
      // Attention : la fonction a été déployée sous le nom "rembouser-commande"
      // (un seul "r" avant le "s") — son nom ne peut plus être modifié.
      const { data } = await supabase.functions.invoke('rembouser-commande', {
        body: { commande_id: commandeId }
      })
      if (data && data.rembourse) {
        afficherNotification(
          'Commande annulée. Le remboursement est lancé (quelques jours selon ta banque).',
          'info'
        )
      } else if (data && data.libere) {
        afficherNotification(
          data.mode === 'carte_entreprise'
            ? 'Commande annulée. La réservation sur votre carte est levée : rien ne sera débité.'
            : data.mode === 'prepaye'
              ? 'Commande annulée. Les frais de livraison sont recrédités sur votre solde.'
              : 'Commande annulée. Aucun frais de livraison ne sera facturé.',
          'info'
        )
      }
    } catch (e) {
      console.error('Erreur de remboursement :', e)
    }
  }

  // Un compte entreprise ne peut pas commander si son accès a été désactivé
  // par le responsable, si le lien d'invitation n'était plus valable ou si
  // l'entreprise est suspendue. Renvoie le message à afficher, ou null.
  function messageAccesEntreprise() {
    if (role !== 'entreprise' || !entreprise) return null
    if (entreprise.statut === 'invitation_invalide') {
      return "Ce lien d'invitation n'est plus valable. Demandez un nouveau lien au responsable de votre entreprise."
    }
    if (entreprise.actif === false) {
      return "Votre accès a été désactivé par le responsable de votre entreprise."
    }
    if (entreprise.statut_entreprise === 'suspendue') {
      return "Le compte de votre entreprise est suspendu. Contactez 2C Delivery."
    }
    return null
  }

  // Recharge du solde prépayé par carte (responsable uniquement, vérifié côté serveur).
  async function lancerRecharge() {
    const montant = Number(String(montantRecharge).replace(',', '.'))
    if (!Number.isFinite(montant) || montant < 20 || montant > 5000) {
      afficherNotification('Choisissez un montant entre 20 et 5000 CHF.')
      return
    }
    setRechargeEnCours(true)
    const { data, error } = await supabase.functions.invoke('creer-paiement', {
      body: { action: 'recharge', montant }
    })
    if (error || !data || !data.url) {
      setRechargeEnCours(false)
      let message = "La recharge n'a pas pu être lancée, réessayez."
      try {
        const corps = await error.context.json()
        if (corps && corps.error) message = corps.error
      } catch (e) {
        // on garde le message par défaut
      }
      afficherNotification(message)
      return
    }
    window.location.href = data.url
  }

  // Compte entreprise : seule la livraison est payée sur le site.
  function compteEntrepriseActif() {
    return Boolean(role === 'entreprise' && entreprise && entreprise.statut === 'ok')
  }

  function modePaiementEntreprise() {
    if (!compteEntrepriseActif()) return null
    return (infosPaiement && infosPaiement.mode_paiement) || 'carte'
  }

  function libelleFraisLivraison() {
    if (!infosPaiement) return '—'
    const forfait = Number(infosPaiement.forfait || 0).toFixed(2)
    return Number(infosPaiement.prix_km) > 0 ? `dès ${forfait} CHF` : `${forfait} CHF`
  }

  // Affiche la confirmation d'une commande qui vient d'être créée.
  function afficherConfirmationCommande(commande) {
    try {
      window.localStorage.removeItem('panierEnAttente2C')
    } catch (e) {
      // stockage indisponible - on ignore silencieusement
    }
    setPanier([])
    modifierAdresse('', '', '')
    setTelephoneClient('')
    setTechnicienCommande('')
    setChantierCommande('')

    setMesCommandes((precedentes) =>
      precedentes.some((c) => c.id === commande.id) ? precedentes : [commande, ...precedentes]
    )
    setCommandeInvite(commande)
    sauvegarderCommandeLocale(commande)

    const articles = (commande.produits_detail || []).reduce(
      (somme, ligne) => somme + Number(ligne.quantite || 1),
      0
    )
    const livraisonSeule = commande.mode_paiement && commande.mode_paiement !== 'en_ligne'
    setRecapCommande(
      livraisonSeule
        ? articles + ' article(s) · livraison 2C : ' + Number(commande.frais_livraison || 0).toFixed(2) + ' CHF'
        : articles + ' article(s) pour un total de ' + Number(commande.total).toFixed(2) + ' CHF'
    )
    setVue('commande')
    mettreAJourCreneau()
  }

  async function validerCommande() {
    if (panier.length === 0) {
      afficherNotification('Votre panier est vide.')
      return
    }
    const blocageEntreprise = messageAccesEntreprise()
    if (blocageEntreprise) {
      afficherNotification(blocageEntreprise)
      return
    }
    if (
      nomClient.trim() === '' ||
      rueClient.trim() === '' ||
      codePostalClient.trim() === '' ||
      villeClient.trim() === '' ||
      telephoneClient.trim() === '' ||
      emailClient.trim() === ''
    ) {
      afficherNotification("Merci de renseigner le nom, l'adresse de livraison complète (rue, code postal, ville), le téléphone et l'email.")
      return
    }
    if (!/\d/.test(rueClient)) {
      afficherNotification("Merci d'indiquer le numéro dans l'adresse (par exemple : Rue du Rhône 12).")
      return
    }
    if (!/^\d{4,5}$/.test(codePostalClient.trim())) {
      afficherNotification('Le code postal doit comporter 4 chiffres (5 pour la France voisine).')
      return
    }
    if (role === 'entreprise' && (technicienCommande.trim() === '' || chantierCommande.trim() === '')) {
      afficherNotification("Merci de renseigner le nom du chantier et le nom de l'employé qui commande.")
      return
    }

    // Tous les clients (particuliers, invités, entreprises) paient en ligne.
    if (PAIEMENT_EN_LIGNE_ACTIF) {
      await payerEnLigne()
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
    modifierAdresse('', '', '')
    setTelephoneClient('')
    setTechnicienCommande('')
    setChantierCommande('')
    setVue('commande')
    mettreAJourCreneau()
  }

  function retourAccueil() {
    setVue('accueil')
    setSousSectionActive(null)
    setFournisseurActif(null)
  }

  // Envoie automatiquement la facture par email au client dès que sa
  // commande passe au statut "Livrée" — comme ça, la facture correspond
  // toujours à une commande réellement livrée, jamais à une commande en
  // cours ou annulée. Se déroule en arrière-plan : si ça échoue (pas
  // d'email renseigné, souci réseau...), ça n'empêche jamais de valider
  // la livraison elle-même.
  // Toutes les commandes (particuliers comme entreprises) reçoivent leur
  // facture individuelle : la facturation mensuelle n'existe plus.

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

    if (error || !data) {
      console.error('Erreur de récupération de la commande pour la facture :', error)
      return
    }
    if (!data.email) {
      console.error("Facture non envoyée : aucune adresse email sur la commande", commandeId)
      return
    }

    // Commandes entreprise : seule la livraison est facturée. Le mode de
    // paiement décide de la suite (voir ci-dessous).
    let infosFrais = null
    try {
      const { data: fraisData, error: erreurFrais } = await supabase.rpc('obtenir_frais_commande', {
        p_commande_id: String(commandeId)
      })
      if (!erreurFrais && fraisData) infosFrais = fraisData
    } catch (e) {
      console.error('Frais de livraison indisponibles :', e)
    }
    const modeEntreprise = infosFrais && infosFrais.mode_paiement && infosFrais.mode_paiement !== 'en_ligne'
      ? infosFrais.mode_paiement
      : null

    if (modeEntreprise === 'mensuel') {
      // Facturée dans la facture mensuelle (pas de facture individuelle).
      return
    }
    if (modeEntreprise === 'carte_entreprise') {
      // On débite la carte réservée AVANT d'envoyer une facture "payée".
      const { data: resultat, error: erreurEncaissement } = await supabase.functions.invoke('encaisser-livraison', {
        body: { commande_id: commandeId }
      })
      if (erreurEncaissement || !resultat || !resultat.encaisse) {
        console.error("Le débit de la carte de l'entreprise a échoué :", erreurEncaissement || resultat)
        afficherNotification(
          "Livraison validée, mais le débit de la carte de l'entreprise n'a pas abouti. 2C Delivery va régulariser.",
          'info'
        )
        return
      }
    }
    if (modeEntreprise) {
      data.livraison_seule = true
      data.frais_livraison = infosFrais.frais_livraison
      data.chantier = infosFrais.chantier
      data.technicien = infosFrais.technicien
      data.deja_regle = true
      data.mention_paiement =
        modeEntreprise === 'prepaye'
          ? 'Réglé par prélèvement sur le solde prépayé.'
          : 'Réglé par carte bancaire.'
    }

    const { doc, numeroFacture } = construireFacturePDF(data)
    const pdfBase64 = doc.output('datauristring').split(',')[1]

    // Compte entreprise : le responsable reçoit la facture en copie. Si la
    // fonction n'existe pas encore ou échoue, la facture part quand même
    // au client, sans copie.
    let copieEmail = null
    try {
      const { data: emailResponsable, error: erreurCopie } = await supabase.rpc('email_responsable_commande', {
        p_commande_id: String(commandeId)
      })
      if (!erreurCopie && emailResponsable) copieEmail = emailResponsable
    } catch (e) {
      console.error('Copie responsable indisponible :', e)
    }

    supabase.functions
      .invoke('envoyer-facture-email', {
        body: { email: data.email, nomClient: data.nom_client, numeroFacture, pdfBase64, copieEmail, aUnCompte: Boolean(data.user_id) }
      })
      .catch((erreurEmail) => {
        console.error("Erreur d'envoi automatique de la facture :", erreurEmail)
      })

    // Copie consultable dans "Mes factures" — seulement pour les commandes
    // passées par un compte (un invité n'a pas d'espace où la retrouver,
    // il garde l'email).
    if (data.user_id) {
      enregistrerFacture({
        numeroFacture,
        userId: data.user_id,
        commandeId,
        montant: data.livraison_seule ? Number(data.frais_livraison || 0) : data.total,
        doc
      })
    }
  }

  async function avancerStatut(index) {
    const course = courses[index]
    const indexStatut = STATUTS.indexOf(course.statut)
    if (indexStatut >= STATUTS.length - 1) {
      return
    }
    const nouveauStatut = STATUTS[indexStatut + 1]

    // La livraison se valide avec le code du client (voir validerLivraison).
    if (nouveauStatut === 'Livrée') {
      setFormulaireLivraisonOuvert(true)
      return
    }

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
    demanderRemboursement(commande.id)
  }

  async function validerLivraison(index) {
    const course = courses[index]
    if (!/^\d{4}$/.test(codeSaisi.trim())) {
      setErreurCodeLivraison('Le code comporte 4 chiffres.')
      return
    }
    setErreurCodeLivraison('')
    setValidationLivraisonEnCours(true)
    const { data, error } = await supabase.rpc('valider_livraison', {
      p_course_id: String(course.id),
      p_code: codeSaisi.trim(),
      p_recu_par: recuParSaisi.trim() || null
    })
    setValidationLivraisonEnCours(false)

    if (error) {
      console.error('Erreur de validation de la livraison :', error)
      setErreurCodeLivraison(
        error.message && error.message.includes('Code de livraison requis')
          ? 'Code de livraison requis.'
          : "La validation a échoué, réessaie."
      )
      return
    }
    if (!data || !data.ok) {
      setErreurCodeLivraison((data && data.message) || 'Code incorrect.')
      return
    }

    setCourses(courses.map((c, i) => (i === index ? { ...c, statut: 'Livrée' } : c)))
    setFormulaireLivraisonOuvert(false)
    setCodeSaisi('')
    setRecuParSaisi('')
    afficherNotification('Livraison validée.', 'info')
    if (course.commande_id) {
      envoyerFactureAutomatique(course.commande_id)
    }
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
    setPriseEnChargeAConfirmer(null)
    afficherNotification('Commande prise en charge.', 'info')
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

    if (nouveauStatut === 'Annulée') {
      const courseAnnulee = courses.find((c) => c.id === courseId)
      if (courseAnnulee && courseAnnulee.commande_id) {
        demanderRemboursement(courseAnnulee.commande_id)
      }
    }

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
    // On ajoute tout de suite le livreur à la liste locale plutôt que
    // d'attendre le retour de l'abonnement temps réel sur "profils" (qui
    // peut tarder, voire ne jamais arriver) : sans ça, "Gérer les livreurs"
    // continuait d'afficher "Aucun livreur pour l'instant" juste après une
    // validation, jusqu'au rechargement de la page.
    const demandeApprouvee = demandesLivreur.find((d) => d.id === profilId)
    setDemandesLivreur(demandesLivreur.filter((d) => d.id !== profilId))
    setLivreurs((precedent) =>
      precedent.some((l) => l.id === profilId)
        ? precedent
        : [
            ...precedent,
            {
              id: profilId,
              nom: demandeApprouvee ? demandeApprouvee.nom : '',
              email: demandeApprouvee ? demandeApprouvee.email : '',
              disponible: true
            }
          ]
    )
    afficherNotification('Compte livreur validé.', 'info')
    // Les documents d'identité ne servent plus une fois la décision prise :
    // suppression automatique du stockage (pas de conservation au-delà du
    // strict nécessaire pour la vérification). La suppression passe par le
    // Storage API (supabase.storage...remove), pas par une fonction SQL :
    // Supabase refuse un DELETE direct sur les tables de stockage, même
    // depuis une fonction SECURITY DEFINER ("Direct deletion from storage
    // tables is not allowed. Use the Storage API instead.").
    nettoyerDocumentsLivreur(demandeApprouvee)
  }

  async function refuserDemandeLivreur(profilId) {
    if (!window.confirm('Refuser cette demande de compte livreur ? Le compte redevient un compte client normal.')) return
    const demandeRefusee = demandesLivreur.find((d) => d.id === profilId)
    const { error } = await supabase.rpc('refuser_demande_livreur', { p_profil_id: profilId })
    if (error) {
      console.error('Erreur de refus de la demande :', error)
      afficherNotification('Le refus a échoué, réessaie.')
      return
    }
    setDemandesLivreur(demandesLivreur.filter((d) => d.id !== profilId))
    afficherNotification('Demande refusée.', 'info')
    nettoyerDocumentsLivreur(demandeRefusee)
  }

  // Supprime du stockage la pièce d'identité et le casier judiciaire d'une
  // candidature livreur une fois la décision (validation ou refus) prise.
  function nettoyerDocumentsLivreur(demande) {
    const chemins = [demande?.document_identite_path, demande?.document_casier_path].filter(Boolean)
    if (chemins.length === 0) return
    supabase.storage.from('documents-livreurs').remove(chemins).then(({ error: erreurNettoyage }) => {
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

  async function ajouterProduit() {
    const prixNombre = parseFloat(nouveauPrixProduit.replace(',', '.'))
    const stockTexte = nouveauStockProduit.trim()
    const stockNombre = stockTexte === '' ? null : parseInt(stockTexte, 10)

    if (nouveauNomProduit.trim() === '' || nouveauMetierProduit.trim() === '' || nouveauSousSection.trim() === '' || nouveauPrixProduit.trim() === '') {
      setErreurProduit('Merci de remplir le métier, la sous-section, le nom et le prix.')
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
        metier: nouveauMetierProduit.trim(),
        sous_section: nouveauSousSection.trim(),
        nom: nouveauNomProduit.trim(),
        prix: prixNombre,
        image_url: nouveauImageProduit.trim() || null,
        quantite_stock: stockNombre,
        // Colonne "fournisseur" à créer une fois dans Supabase (voir
        // l'instruction SQL) : on ne l'envoie que si elle est renseignée.
        ...(nouveauFournisseur.trim() !== '' ? { fournisseur: nouveauFournisseur.trim() } : {})
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
    setNouveauFournisseur('')
    setNouveauNomProduit('')
    setNouveauPrixProduit('')
    setNouveauImageProduit('')
    setNouveauStockProduit('')
    afficherNotification('Produit ajouté au catalogue.', 'info')
  }

  function commencerEditionProduit(produit) {
    setEditionProduitId(produit.id)
    setEditionSousSection(produit.sous_section)
    setEditionFournisseur(produit.fournisseur || '')
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
        quantite_stock: stockNombre,
        // N'écrit la colonne fournisseur que si elle existe déjà en base.
        ...('fournisseur' in (produitsBruts.find((p) => p.id === id) || {})
          ? { fournisseur: editionFournisseur.trim() || null }
          : {})
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
            quantite_stock: stockNombre,
            ...('fournisseur' in p ? { fournisseur: editionFournisseur.trim() || null } : {})
          }
        : p
    )
    setProduitsBruts(nouveauxProduits)
    setMetiers(grouperProduits(nouveauxProduits))
    setEditionProduitId(null)
    afficherNotification('Produit modifié.', 'info')
  }

  async function ajouterFournisseurCarte() {
    const nom = nouveauNomFournisseur.trim()
    const adresse = nouvelleAdresseFournisseur.trim()
    if (nom === '' || adresse === '') {
      setErreurFournisseurAdmin("Merci de remplir le nom et l'adresse (avec la ville).")
      return
    }
    setErreurFournisseurAdmin('')
    setEnvoiFournisseurEnCours(true)
    try {
      // On transforme l'adresse en coordonnées avec le service gratuit OpenStreetMap.
      const reponse = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(adresse)}`,
        { headers: { 'Accept-Language': 'fr' } }
      )
      const resultats = await reponse.json()
      if (!Array.isArray(resultats) || resultats.length === 0) {
        setErreurFournisseurAdmin("Adresse introuvable. Précise la rue, le code postal et la ville.")
        setEnvoiFournisseurEnCours(false)
        return
      }
      const latitude = parseFloat(resultats[0].lat)
      const longitude = parseFloat(resultats[0].lon)
      const { data, error } = await supabase
        .from('fournisseurs')
        .insert({ nom, adresse, metier: nouveauMetierFournisseur.trim() || null, latitude, longitude })
        .select()
        .single()
      if (error) {
        console.error("Erreur d'ajout du fournisseur :", error)
        setErreurFournisseurAdmin("L'ajout a échoué (la table 'fournisseurs' existe-t-elle dans Supabase ?).")
        setEnvoiFournisseurEnCours(false)
        return
      }
      setFournisseursCarte((precedent) => [...precedent, data])
      setNouveauNomFournisseur('')
      setNouvelleAdresseFournisseur('')
      afficherNotification('Fournisseur ajouté à la carte.', 'info')
    } catch (e) {
      console.error('Erreur de localisation :', e)
      setErreurFournisseurAdmin("La localisation de l'adresse a échoué, réessaie dans un instant.")
    }
    setEnvoiFournisseurEnCours(false)
  }

  async function supprimerFournisseurCarte(id) {
    if (!window.confirm('Retirer ce fournisseur de la carte ?')) return
    const { error } = await supabase.from('fournisseurs').delete().eq('id', id)
    if (error) {
      console.error('Erreur de suppression du fournisseur :', error)
      afficherNotification('La suppression a échoué, réessaie.')
      return
    }
    setFournisseursCarte((precedent) => precedent.filter((f) => f.id !== id))
    afficherNotification('Fournisseur retiré de la carte.', 'info')
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

  // ------------------------------------------------------------
  // Éléments d'interface partagés (nouvelle navigation)
  // ------------------------------------------------------------
  const blocConfigurateur = (
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
  )

  function choisirMetier(nom) {
    setMetierFiltre((precedent) => (precedent === nom ? null : nom))
    if (vue !== 'accueil') retourAccueil()
  }

  function changerModeAccueil(mode) {
    setModeAccueil(mode)
    if (vue !== 'accueil') retourAccueil()
  }

  function changerRechercheEntete(valeur) {
    setRecherche(valeur)
    if (valeur !== '' && vue !== 'accueil') retourAccueil()
  }

  function ouvrirPanier() {
    setEspace('catalogue')
    setVue('panier')
    window.scrollTo({ top: 0 })
  }

  function ouvrirCatalogue() {
    setEspace('catalogue')
    retourAccueil()
    setAfficherAuth(false)
    setAfficherMenu(false)
    window.scrollTo({ top: 0 })
  }

  // Une ligne de produit : nom, détail, prix, vignette et bouton +.
  function ligneProduit(produit, cle, detail) {
    const rupture = estEnRupture(produit)
    const stockFaible = !rupture && produit.quantite_stock !== null && produit.quantite_stock !== undefined && produit.quantite_stock <= 3
    return (
      <li key={cle} className="ligne-produit">
        <div className="texte-ligne-produit">
          <span className="nom-ligne-produit">{produit.nom}</span>
          {detail && <span className="detail-ligne-produit">{detail}</span>}
          <span className="prix-ligne-produit">{produit.prix.toFixed(2)} CHF</span>
          {rupture && <span className="rupture-stock">Rupture de stock</span>}
          {stockFaible && <span className="stock-faible">Plus que {produit.quantite_stock} en stock</span>}
        </div>
        {produit.image_url && <img src={produit.image_url} alt="" className="vignette-ligne-produit" />}
        {!rupture && (
          <button className="bouton-plus" aria-label={`Ajouter ${produit.nom} au panier`} onClick={() => ajouterAuPanier(produit)}>
            <i className="bi bi-plus-lg"></i>
          </button>
        )}
      </li>
    )
  }

  const modeMarketplace = true
  const espaceGestion = ESPACES_SANS_PANNEAUX_DESKTOP.includes(espace)

  // Navigation des espaces de gestion (admin / livreur) : menu latéral
  // sur ordinateur, barre d'onglets sur téléphone.
  const navigationGestion = !espaceGestion
    ? []
    : role === 'admin'
      ? [
          { cle: 'admin', icone: 'speedometer2', libelle: 'Tableau de bord', court: 'Tableau' },
          { cle: 'catalogueAdmin', icone: 'box-seam', libelle: 'Catalogue', court: 'Catalogue' },
          { cle: 'fournisseursAdmin', icone: 'geo-alt', libelle: 'Fournisseurs', court: 'Carte' },
          { cle: 'comptesFournisseursAdmin', icone: 'shop', libelle: 'Comptes fournisseurs', court: 'Comptes' },
          { cle: 'entreprisesAdmin', icone: 'building', libelle: 'Entreprises', court: 'Entrepr.' },
          { cle: 'livreursListe', icone: 'people', libelle: 'Livreurs', court: 'Livreurs' }
        ]
      : espace === 'fournisseurEspace'
        ? []
        : [
            { cle: role === 'livreur' ? 'livreur' : 'livreurEnAttente', icone: 'bicycle', libelle: 'Mes courses', court: 'Mes courses' }
          ]

  // Points de la carte : un fournisseur est "actif" (cliquable) dès qu'il a
  // des produits au catalogue sous le même nom, sinon il est "bientôt".
  const nomsCatalogue = {}
  produitsTous.forEach((produit) => {
    nomsCatalogue[produit.fournisseur.trim().toLowerCase()] = produit.fournisseur
  })
  const pointsCarte = fournisseursCarte
    .filter((f) => typeof f.latitude === 'number' && typeof f.longitude === 'number')
    .map((f) => {
      const nomCatalogue = nomsCatalogue[(f.nom || '').trim().toLowerCase()]
      return {
        id: f.id,
        nom: f.nom,
        adresse: f.adresse || '',
        metier: f.metier || '',
        lat: f.latitude,
        lng: f.longitude,
        actif: Boolean(nomCatalogue),
        nomCatalogue: nomCatalogue || null
      }
    })

  function ouvrirFournisseurDepuisCarte(nomCatalogue) {
    if (nomCatalogue) ouvrirFournisseur(nomCatalogue)
  }

  useEffect(() => {
    document.body.classList.toggle('marketplace', modeMarketplace)
    return () => document.body.classList.remove('marketplace')
  }, [modeMarketplace])

  const metiersAVenirAffiches = METIERS_A_VENIR.filter(
    (a) => !metiers.some((m) => retirerAccents(m.nom.toLowerCase()).includes(retirerAccents(a.nom.toLowerCase())))
  )

  return (
    <div className="mise-en-page">
    <div className={`app${role === 'admin' && ['admin', 'catalogueAdmin', 'fournisseursAdmin', 'entreprisesAdmin', 'comptesFournisseursAdmin', 'livreursListe'].includes(espace) ? ' app-large' : ''}${modeMarketplace ? ' app-marketplace' : ''}${espaceGestion ? ' app-gestion' : ''}`}>
      {notification && (
        <div className={`notification notification-${notification.type}`}>
          {notification.message}
        </div>
      )}

      {modeMarketplace && (
        <header className="entete-site">
          <button className="entete-bouton-icone" aria-label="Menu" onClick={() => setAfficherMenu(true)}>
            <i className="bi bi-list"></i>
          </button>

          <button className="entete-logo" aria-label="2C Delivery, retour au catalogue" onClick={ouvrirCatalogue}>
            <span className="entete-logo-accent">2C</span> Delivery
          </button>
          {espaceGestion && (
            <span className="entete-etiquette">{role === 'admin' ? 'Admin' : 'Livreur'}</span>
          )}

          {espace === 'catalogue' && (
            <div className="entete-controles">
              <div className="bascule-accueil bascule-entete" role="tablist" aria-label="Parcourir par">
                <button
                  role="tab"
                  aria-selected={modeAccueil === 'fournisseurs'}
                  className={modeAccueil === 'fournisseurs' ? 'actif' : ''}
                  onClick={() => changerModeAccueil('fournisseurs')}
                >
                  Fournisseurs
                </button>
                <button
                  role="tab"
                  aria-selected={modeAccueil === 'carte'}
                  className={modeAccueil === 'carte' ? 'actif' : ''}
                  onClick={() => changerModeAccueil('carte')}
                >
                  Carte
                </button>
              </div>
              <div className="recherche-entete">
                <i className="bi bi-search"></i>
                <input
                  type="text"
                  aria-label="Rechercher"
                  placeholder="Rechercher un produit"
                  value={recherche}
                  onChange={(e) => changerRechercheEntete(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="entete-actions">
            {!espaceGestion && (
              <button className="entete-panier" aria-label={`Panier, ${nombreArticles} article(s)`} onClick={ouvrirPanier}>
                <i className="bi bi-cart3"></i>
                <span className="entete-libelle-desktop">Panier</span>
                {nombreArticles > 0 && <span className="entete-pastille">{nombreArticles}</span>}
              </button>
            )}
            {espaceGestion && (
              <button className="entete-bouton-icone entete-compte-mobile" aria-label="Mon compte" onClick={() => setAfficherAuth(true)}>
                <i className="bi bi-person-circle"></i>
              </button>
            )}
            {session ? (
              <button className="entete-bouton-contour entete-libelle-desktop" onClick={() => setAfficherAuth(true)}>
                Mon compte
              </button>
            ) : (
              <>
                <button className="entete-bouton-contour entete-libelle-desktop" onClick={() => { setModeAuth('connexion'); setAfficherAuth(true) }}>
                  Connexion
                </button>
                <button className="entete-bouton-accent entete-libelle-desktop" onClick={() => { setModeAuth('inscription'); setAfficherAuth(true) }}>
                  Inscription
                </button>
              </>
            )}
          </div>
        </header>
      )}

      {afficherMenu && (
        <div className="overlay-menu" onClick={() => setAfficherMenu(false)}>
          <aside className="tiroir-menu" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            <button className="tiroir-fermer" aria-label="Fermer le menu" onClick={() => setAfficherMenu(false)}>
              <i className="bi bi-x-lg"></i>
            </button>

            {session ? (
              <div className="tiroir-compte">
                <span className="tiroir-avatar"><i className="bi bi-person"></i></span>
                <span className="tiroir-compte-texte">
                  <strong>{nomUtilisateur || session.user.email}</strong>
                  <small>
                    {role === 'livreur' ? 'Livreur' :
                      role === 'livreur_en_attente' ? 'Livreur (en attente)' :
                      role === 'admin' ? 'Admin' :
                      role === 'entreprise'
                        ? (entreprise && entreprise.statut === 'ok'
                            ? `${entreprise.role_entreprise === 'responsable' ? 'Responsable' : 'Employé'} · ${entreprise.entreprise_nom}`
                            : 'Entreprise')
                        : 'Client'}
                  </small>
                </span>
              </div>
            ) : null}

            <div className="tiroir-boutons">
              {session ? (
                <>
                  <button className="tiroir-bouton tiroir-bouton-principal" onClick={() => { setAfficherMenu(false); setAfficherAuth(true) }}>
                    Mon compte
                  </button>
                  <button className="tiroir-bouton tiroir-bouton-secondaire" onClick={() => { setAfficherMenu(false); deconnexion() }}>
                    Se déconnecter
                  </button>
                </>
              ) : (
                <>
                  <button className="tiroir-bouton tiroir-bouton-principal" onClick={() => { setModeAuth('inscription'); setAfficherMenu(false); setAfficherAuth(true) }}>
                    Inscription
                  </button>
                  <button className="tiroir-bouton tiroir-bouton-secondaire" onClick={() => { setModeAuth('connexion'); setAfficherMenu(false); setAfficherAuth(true) }}>
                    Connexion
                  </button>
                </>
              )}
            </div>

            {!session && (
              <nav className="tiroir-liens-compte" aria-label="Comptes">
                <button onClick={() => { setRoleChoisi('entreprise'); setModeAuth('inscription'); setAfficherMenu(false); setAfficherAuth(true) }}>
                  Créez un compte professionnel
                </button>
                {accesRecrutementLivreur && (
                  <button onClick={() => { setRoleChoisi('livreur'); setModeAuth('inscription'); setAfficherMenu(false); setAfficherAuth(true) }}>
                    Devenez livreur-partenaire
                  </button>
                )}
              </nav>
            )}

            <div className="tiroir-separateur"></div>

            <nav className="tiroir-liens" aria-label="Navigation">
              {espace !== 'catalogue' && (
                <button onClick={() => { setEspace('catalogue'); setAfficherMenu(false) }}>
                  <i className="bi bi-shop"></i> Catalogue
                </button>
              )}
              <button onClick={() => { setEspace('suivi'); setAfficherMenu(false) }}>
                <i className="bi bi-truck"></i> Suivre ma commande
              </button>
              {session && (
                <button onClick={() => { setEspace('mesCommandes'); setCommandeSelectionnee(null); setAfficherMenu(false) }}>
                  <i className="bi bi-box-seam"></i> Mes commandes
                </button>
              )}
              <button onClick={() => { setEspace('faq'); setAfficherMenu(false) }}>
                <i className="bi bi-question-circle"></i> FAQ
              </button>
              <button onClick={() => { setEspace('apropos'); setAfficherMenu(false) }}>
                <i className="bi bi-info-circle"></i> Qui sommes-nous
              </button>
              {compteFournisseur && (
                <button onClick={() => { setEspace('fournisseurEspace'); setAfficherMenu(false) }}>
                  <i className="bi bi-shop"></i> Mon espace fournisseur
                </button>
              )}
              {role === 'entreprise' && entreprise && entreprise.statut === 'ok' && entreprise.role_entreprise === 'responsable' && (
                <button onClick={() => { setEspace('equipe'); setAfficherMenu(false) }}>
                  <i className="bi bi-people"></i> Mon équipe
                </button>
              )}
              {role === 'admin' && (
                <>
                  <div className="tiroir-titre-groupe">Administration</div>
                  <button onClick={() => { setEspace('entreprisesAdmin'); setAfficherMenu(false) }}>
                    <i className="bi bi-building"></i> Gérer les entreprises
                  </button>
                  <button onClick={() => { setEspace('catalogueAdmin'); setAfficherMenu(false) }}>
                    <i className="bi bi-box-seam"></i> Gérer le catalogue
                  </button>
                  <button onClick={() => { setEspace('fournisseursAdmin'); setAfficherMenu(false) }}>
                    <i className="bi bi-geo-alt"></i> Gérer les fournisseurs
                  </button>
                  <button onClick={() => { setEspace('comptesFournisseursAdmin'); setAfficherMenu(false) }}>
                    <i className="bi bi-shop"></i> Comptes fournisseurs
                  </button>
                </>
              )}
            </nav>

            <div className="tiroir-separateur"></div>

            <nav className="tiroir-liens tiroir-liens-legaux" aria-label="Informations légales">
              <button onClick={() => { setEspace('mentionsLegales'); setAfficherMenu(false) }}>
                Mentions légales
              </button>
              <button onClick={() => { setEspace('cgv'); setAfficherMenu(false) }}>
                Conditions générales
              </button>
              <button onClick={() => { setEspace('confidentialite'); setAfficherMenu(false) }}>
                Confidentialité
              </button>
            </nav>

            <div className="tiroir-pied">
              <span className="tiroir-pied-logo"><span>2C</span></span>
              <span>Fournisseurs de plusieurs métiers, livrés où vous en avez besoin.</span>
            </div>
          </aside>
        </div>
      )}

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
                {modeAuth === 'connexion' && (
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
                  {!afficherMotDePasseOublie && (
                    <p className="lien-bascule-auth">
                      Pas encore de compte ?{' '}
                      <button onClick={() => { setModeAuth('inscription'); setErreurConnexion('') }}>Créer un compte</button>
                    </p>
                  )}
                </div>
                )}

                {modeAuth === 'inscription' && (
                <div className="carte-auth">
                  <h3>{invitationEquipe ? 'Rejoindre une équipe' : 'Inscription'}</h3>
                  {invitationEquipe ? (
                    <div className="bandeau-invitation">
                      {invitationEquipe.nom === null ? (
                        <>
                          <strong>Lien d'invitation non valable</strong>
                          <span>Demandez un nouveau lien au responsable de votre entreprise.</span>
                        </>
                      ) : (
                        <>
                          <i className="bi bi-people"></i>
                          <span>
                            {invitationEquipe.nom
                              ? <>Vous êtes invité(e) à rejoindre l'équipe <strong>{invitationEquipe.nom}</strong>.</>
                              : "Vérification de l'invitation..."}
                          </span>
                        </>
                      )}
                      <button
                        className="lien-discret"
                        onClick={() => { setInvitationEquipe(null); setRoleChoisi('client') }}
                      >
                        Ce n'est pas pour moi
                      </button>
                    </div>
                  ) : (
                    <div className="choix-role">
                      {accesInscriptionFournisseur && (
                        <button className={roleChoisi === 'fournisseur' ? 'actif' : ''} onClick={() => setRoleChoisi('fournisseur')}>Fournisseur</button>
                      )}
                      <button className={roleChoisi === 'client' ? 'actif' : ''} onClick={() => setRoleChoisi('client')}>Client</button>
                      <button className={roleChoisi === 'entreprise' ? 'actif' : ''} onClick={() => setRoleChoisi('entreprise')}>Entreprise</button>
                      {accesRecrutementLivreur && (
                        <button className={roleChoisi === 'livreur' ? 'actif' : ''} onClick={() => setRoleChoisi('livreur')}>Livreur</button>
                      )}
                    </div>
                  )}
                  {roleChoisi === 'fournisseur' && (
                    <>
                      <input
                        type="text"
                        placeholder="Nom de votre société (fournisseur)"
                        value={nomFournisseurInscription}
                        onChange={(e) => setNomFournisseurInscription(e.target.value)}
                      />
                      <input
                        type="text"
                        placeholder="Adresse (rue, code postal, ville)"
                        value={adresseFournisseurInscription}
                        onChange={(e) => setAdresseFournisseurInscription(e.target.value)}
                      />
                      <input
                        type="tel"
                        placeholder="Téléphone (facultatif)"
                        value={telephoneFournisseurInscription}
                        onChange={(e) => setTelephoneFournisseurInscription(e.target.value)}
                      />
                    </>
                  )}
                  {roleChoisi === 'entreprise' && !invitationEquipe && (
                    <input
                      type="text"
                      placeholder="Nom de l'entreprise"
                      value={nomEntrepriseInscription}
                      onChange={(e) => setNomEntrepriseInscription(e.target.value)}
                    />
                  )}
                  <input
                    type="text"
                    placeholder={roleChoisi === 'entreprise' || roleChoisi === 'fournisseur' ? 'Votre nom et prénom' : 'Nom'}
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
                  {roleChoisi === 'entreprise' && !invitationEquipe && (
                    <p className="souligne-configurateur">
                      Vous serez le responsable du compte : vous invitez vos employés par un
                      lien, chacun commande avec sa propre session, et vous suivez toutes les
                      commandes de l'équipe. La facture est envoyée par email après chaque livraison.
                    </p>
                  )}
                  {roleChoisi === 'entreprise' && invitationEquipe && invitationEquipe.nom && (
                    <p className="souligne-configurateur">
                      Vous commanderez au nom de l'entreprise, avec votre propre session. Le
                      code de livraison vous sera communiqué à chaque commande.
                    </p>
                  )}
                  {roleChoisi === 'fournisseur' && (
                    <p className="souligne-configurateur">
                      Votre inscription sera examinée par 2C avant validation. Une fois votre compte validé,
                      vous gérez vous-même vos produits, vos photos et votre stock depuis votre espace
                      fournisseur (formulaire ou import de fichier).
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
                  <p className="lien-bascule-auth">
                    Déjà un compte ?{' '}
                    <button onClick={() => { setModeAuth('connexion'); setAfficherMotDePasseOublie(false) }}>Se connecter</button>
                  </p>
                </div>
                )}
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
                    role === 'entreprise'
                      ? (entreprise && entreprise.statut === 'ok'
                          ? (entreprise.role_entreprise === 'responsable' ? 'Responsable d\'entreprise' : 'Employé')
                          : 'Entreprise')
                      : 'Client'
                  }
                </p>
                {role === 'entreprise' && entreprise && entreprise.statut === 'ok' && (
                  <p className="slogan">{entreprise.entreprise_nom}</p>
                )}
                {compteEntrepriseActif() && infosPaiement && (
                  <p className="souligne">
                    Paiement de la livraison :{' '}
                    {infosPaiement.mode_paiement === 'prepaye'
                      ? 'compte prépayé'
                      : infosPaiement.mode_paiement === 'mensuel'
                        ? 'facture mensuelle'
                        : 'carte réservée, débitée à la livraison'}
                    {infosPaiement.mode_paiement === 'prepaye' && infosPaiement.solde_prepaye !== null && infosPaiement.solde_prepaye !== undefined &&
                      ` — solde : ${Number(infosPaiement.solde_prepaye).toFixed(2)} CHF`}
                    {infosPaiement.mode_paiement === 'mensuel' && infosPaiement.encours_mensuel !== null && infosPaiement.encours_mensuel !== undefined &&
                      ` — en cours : ${Number(infosPaiement.encours_mensuel).toFixed(2)} / ${Number(infosPaiement.plafond_mensuel || 0).toFixed(2)} CHF`}
                  </p>
                )}
                {compteEntrepriseActif() && infosPaiement && infosPaiement.mode_paiement === 'prepaye' &&
                  entreprise.role_entreprise === 'responsable' && (
                  <div className="bloc-recharge">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Montant à recharger (20 à 5000 CHF)"
                      value={montantRecharge}
                      onChange={(e) => setMontantRecharge(e.target.value)}
                    />
                    <div className="boutons-montants">
                      {[50, 100, 200].map((m) => (
                        <button key={m} className="bouton-secondaire" onClick={() => setMontantRecharge(String(m))}>
                          {m} CHF
                        </button>
                      ))}
                    </div>
                    <button className="valider" disabled={rechargeEnCours || montantRecharge.trim() === ''} onClick={lancerRecharge}>
                      {rechargeEnCours ? 'Redirection...' : 'Recharger par carte'}
                    </button>
                  </div>
                )}
                {messageAccesEntreprise() && (
                  <p className="erreur-code-livraison">{messageAccesEntreprise()}</p>
                )}
                {invitationEquipe && (
                  <p className="souligne">
                    Vous êtes déjà connecté(e). Pour rejoindre une équipe avec ce lien d'invitation,
                    déconnectez-vous puis créez votre session depuis le lien.
                  </p>
                )}
                {role === 'entreprise' && entreprise && entreprise.statut === 'ok' && entreprise.role_entreprise === 'responsable' && espace !== 'equipe' && (
                  <button className="valider" onClick={() => { setEspace('equipe'); setAfficherAuth(false) }}>
                    Mon équipe
                  </button>
                )}
                {compteFournisseur && espace !== 'fournisseurEspace' && (
                  <button className="valider" onClick={() => { setEspace('fournisseurEspace'); setAfficherAuth(false) }}>
                    Mon espace fournisseur
                  </button>
                )}
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
                {(espace === 'livreur' || espace === 'admin' || espace === 'livreurEnAttente' || espace === 'fournisseurEspace' || espace === 'comptesFournisseursAdmin') && (
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

      <div className="corps-marketplace">
      {modeMarketplace && espace === 'catalogue' && (
        <aside className="menu-lateral" aria-label="Métiers">
          <div className="titre-menu-lateral">Métiers</div>
          {metiers.map((metier) => (
            <button
              key={metier.nom}
              className={`item-lateral${metierFiltre === metier.nom ? ' actif' : ''}`}
              aria-pressed={metierFiltre === metier.nom}
              onClick={() => choisirMetier(metier.nom)}
            >
              <i className={`bi bi-${metier.icone}`}></i>
              <span>{metier.nom}</span>
            </button>
          ))}
          {metiersAVenirAffiches.map((a) => (
            <div key={a.nom} className="item-lateral a-venir">
              <i className={`bi bi-${a.icone}`}></i>
              <span>{a.nom}</span>
              <span className="etiquette-bientot">Bientôt</span>
            </div>
          ))}
          <div className="separateur-lateral"></div>
          <button className="item-lateral" onClick={ouvrirOngletCommandes}>
            <i className="bi bi-box-seam"></i>
            <span>Mes commandes</span>
          </button>
          <button className="item-lateral" onClick={() => setEspace('suivi')}>
            <i className="bi bi-truck"></i>
            <span>Suivre ma commande</span>
          </button>
          <button className="item-lateral" onClick={() => { setRoleChoisi('entreprise'); setModeAuth('inscription'); setAfficherAuth(true) }}>
            <i className="bi bi-building"></i>
            <span>Vous êtes une entreprise ?</span>
          </button>
        </aside>
      )}

      {espaceGestion && navigationGestion.length > 0 && (
        <aside className="menu-lateral" aria-label="Navigation de gestion">
          <div className="titre-menu-lateral">{role === 'admin' ? 'Administration' : 'Espace livreur'}</div>
          {navigationGestion.map((item) => (
            <button
              key={item.cle}
              className={`item-lateral${espace === item.cle ? ' actif' : ''}`}
              onClick={() => setEspace(item.cle)}
            >
              <i className={`bi bi-${item.icone}`}></i>
              <span>{item.libelle}</span>
            </button>
          ))}
          <div className="separateur-lateral"></div>
          <button className="item-lateral" onClick={() => setEspace('catalogue')}>
            <i className="bi bi-shop"></i>
            <span>Voir le site</span>
          </button>
        </aside>
      )}

      <div className={`contenu-marketplace${espace === 'catalogue' ? ' catalogue' : espaceGestion ? ' gestion' : ' etroit'}`}>
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
              <div className="bascule-accueil bascule-contenu" role="tablist" aria-label="Parcourir par">
                <button
                  role="tab"
                  aria-selected={modeAccueil === 'fournisseurs'}
                  className={modeAccueil === 'fournisseurs' ? 'actif' : ''}
                  onClick={() => setModeAccueil('fournisseurs')}
                >
                  Fournisseurs
                </button>
                <button
                  role="tab"
                  aria-selected={modeAccueil === 'carte'}
                  className={modeAccueil === 'carte' ? 'actif' : ''}
                  onClick={() => setModeAccueil('carte')}
                >
                  Carte
                </button>
              </div>

              <input
                type="text"
                className="barre-recherche recherche-contenu"
                placeholder="Rechercher un produit..."
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />

              {rechercheNormalisee === '' && (
                <div className="rangee-metiers">
                  {metiers.map((metier) => (
                    <button
                      key={metier.nom}
                      className={`puce-metier${metierFiltre === metier.nom ? ' actif' : ''}`}
                      aria-pressed={metierFiltre === metier.nom}
                      onClick={() => setMetierFiltre(metierFiltre === metier.nom ? null : metier.nom)}
                    >
                      <span className="rond-metier"><i className={`bi bi-${metier.icone}`}></i></span>
                      <span>{metier.nom}</span>
                    </button>
                  ))}
                  {METIERS_A_VENIR
                    .filter((a) => !metiers.some((m) => retirerAccents(m.nom.toLowerCase()).includes(retirerAccents(a.nom.toLowerCase()))))
                    .map((a) => (
                      <div key={a.nom} className="puce-metier a-venir" aria-label={`${a.nom}, bientôt disponible`}>
                        <span className="rond-metier"><i className={`bi bi-${a.icone}`}></i></span>
                        <span>{a.nom}</span>
                        <span className="etiquette-bientot">Bientôt</span>
                      </div>
                    ))}
                </div>
              )}

              {rechercheNormalisee === '' && modeAccueil === 'fournisseurs' && (
                <>
                  {nombreFournisseursTotal > 1 && (
                    <div className="bandeau-multi">
                      <strong>Plusieurs fournisseurs, un seul livreur</strong>
                      <span>Remplis un seul panier avec les produits de plusieurs fournisseurs.</span>
                      <button onClick={() => setModeAccueil('carte')}>Voir la carte</button>
                    </div>
                  )}
                  <h3 className="titre-accueil">Fournisseurs</h3>
                  {fournisseursListe.length === 0 && (
                    <p className="aucun-resultat">Aucun fournisseur pour ce métier pour le moment.</p>
                  )}
                  <div className="liste-fournisseurs">
                    {fournisseursListe.map((fournisseur) => (
                      <button
                        key={fournisseur.nom}
                        className="carte-fournisseur"
                        onClick={() => ouvrirFournisseur(fournisseur.nom)}
                      >
                        <span className="visuel-fournisseur"><i className="bi bi-shop"></i></span>
                        <span className="texte-fournisseur">
                          <span className="nom-fournisseur">{fournisseur.nom}</span>
                          <span className="detail-fournisseur">{fournisseur.categories.slice(0, 3).join(', ')}</span>
                          <span className="detail-fournisseur">{fournisseur.produits.length} produit(s)</span>
                        </span>
                      </button>
                    ))}
                  </div>

                  <h3 className="titre-accueil">Comment ça marche</h3>
                  <div className="grille-etapes">
                    <div className="etape-accueil">
                      <span className="numero-etape">1</span>
                      <i className="bi bi-cart-check"></i>
                      <strong>Tu commandes</strong>
                      <p>Choisis tes produits, avec ou sans compte.</p>
                    </div>
                    <div className="etape-accueil">
                      <span className="numero-etape">2</span>
                      <i className="bi bi-bicycle"></i>
                      <strong>Un livreur récupère</strong>
                      <p>Un livreur proche récupère ta commande chez le fournisseur.</p>
                    </div>
                    <div className="etape-accueil">
                      <span className="numero-etape">3</span>
                      <i className="bi bi-geo-alt"></i>
                      <strong>Livraison où tu veux</strong>
                      <p>Chantier, atelier ou domicile : elle arrive là où tu en as besoin, avec le suivi de ta commande.</p>
                    </div>
                  </div>
                  <p className="lien-carte" onClick={() => setEspace('apropos')}>
                    En savoir plus sur nous →
                  </p>
                </>
              )}

              {rechercheNormalisee === '' && modeAccueil === 'carte' && (
                <div className="vue-carte">
                  <div className="zone-carte">
                    <CarteFournisseurs points={pointsCarte} surOuvrir={ouvrirFournisseurDepuisCarte} />
                  </div>
                  <div className="liste-carte">
                    <h3 className="titre-accueil">Fournisseurs sur la carte</h3>
                    {pointsCarte.length === 0 && (
                      <p className="souligne">
                        Les fournisseurs partenaires apparaîtront ici dès qu'ils rejoindront 2C Delivery.
                      </p>
                    )}
                    {pointsCarte.map((point) => (
                      <button
                        key={point.id}
                        className={`ligne-carte${point.actif ? '' : ' a-venir'}`}
                        disabled={!point.actif}
                        onClick={() => ouvrirFournisseurDepuisCarte(point.nomCatalogue)}
                      >
                        <span className={`repere-carte petit${point.actif ? ' actif' : ''}`}></span>
                        <span className="texte-ligne-carte">
                          <strong>{point.nom}</strong>
                          <span>{[point.metier, point.adresse].filter(Boolean).join(' · ')}</span>
                        </span>
                        {!point.actif && <span className="etiquette-bientot">Bientôt</span>}
                      </button>
                    ))}
                  </div>
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
                <ul className="liste-lignes">
                  {trierProduits(produitsRecherches, triCatalogue).map((produit) => (
                    ligneProduit(
                      produit,
                      produit.id,
                      `${produit.sousSection}${nombreFournisseursTotal > 1 ? ` · ${produit.fournisseur}` : ''}`
                    )
                  ))}
                </ul>
              )}

              {rechercheNormalisee !== '' && produitsRecherches.length === 0 && (
                <p className="aucun-resultat">Aucun produit trouvé pour cette recherche.</p>
              )}
            </>
          )}

          {vue === 'fournisseur' && fournisseurActif && (() => {
            const categorieCourante = sousSectionsFournisseur.find((ss) => ss.nom === categorieFournisseur) || sousSectionsFournisseur[0]
            const nombreProduitsFournisseur = sousSectionsFournisseur.reduce((somme, ss) => somme + ss.produits.length, 0)
            return (
              <>
                <div className="cover-fournisseur">
                  <button className="retour-rond" aria-label="Retour" onClick={retourAccueil}>
                    <i className="bi bi-chevron-left"></i>
                  </button>
                  <i className="bi bi-shop"></i>
                </div>
                <div className="entete-fournisseur">
                  <h3>{fournisseurActif}</h3>
                  <p className="souligne">
                    {nombreProduitsFournisseur} produit(s) · {sousSectionsFournisseur.length} catégorie(s)
                  </p>
                </div>
                {nombreFournisseursTotal > 1 && (
                  <div className="note-fournisseur">
                    <span>Tu peux ajouter des produits d'autres fournisseurs : tout reste dans le même panier.</span>
                    <button onClick={retourAccueil}>Ajouter d'autres fournisseurs</button>
                  </div>
                )}
                <div className="pastilles-categories" role="tablist" aria-label="Catégories">
                  {sousSectionsFournisseur.map((sousSection) => (
                    <button
                      key={sousSection.nom}
                      role="tab"
                      aria-selected={categorieCourante && categorieCourante.nom === sousSection.nom}
                      className={categorieCourante && categorieCourante.nom === sousSection.nom ? 'actif' : ''}
                      onClick={() => setCategorieFournisseur(sousSection.nom)}
                    >
                      {sousSection.nom}
                    </button>
                  ))}
                </div>
                {categorieCourante && (
                  <>
                    <h4 className="titre-categorie">{categorieCourante.nom}</h4>
                    {categorieCourante.nom === 'Gaines Quadratique' && blocConfigurateur}
                    <ul className="liste-lignes">
                      {trierProduits(categorieCourante.produits, triCatalogue).map((produit) =>
                        ligneProduit(produit, produit.id || produit.nom, null)
                      )}
                    </ul>
                  </>
                )}
              </>
            )
          })()}

          {vue === 'sousSection' && (
            <>
              <p className="retour" onClick={retourDeSousSection}>← Retour</p>
              <div className="fil-ariane">
                <span onClick={retourAccueil}>Accueil</span>
                <span className="separateur-fil">›</span>
                {fournisseurActif && (
                  <>
                    <span onClick={retourDeSousSection}>{fournisseurActif}</span>
                    <span className="separateur-fil">›</span>
                  </>
                )}
                <span className="actif">{sousSectionActive.nom}</span>
              </div>
              <h3>{sousSectionActive.nom}</h3>

              {sousSectionActive.nom === 'Gaines Quadratique' && blocConfigurateur}

              {sousSectionActive.produits.length > 1 && (
                <select className="tri-catalogue" value={triCatalogue} onChange={(e) => setTriCatalogue(e.target.value)}>
                  <option value="defaut">Trier par défaut</option>
                  <option value="prixAsc">Prix croissant</option>
                  <option value="prixDesc">Prix décroissant</option>
                  <option value="alpha">Ordre alphabétique</option>
                </select>
              )}

              <ul className="liste-lignes">
                {trierProduits(sousSectionActive.produits, triCatalogue).map((produit) => (
                  ligneProduit(produit, produit.id || produit.nom, null)
                ))}
              </ul>
            </>
          )}

          {vue === 'panier' && (
            <div className="vue-panier">
              <p className="retour" onClick={retourAccueil}>← Retour</p>
              <h3>Mon panier</h3>
              {groupesPanier.map((groupe) => (
                <div key={groupe.nom} className="groupe-panier">
                  {groupesPanier.length > 1 && (
                    <div className="entete-groupe-panier">
                      <strong>{groupe.nom}</strong>
                      <span className="souligne">
                        Arrêt {groupesPanier.indexOf(groupe) + 1} · {groupe.lignes.reduce((somme, l) => somme + l.produit.quantite, 0)} article(s)
                      </span>
                    </div>
                  )}
                  <ul className="liste-produits">
                    {groupe.lignes.map(({ produit, index }) => (
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
                </div>
              ))}
              {panier.length === 0 && (
                <div className="panier-vide">
                  <i className="bi bi-cart3"></i>
                  <p>Ton panier est vide.</p>
                  <button className="valider" onClick={retourAccueil}>Voir les fournisseurs</button>
                </div>
              )}
              {groupesPanier.length > 1 && (
                <div className="choix-livraison">
                  <h4>Mode de livraison</h4>
                  <div className="option-livraison actif">
                    <span className="radio-livraison"><span></span></span>
                    <div>
                      <strong>Livraison groupée</strong>
                      <p>Un seul livreur passe chez les {groupesPanier.length} fournisseurs, puis chez toi.</p>
                    </div>
                  </div>
                  <div className="option-livraison desactive" aria-disabled="true">
                    <span className="radio-livraison"></span>
                    <div>
                      <strong>Livraisons séparées <span className="etiquette-bientot">Bientôt</span></strong>
                      <p>Un livreur par fournisseur. Tarif à venir.</p>
                    </div>
                  </div>
                </div>
              )}
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
                      readOnly={Boolean(entreprise && entreprise.role_entreprise === 'employe')}
                      onChange={(e) => setTechnicienCommande(e.target.value)}
                    />
                  </>
                )}
                <input
                  type="text"
                  placeholder="Rue et numéro (ex : Rue du Rhône 12)"
                  autoComplete="address-line1"
                  value={rueClient}
                  onChange={(e) => modifierAdresse(e.target.value, codePostalClient, villeClient)}
                />
                <div className="ligne-code-ville">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Code postal"
                    autoComplete="postal-code"
                    maxLength={5}
                    value={codePostalClient}
                    onChange={(e) => modifierAdresse(rueClient, e.target.value.replace(/\D/g, ''), villeClient)}
                  />
                  <input
                    type="text"
                    placeholder="Ville"
                    autoComplete="address-level2"
                    value={villeClient}
                    onChange={(e) => modifierAdresse(rueClient, codePostalClient, e.target.value)}
                  />
                </div>
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
              {compteEntrepriseActif() ? (
                <div className="recap-livraison-entreprise">
                  <p className="souligne">
                    Valeur des produits : {total.toFixed(2)} CHF — facturée séparément par le fournisseur.
                  </p>
                  <p className="total-panier">Livraison 2C : {libelleFraisLivraison()}</p>
                  <p className="souligne">
                    {modePaiementEntreprise() === 'prepaye'
                      ? 'Les frais de livraison sont retirés du solde prépayé de votre entreprise.'
                      : modePaiementEntreprise() === 'mensuel'
                        ? 'Les frais de livraison seront ajoutés à la facture mensuelle de votre entreprise.'
                        : 'Votre carte est réservée maintenant (paiement sécurisé Stripe) et débitée uniquement une fois la livraison effectuée.'}
                    {infosPaiement && Number(infosPaiement.prix_km) > 0 && ' Le prix exact dépend de la distance.'}
                  </p>
                </div>
              ) : (
                <p className="total-panier">Total : {total.toFixed(2)} CHF</p>
              )}
              {messageAccesEntreprise() && (
                <p className="erreur-code-livraison">{messageAccesEntreprise()}</p>
              )}
              {PAIEMENT_EN_LIGNE_ACTIF && !compteEntrepriseActif() && (
                <p className="souligne">Paiement sécurisé en ligne (carte, TWINT) sur la page de notre partenaire Stripe.</p>
              )}
              <button className="valider" disabled={envoiEnCours || Boolean(messageAccesEntreprise())} onClick={validerCommande}>
                {envoiEnCours
                  ? 'Envoi en cours...'
                  : compteEntrepriseActif()
                    ? modePaiementEntreprise() === 'carte'
                      ? 'Réserver la carte et commander'
                      : 'Commander'
                    : PAIEMENT_EN_LIGNE_ACTIF
                      ? 'Payer et commander'
                      : 'Valider la commande'}
              </button>
            </div>
          )}

          {vue === 'commande' && (
            <>
              <h3>Commande confirmée</h3>
              <p>{recapCommande}</p>
              <p className="slogan">Merci, votre commande a bien été enregistrée.</p>
              <p className="souligne">Un email de confirmation vient de t'être envoyé.</p>
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
              {commandeInvite && commandeInvite.numero_suivi && (
                <BlocCodeLivraison numero={commandeInvite.numero_suivi} nom={commandeInvite.nom_client || nomClient} statut="" />
              )}
              <button className="valider" onClick={() => { setEspace('suivi'); setVue('accueil') }}>
                Suivre ma commande
              </button>
              <p className="retour" onClick={retourAccueil}>← Retour à l'accueil</p>
            </>
          )}

          {vue !== 'panier' && vue !== 'commande' && nombreArticles > 0 && (
            <div className="barre-panier au-dessus-onglets" onClick={() => setVue('panier')}>
              <span className="barre-panier-gauche">
                <span className="barre-panier-compte">{nombreArticles}</span>
                Voir le panier
              </span>
              <span>{total.toFixed(2)} CHF</span>
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
                      {estCommandeDunAutre(commande) && commande.technicien && (
                        <>
                          <br />
                          <span className="souligne">Commandé par {commande.technicien}</span>
                        </>
                      )}
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
              {mesCommandes[commandeSelectionnee].mode_paiement && mesCommandes[commandeSelectionnee].mode_paiement !== 'en_ligne' ? (
                <>
                  <p className="souligne">Valeur des produits : {mesCommandes[commandeSelectionnee].total.toFixed(2)} CHF (facturée par le fournisseur)</p>
                  <p className="total-panier">Livraison 2C : {Number(mesCommandes[commandeSelectionnee].frais_livraison || 0).toFixed(2)} CHF</p>
                </>
              ) : (
                <p className="total-panier">{mesCommandes[commandeSelectionnee].total.toFixed(2)} CHF</p>
              )}
              {mesCommandes[commandeSelectionnee].numero_suivi && (
                <p className="souligne">N° de suivi : {mesCommandes[commandeSelectionnee].numero_suivi}</p>
              )}
              {estCommandeDunAutre(mesCommandes[commandeSelectionnee]) && (
                <p className="souligne">
                  <i className="bi bi-info-circle"></i> Commande passée par un membre de votre équipe : il reçoit lui-même le code de livraison et peut l'annuler.
                </p>
              )}
              {statutCommande(mesCommandes[commandeSelectionnee].id) !== 'Annulée' && !estCommandeDunAutre(mesCommandes[commandeSelectionnee]) && (
                <BlocCodeLivraison
                  numero={mesCommandes[commandeSelectionnee].numero_suivi}
                  nom={mesCommandes[commandeSelectionnee].nom_client}
                  statut={statutCommande(mesCommandes[commandeSelectionnee].id)}
                />
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

                  {statutCommande(mesCommandes[commandeSelectionnee].id) === 'À livrer' && !estCommandeDunAutre(mesCommandes[commandeSelectionnee]) && (
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

                  {statutCommande(mesCommandes[commandeSelectionnee].id) === 'Livrée' && !estCommandeDunAutre(mesCommandes[commandeSelectionnee]) && (() => {
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

      {espace === 'equipe' && role === 'entreprise' && entreprise && entreprise.statut === 'ok' && entreprise.role_entreprise === 'responsable' && (
        <PageEquipe
          entreprise={entreprise}
          onRetour={() => setEspace('catalogue')}
          afficherNotification={afficherNotification}
        />
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
              Aucune facture pour l'instant.
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
                    {(() => {
                      if (!entreprise || entreprise.role_entreprise !== 'responsable') return null
                      const commande = mesCommandes.find((c) => String(c.id) === String(facture.commande_id))
                      if (!commande || !commande.technicien || commande.user_id === session.user.id) return null
                      return (
                        <>
                          <br />
                          <span className="souligne">Commande de {commande.technicien}</span>
                        </>
                      )
                    })()}
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
              {statutCommande(commandeInvite.id) !== 'Annulée' && (
                <BlocCodeLivraison
                  numero={commandeInvite.numero_suivi}
                  nom={commandeInvite.nom_client}
                  statut={statutCommande(commandeInvite.id)}
                />
              )}
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

      {espace === 'faq' && (
        <>
          <p className="retour" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>
          <h3>FAQ</h3>

          <div className="carte-faq">
            <strong>Qu'est-ce que 2C Delivery ?</strong>
            <p>
              2C Delivery est une plateforme de livraison ouverte aux professionnels comme aux particuliers. Vous choisissez un fournisseur selon votre besoin, vous commandez directement sur notre site ou notre application, et un livreur récupère votre commande chez le fournisseur pour vous la livrer à l'adresse de votre choix : chantier, atelier ou domicile.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Qui vend les produits ?</strong>
            <p>
              Les produits sont vendus par les fournisseurs présentés sur la plateforme. 2C Delivery met en relation, encaisse le paiement de votre commande et assure la livraison. Le nom du fournisseur est indiqué sur chaque produit et dans votre panier.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Comment passer commande ?</strong>
            <p>
              Depuis la page d'accueil, choisissez un fournisseur (liste ou carte), ajoutez les produits à votre panier, puis validez votre commande en indiquant l'adresse de livraison. Un numéro de suivi et un email de confirmation vous sont envoyés.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Puis-je commander chez plusieurs fournisseurs en une seule fois ?</strong>
            <p>
              Oui. Votre panier peut contenir des produits de plusieurs fournisseurs. Avec la livraison groupée, un seul livreur passe chez chacun d'eux, puis chez vous. La livraison séparée (un livreur par fournisseur) sera proposée prochainement.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Dois-je créer un compte pour commander ?</strong>
            <p>
              Non, vous pouvez commander sans compte : un numéro de suivi vous est remis à la fin de la commande. Un compte vous permet de retrouver automatiquement votre historique dans « Mes commandes ». Les entreprises peuvent ouvrir un compte entreprise : le responsable invite ses employés par un lien, chacun commande avec sa propre session en indiquant le chantier, et le responsable suit toutes les commandes de l'équipe.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Comment suivre ma commande ?</strong>
            <p>
              Utilisez le numéro de suivi reçu à la validation, via le menu ☰ puis « Suivre ma commande ». Si vous avez un compte, la commande figure aussi dans « Mes commandes ».
            </p>
          </div>

          <div className="carte-faq">
            <strong>Comment payer ?</strong>
            <p>
              Le paiement se fait en ligne au moment de la commande (carte bancaire, TWINT ou autre moyen proposé), via notre prestataire de paiement Stripe. C'est le cas pour tous les clients : avec ou sans compte, particuliers comme entreprises.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Puis-je annuler ma commande ?</strong>
            <p>
              Oui, tant qu'elle est au statut « À livrer », depuis l'écran de suivi ou « Mes commandes ». Une fois « En cours », l'annulation n'est plus possible. Une commande payée en ligne et annulée dans ces conditions est remboursée automatiquement par le même moyen de paiement.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Comment se fait la livraison ?</strong>
            <p>
              Un livreur partenaire récupère votre commande chez le fournisseur puis vous la livre à l'adresse indiquée (chantier, atelier, domicile), à scooter, moto, vélo cargo ou en petit utilitaire selon le format de la commande. Ce choix n'est pas fait par le client : il dépend de la disponibilité et du véhicule du livreur. Les délais affichés sont estimatifs.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Comment est sécurisée la remise de ma commande ?</strong>
            <p>
              Chaque commande a un code de livraison à 4 chiffres, visible dans « Suivre ma commande » ou « Mes commandes ». Vous le donnez au livreur uniquement quand vous avez votre commande en main : il doit le saisir pour confirmer la livraison, avec le nom de la personne qui a réceptionné. Ne communiquez ce code à personne d'autre.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Un produit est abîmé, manquant ou ne correspond pas à ma commande. Que faire ?</strong>
            <p>
              Vérifiez la marchandise à la réception et écrivez-nous dès que possible à contact@2cdelivery.ch, avec votre numéro de suivi et, si possible, une photo. Nous traitons la demande avec le fournisseur concerné.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Quels produits et quels fournisseurs trouve-t-on sur la plateforme ?</strong>
            <p>
              Des fournisseurs de plusieurs corps de métier : matériaux, outillage, fixation, fournitures techniques et bien d'autres. Les métiers déjà disponibles sont affichés sur la page d'accueil ; ceux qui arrivent portent la mention « Bientôt ». De nouveaux fournisseurs rejoignent régulièrement la plateforme, et la carte interactive montre ceux déjà présents et ceux à venir.
</p>
          </div>

          <div className="carte-faq">
            <strong>Je suis fournisseur : comment rejoindre la plateforme ?</strong>
            <p>
              Écrivez-nous à contact@2cdelivery.ch en présentant votre activité et vos produits : nous reviendrons vers vous pour étudier votre intégration.
            </p>
          </div>

          <p className="aucun-resultat">Une autre question ? Écrivez-nous à contact@2cdelivery.ch.</p>
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
              <strong>2C Delivery</strong> est une enseigne de livraison pure : nous relions nos clients — artisans, entreprises et particuliers — aux fournisseurs dont ils ont besoin, et nous livrons leur commande directement là où ils se trouvent, sur chantier, à l'atelier ou à domicile. Plus besoin de se déplacer en magasin pour trouver la pièce ou le matériel qui manque.</p>
          </div>

          <div className="carte-faq">
            <strong>Comment ça fonctionne</strong>
            <p>
              Vous choisissez un fournisseur selon votre besoin, vous commandez sur notre site ou notre application, puis un livreur partenaire récupère votre commande chez le fournisseur et vous la livre. Vous pouvez regrouper plusieurs fournisseurs dans un même panier.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Nos fournisseurs</strong>
            <p>
              Les produits sont vendus par des fournisseurs indépendants, que nous sélectionnons. Notre ambition : couvrir de nombreux <strong>corps de métier</strong> et répondre à une clientèle large, des professionnels du bâtiment aux particuliers. Le catalogue s'élargit au fil des fournisseurs qui nous rejoignent ; les métiers à venir sont annoncés sur la page d'accueil.</p>
          </div>

          <div className="carte-faq">
            <strong>Notre livraison</strong>
            <p>
              Nos livreurs se déplacent en scooter, moto, vélo cargo ou petit utilitaire pour aller vite, même en ville ou sur des accès difficiles. Nous intervenons à Genève et dans les environs.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Nous contacter</strong>
            <p>
              Une question, une remarque, un fournisseur à nous proposer ? <strong>contact@2cdelivery.ch</strong>
            </p>
          </div>
        </>
      )}

      {espace === 'mentionsLegales' && (
        <>
          <p className="retour" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>
          <h3>Mentions légales</h3>

          <p className="aucun-resultat">
            La structure juridique de l'entreprise est en cours de finalisation. Les informations marquées <strong>[à compléter]</strong> seront mises à jour dès que la raison sociale sera enregistrée.
          </p>

          <div className="carte-faq">
            <strong>Éditeur du site</strong>
            <p>
              2C Delivery, plateforme de commande et de livraison de produits de plusieurs corps de métier, à destination des professionnels et des particuliers, exploitée par Samrath Chau. Activité exercée en Suisse (Genève).<br />
              Adresse : <strong>[adresse du siège en Suisse à compléter]</strong><br />
              Numéro d'identification des entreprises (IDE) : <strong>[à compléter]</strong><br />
              Numéro de TVA : entreprise non assujettie à la TVA à ce jour (chiffre d'affaires inférieur au seuil légal).<br />
              Email de contact : <strong>contact@2cdelivery.ch</strong>
            </p>
          </div>

          <div className="carte-faq">
            <strong>Responsable de publication</strong>
            <p>
              Samrath Chau.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Nature du service</strong>
            <p>
              2C Delivery agit comme intermédiaire : la plateforme met en relation les clients et des fournisseurs indépendants, encaisse le paiement des commandes et assure leur livraison. Les produits sont vendus par les fournisseurs, dont le nom est indiqué sur chaque produit et dans le panier. Les informations propres à chaque fournisseur (raison sociale, adresse) sont communiquées sur demande à contact@2cdelivery.ch.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Hébergement et prestataires techniques</strong>
            <p>
              Site hébergé par Vercel Inc. (vercel.com).<br />
              Base de données et authentification hébergées par Supabase Inc. (supabase.com).<br />
              Paiements en ligne traités par Stripe (stripe.com) ; aucune donnée de carte bancaire n'est conservée par 2C Delivery.<br />
              Emails de confirmation et factures envoyés via Resend (resend.com).<br />
              Suivi technique des erreurs assuré par Sentry (sentry.io) — aucune donnée de paiement n'y transite.<br />
              Carte interactive : fonds de carte © contributeurs OpenStreetMap (openstreetmap.org), affichage via Leaflet.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Propriété intellectuelle</strong>
            <p>
              Les textes, le logo et les visuels du site sont la propriété de 2C Delivery ou utilisés avec autorisation. Les noms, marques et visuels des fournisseurs restent la propriété de leurs titulaires. Toute reproduction sans accord préalable est interdite.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Responsabilité quant au contenu</strong>
            <p>
              Les descriptions, prix et disponibilités des produits sont fournis avec soin ; 2C Delivery ne peut toutefois garantir l'absence d'erreur ou d'indisponibilité temporaire. Les liens vers des sites tiers sont fournis à titre d'information, sans responsabilité quant à leur contenu.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Droit applicable</strong>
            <p>
              Le présent site est soumis au droit suisse. For juridique : Genève, sous réserve des règles impératives de protection des consommateurs.
            </p>
          </div>
        </>
      )}

      {espace === 'cgv' && (
        <>
          <p className="retour" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>
          <h3>Conditions générales</h3>

          <p className="aucun-resultat">
            Version provisoire, mise à jour pour le fonctionnement en plateforme (fournisseurs, livraison, encaissement). Elle doit être validée par un professionnel du droit suisse avant la mise en ligne définitive du service — notamment les points marqués <strong>[à valider]</strong> ou <strong>[à compléter]</strong>.
          </p>

          <div className="carte-faq">
            <strong>1. Qui sommes-nous, rôle de 2C Delivery</strong>
            <p>
              2C Delivery est une plateforme en ligne (site et application) qui permet aux clients de commander des produits auprès de fournisseurs indépendants et de se les faire livrer (chantier, atelier, domicile), à Genève et dans les environs. Les présentes conditions s'appliquent à toute commande passée sur la plateforme, par un particulier comme par une entreprise.
            </p>
            <p>
              2C Delivery agit comme intermédiaire. Pour chaque commande, deux relations coexistent : un contrat de vente entre le client et le fournisseur concerné, pour les produits ; un contrat de prestation entre le client et 2C Delivery, pour la mise en relation, l'encaissement et la livraison. <strong>[Qualification juridique exacte à valider]</strong>
            </p>
          </div>

          <div className="carte-faq">
            <strong>2. Commande</strong>
            <p>
              La commande se fait depuis le catalogue, avec ou sans compte. Le panier peut contenir des produits de plusieurs fournisseurs. Le contrat est conclu lorsque la commande est confirmée ; un numéro de suivi et un email de confirmation sont fournis à la validation. Le client est responsable de l'exactitude de l'adresse de livraison et des informations de contact qu'il indique.
            </p>
            <p>
              Si un produit s'avère indisponible après la commande, le client en est informé et le montant correspondant lui est remboursé ; la commande peut être maintenue pour les autres produits ou annulée.
            </p>
          </div>

          <div className="carte-faq">
            <strong>3. Prix</strong>
            <p>
              Les prix sont indiqués en francs suisses (CHF). Sauf mention contraire, ils incluent la livraison en mode groupé. Le prix applicable est celui affiché au moment de la validation de la commande. 2C Delivery n'étant pas assujettie à la TVA à ce jour, les prix sont affichés sans TVA. <strong>[Traitement de la TVA des fournisseurs à valider]</strong>
            </p>
            <p>
              Un mode de livraison séparée (un livreur par fournisseur) pourra être proposé ultérieurement, avec un tarif propre, qui sera indiqué avant la validation de la commande.
            </p>
          </div>

          <div className="carte-faq">
            <strong>4. Paiement</strong>
            <p>
              Pour tous les clients (avec ou sans compte, particuliers comme entreprises), le paiement s'effectue en ligne au moment de la commande (carte bancaire, TWINT ou autre moyen proposé), via notre prestataire de paiement Stripe. 2C Delivery ne conserve aucune donnée de carte bancaire.
            </p>
            <p>
              2C Delivery encaisse le paiement de la commande, y compris le prix des produits, pour le compte du fournisseur concerné, puis le lui reverse. Le paiement effectué auprès de 2C Delivery libère le client envers le fournisseur. <strong>[Mandat d'encaissement à valider]</strong>
            </p>
          </div>

          <div className="carte-faq">
            <strong>5. Livraison</strong>
            <p>
              Un livreur partenaire récupère la commande chez le ou les fournisseurs, puis la livre à l'adresse indiquée. Le moyen de transport (scooter, moto, vélo cargo, petit utilitaire) dépend du livreur assigné et du format de la commande ; il n'est pas choisi par le client.
            </p>
            <p>
              Les créneaux affichés sont estimatifs et dépendent de la préparation chez le fournisseur et du nombre de courses en attente. Ils ne constituent pas un engagement horaire ferme.
            </p>
            <p>
              Pour sécuriser la remise, un code de livraison à 4 chiffres est attribué à chaque commande et affiché dans l'espace de suivi du client. Le livreur confirme la livraison en saisissant ce code ; la livraison est alors réputée effectuée à la personne qui l'a communiqué. Le client ne doit pas transmettre ce code avant d'avoir sa commande en main. Le client veille à être joignable et à permettre la remise de la commande ; en cas d'impossibilité de livrer par sa faute, la livraison peut être facturée de nouveau ou la commande considérée comme remise.
            </p>
          </div>

          <div className="carte-faq">
            <strong>6. Annulation et pièces sur mesure</strong>
            <p>
              Le droit suisse ne prévoit pas de droit de rétractation légal pour les achats effectués en ligne. 2C Delivery permet toutefois d'annuler une commande tant qu'elle est au statut « À livrer ». Une commande payée en ligne et annulée dans ces conditions est remboursée automatiquement par le même moyen de paiement ; le délai de réception dépend de la banque ou de l'émetteur de la carte.
            </p>
            <p>
              Une fois la commande « En cours », l'annulation n'est plus possible. Les pièces découpées ou configurées sur mesure ne peuvent être ni annulées une fois la commande en cours, ni reprises.
            </p>
          </div>

          <div className="carte-faq">
            <strong>7. Réclamations, garantie et défauts</strong>
            <p>
              Le client vérifie la marchandise à la remise et signale tout défaut, dommage, manque ou erreur dès sa découverte, par email à contact@2cdelivery.ch, avec son numéro de suivi et, si possible, une photo. 2C Delivery transmet la demande au fournisseur concerné et assure le suivi avec le client.
            </p>
            <p>
              Les droits de garantie portant sur le produit lui-même (défaut, non-conformité) s'exercent à l'égard du fournisseur, vendeur, selon la garantie légale suisse. Les dommages survenus pendant le transport et les erreurs de livraison relèvent de 2C Delivery. <strong>[Répartition des responsabilités et limitations éventuelles pour la clientèle professionnelle à valider avec un juriste]</strong>
            </p>
          </div>

          <div className="carte-faq">
            <strong>8. Responsabilité</strong>
            <p>
              2C Delivery met tout en œuvre pour que la plateforme fonctionne et que les commandes soient livrées dans les meilleurs délais, sans garantir un horaire précis. 2C Delivery n'est pas responsable de la qualité, de la conformité ou de la disponibilité des produits vendus par les fournisseurs, sous réserve de ses propres obligations de mise en relation, d'encaissement et de livraison.
            </p>
            <p>
              Sa responsabilité ne saurait être engagée en cas de retard dû à des circonstances hors de son contrôle (météo, trafic, indisponibilité temporaire d'un livreur ou d'un fournisseur), dans les limites permises par le droit suisse.
            </p>
          </div>

          <div className="carte-faq">
            <strong>9. Compte et utilisation de la plateforme</strong>
            <p>
              Le client garantit l'exactitude des informations de son compte et protège ses identifiants. Les comptes entreprise sont placés sous la responsabilité de l'entreprise, qui répond des commandes passées par ses collaborateurs. Toute utilisation abusive ou frauduleuse de la plateforme peut entraîner la suspension du compte.
            </p>
          </div>

          <div className="carte-faq">
            <strong>10. Données personnelles</strong>
            <p>
              Le traitement des données, y compris leur transmission aux fournisseurs et aux livreurs pour l'exécution de la commande, est décrit dans la politique de confidentialité.
            </p>
          </div>

          <div className="carte-faq">
            <strong>11. Modification des conditions</strong>
            <p>
              2C Delivery peut modifier les présentes conditions ; la version applicable à une commande est celle en vigueur au moment de sa validation.
            </p>
          </div>

          <div className="carte-faq">
            <strong>12. Droit applicable et litiges</strong>
            <p>
              Les présentes conditions sont soumises au droit suisse. En cas de litige, les parties cherchent d'abord une solution amiable ; à défaut, les tribunaux compétents sont ceux du lieu prévu par la loi ou, pour les clients professionnels, ceux de Genève.
            </p>
          </div>
        </>
      )}

      {espace === 'confidentialite' && (
        <>
          <p className="retour" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>
          <h3>Politique de confidentialité</h3>

          <p className="aucun-resultat">
            Cette politique est rédigée selon la loi fédérale suisse sur la protection des données (LPD) et tient compte du fonctionnement en plateforme. Version provisoire, à faire valider par un professionnel.
          </p>

          <div className="carte-faq">
            <strong>Responsable du traitement</strong>
            <p>
              2C Delivery, exploité par Samrath Chau — <strong>contact@2cdelivery.ch</strong>. Pour les données nécessaires à la préparation d'une commande, le fournisseur concerné traite aussi ces données pour son propre compte, selon sa propre politique.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Données collectées</strong>
            <p>
              Nom, adresse de livraison, numéro de téléphone, email, contenu et historique des commandes ; pour les entreprises, nom de la société, chantier et collaborateur concerné. Pour les comptes créés, le mot de passe est stocké de façon sécurisée (haché) via Supabase Auth et n'est jamais visible par 2C Delivery. Les données de carte bancaire sont saisies directement chez Stripe et ne sont jamais enregistrées par 2C Delivery.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Pourquoi ces données</strong>
            <p>
              Uniquement pour traiter la commande avec les fournisseurs, la faire livrer, encaisser le paiement et reverser les fournisseurs, vous contacter si besoin et envoyer la confirmation de commande.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Qui y a accès</strong>
            <p>
              L'équipe 2C Delivery (administration) ; le ou les fournisseurs concernés, pour les informations nécessaires à la préparation et au retrait de la commande (contenu de la commande, nom du client ou de l'entreprise) ; et le livreur assigné, uniquement le temps nécessaire à la livraison (adresse, téléphone, contenu de la commande).
            </p>
          </div>

          <div className="carte-faq">
            <strong>Prestataires techniques et transfert à l'étranger</strong>
            <p>
              Supabase (base de données), Vercel (hébergement du site), Stripe (paiement en ligne), Resend (envoi des emails) et Sentry (détection d'erreurs techniques). Ces prestataires peuvent traiter des données hors de Suisse, par exemple dans l'Union européenne ou aux États-Unis, avec des garanties contractuelles appropriées. <strong>[Région d'hébergement exacte à confirmer]</strong>
            </p>
          </div>

          <div className="carte-faq">
            <strong>Carte interactive</strong>
            <p>
              L'affichage de la carte des fournisseurs charge des éléments auprès de services tiers (fonds de carte OpenStreetMap, bibliothèque Leaflet), qui reçoivent à cette occasion votre adresse IP, comme pour toute page web. Aucune donnée de compte ne leur est transmise.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Durée de conservation</strong>
            <p>
              Les commandes et factures sont conservées 10 ans, conformément aux obligations comptables suisses. Les autres données du compte sont conservées tant que le compte existe, puis supprimées sur demande.
            </p>
          </div>

          <div className="carte-faq">
            <strong>Vos droits</strong>
            <p>
              Vous pouvez demander l'accès, la rectification ou la suppression de vos données, ou vous opposer à leur traitement, en écrivant à <strong>contact@2cdelivery.ch</strong>. Vous pouvez aussi vous adresser au Préposé fédéral à la protection des données et à la transparence (PFPDT).
            </p>
          </div>

          <div className="carte-faq">
            <strong>Cookies et stockage local</strong>
            <p>
              Le site n'utilise pas de cookies publicitaires. Il utilise uniquement des éléments techniques nécessaires au fonctionnement : connexion, mémorisation de votre panier et de vos commandes récentes dans votre navigateur, et l'outil de suivi d'erreurs Sentry.
            </p>
          </div>
        </>
      )}

      {espace === 'livreurEnAttente' && role === 'livreur_en_attente' && (
        <>
          <p className="retour retour-gestion" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>

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
          <p className="retour retour-gestion" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>

          <button
            className={`bouton-disponibilite ${disponibleLivreur ? 'actif' : ''}`}
            disabled={changementDisponibiliteEnCours}
            onClick={() => changerDisponibilite(!disponibleLivreur)}
          >
            <i className={`bi ${disponibleLivreur ? 'bi-toggle-on' : 'bi-toggle-off'}`}></i>
            {disponibleLivreur ? 'Disponible' : 'Indisponible'}
          </button>

          <ActivationNotifications notifier={afficherNotification} sujet="des nouvelles courses à livrer" />

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
                    <span>{course.client}<br /><span className="souligne">{course.adresse} — {course.statut}</span>{course.created_at && <><br /><span className="souligne"><i className="bi bi-clock"></i> {dateHeureCourse(course)}</span></>}</span>
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
                    <span>{course.client}<br /><span className="souligne">{course.adresse} — {course.statut}</span>{course.created_at && <><br /><span className="souligne"><i className="bi bi-clock"></i> {dateHeureCourse(course)}</span></>}</span>
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
                        <span>{course.client}<br /><span className="souligne">{course.adresse} — {course.statut}</span>{course.created_at && <><br /><span className="souligne"><i className="bi bi-clock"></i> {dateHeureCourse(course)}</span></>}</span>
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
              <p className="retour" onClick={() => { setCourseSelectionnee(null); setFormulaireLivraisonOuvert(false); setErreurCodeLivraison('') }}>← Retour</p>
              <h3>{courses[courseSelectionnee].client}</h3>
              <p className="slogan">{courses[courseSelectionnee].adresse}</p>
              {courses[courseSelectionnee].created_at && (
                <p className="souligne"><i className="bi bi-clock"></i> Commande du {dateHeureCourse(courses[courseSelectionnee])}</p>
              )}
              {(() => {
                const course = courses[courseSelectionnee]
                const retraits = fournisseursDeLaCourse(course, produitsTous, fournisseursCarte)
                const adressesRetrait = retraits.filter((r) => r.adresse).map((r) => r.adresse)
                return (
                  <div className="tournee-livreur">
                    <h4>Tournée</h4>
                    <ol>
                      {retraits.map((retrait) => (
                        <li key={retrait.nom}>
                          <span className="tournee-pastille tournee-retrait"><i className="bi bi-box-seam"></i></span>
                          <span className="tournee-texte">
                            <strong>Retrait chez {retrait.nom}</strong>
                            <small>{retrait.adresse || 'Adresse du fournisseur non renseignée'}</small>
                          </span>
                          {retrait.adresse && (
                            <a
                              className="tournee-lien"
                              href={lienItineraire(retrait.adresse)}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Itinéraire vers ${retrait.nom}`}
                            >
                              <i className="bi bi-signpost-2"></i> Itinéraire
                            </a>
                          )}
                        </li>
                      ))}
                      <li>
                        <span className="tournee-pastille tournee-livraison"><i className="bi bi-geo-alt"></i></span>
                        <span className="tournee-texte">
                          <strong>Livraison chez {course.client}</strong>
                          <small>{course.adresse}</small>
                        </span>
                        <a
                          className="tournee-lien"
                          href={lienItineraire(course.adresse)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Itinéraire vers l'adresse de livraison"
                        >
                          <i className="bi bi-signpost-2"></i> Itinéraire
                        </a>
                      </li>
                    </ol>
                    {adressesRetrait.length > 0 && (
                      <a
                        className="bouton-petit tournee-complete"
                        href={lienItineraire(course.adresse, adressesRetrait)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <i className="bi bi-signpost-split"></i> Itinéraire complet de la tournée
                      </a>
                    )}
                  </div>
                )
              })()}
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
                priseEnChargeAConfirmer === courses[courseSelectionnee].id ? (
                  <div className="carte-auth bloc-validation-livraison">
                    <h3>Valider la prise en charge ?</h3>
                    <p className="souligne">
                      Vous vous engagez à récupérer cette commande chez les fournisseurs puis à la livrer à{' '}
                      {courses[courseSelectionnee].adresse}.
                    </p>
                    <button className="valider" onClick={() => prendreEnCharge(courseSelectionnee)}>
                      Oui, je prends cette commande
                    </button>
                    <p className="retour" onClick={() => setPriseEnChargeAConfirmer(null)}>
                      Annuler
                    </p>
                  </div>
                ) : (
                  <button
                    className="valider"
                    onClick={() => setPriseEnChargeAConfirmer(courses[courseSelectionnee].id)}
                  >
                    Prendre en charge
                  </button>
                )
              )}

              {courses[courseSelectionnee].livreur_id === session.user.id &&
                courses[courseSelectionnee].statut !== 'En cours' && (
                  <button
                    className="valider"
                    disabled={courses[courseSelectionnee].statut === 'Livrée'}
                    onClick={() => avancerStatut(courseSelectionnee)}
                  >
                    {courses[courseSelectionnee].statut === 'Livrée' ? 'Course livrée' : 'Commande récupérée : démarrer la livraison'}
                  </button>
                )}

              {courses[courseSelectionnee].livreur_id === session.user.id &&
                courses[courseSelectionnee].statut === 'En cours' && (
                  formulaireLivraisonOuvert ? (
                    <div className="carte-auth bloc-validation-livraison">
                      <h3>Valider la livraison</h3>
                      <p className="souligne">
                        Demandez au client son code de livraison à 4 chiffres, uniquement quand il a sa commande en main.
                      </p>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={4}
                        className="champ-code-livraison"
                        placeholder="Code à 4 chiffres"
                        value={codeSaisi}
                        onChange={(e) => setCodeSaisi(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      />
                      <input
                        type="text"
                        placeholder="Reçu par (nom de la personne)"
                        value={recuParSaisi}
                        onChange={(e) => setRecuParSaisi(e.target.value)}
                      />
                      {erreurCodeLivraison && <p className="erreur-code-livraison">{erreurCodeLivraison}</p>}
                      <button
                        className="valider"
                        disabled={validationLivraisonEnCours}
                        onClick={() => validerLivraison(courseSelectionnee)}
                      >
                        {validationLivraisonEnCours ? 'Vérification...' : 'Confirmer la livraison'}
                      </button>
                      <p
                        className="retour"
                        onClick={() => { setFormulaireLivraisonOuvert(false); setErreurCodeLivraison(''); setCodeSaisi('') }}
                      >
                        Annuler
                      </p>
                    </div>
                  ) : (
                    <button className="valider" onClick={() => setFormulaireLivraisonOuvert(true)}>
                      Valider la livraison
                    </button>
                  )
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
          <p className="retour retour-gestion" onClick={() => setEspace('catalogue')}>← Retour au catalogue</p>
          <div className="entete-page">
            <h2>Tableau de bord</h2>
            <p className="souligne">Vue d'ensemble des commandes et de l'activité.</p>
          </div>

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

          <div className="grille-kpi">
            <div className="kpi-carte">
              <span className="kpi-libelle">Commandes</span>
              <span className="kpi-valeur">{statsAdmin.total}</span>
            </div>
            <div className="kpi-carte">
              <span className="kpi-libelle">Actives</span>
              <span className="kpi-valeur">{statsAdmin.actives}</span>
            </div>
            <div className="kpi-carte">
              <span className="kpi-libelle">Livrées</span>
              <span className="kpi-valeur">{statsAdmin.livrees}</span>
            </div>
            <div className="kpi-carte">
              <span className="kpi-libelle">Annulées</span>
              <span className="kpi-valeur">{statsAdmin.annulees}</span>
            </div>
            <div className="kpi-carte kpi-accent">
              <span className="kpi-libelle">Chiffre d'affaires</span>
              <span className="kpi-valeur">{statsAdmin.chiffreAffaires.toFixed(2)} <small>CHF</small></span>
              <span className="kpi-note">hors annulées</span>
            </div>
          </div>

          <div className="grille-cartes-admin">
          <section className="carte-admin">
          <h4>7 derniers jours</h4>
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
          </section>

          <section className="carte-admin">
          <h4>Produits les plus commandés</h4>
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
          </section>

          <section className="carte-admin">
          <h4>Meilleures adresses (chiffre d'affaires)</h4>
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
          </section>
          </div>

          <section className="carte-admin carte-commandes">
          <h4>Commandes</h4>
          <input
            type="text"
            className="barre-recherche"
            placeholder="Rechercher un client, une adresse, un produit, une date (ex. 05/10)..."
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
                    <th>Date</th>
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
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {dateCommandeAdmin(course)}
                        {heureCommandeAdmin(course) && <><br /><span className="souligne">{heureCommandeAdmin(course)}</span></>}
                      </td>
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
          </section>
        </>
      )}

      {espace === 'livreursListe' && role === 'admin' && (
        <>
          <p className="retour retour-gestion" onClick={() => setEspace('admin')}>← Retour au tableau de bord</p>
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

      {espace === 'entreprisesAdmin' && role === 'admin' && (
        <>
          <p className="retour retour-gestion" onClick={() => setEspace('admin')}>← Retour au tableau de bord</p>
          <h3>Entreprises</h3>
          <p className="souligne">
            Validez chaque entreprise après vérification et choisissez le mode de paiement convenu.
            Les entreprises ne paient sur le site que la livraison (les produits sont facturés par le
            fournisseur) : carte réservée puis débitée à la livraison, solde prépayé, ou facturation
            mensuelle avec plafond.
          </p>

          <div className="carte-auth carte-tarif-livraison">
            <h3>Tarif de livraison (entreprises)</h3>
            <label className="champ-admin-entreprise">
              <span>Forfait par commande (CHF)</span>
              <input
                type="text"
                inputMode="decimal"
                value={tarifAdmin.forfait}
                onChange={(e) => setTarifAdmin({ ...tarifAdmin, forfait: e.target.value })}
              />
            </label>
            <label className="champ-admin-entreprise">
              <span>Kilomètres inclus dans le forfait</span>
              <input
                type="text"
                inputMode="decimal"
                value={tarifAdmin.km_inclus}
                onChange={(e) => setTarifAdmin({ ...tarifAdmin, km_inclus: e.target.value })}
              />
            </label>
            <label className="champ-admin-entreprise">
              <span>Prix par km supplémentaire (CHF) — 0 = prix fixe</span>
              <input
                type="text"
                inputMode="decimal"
                value={tarifAdmin.prix_km}
                onChange={(e) => setTarifAdmin({ ...tarifAdmin, prix_km: e.target.value })}
              />
            </label>
            <label className="champ-admin-entreprise">
              <span>Délai de paiement des factures mensuelles (jours)</span>
              <input
                type="text"
                inputMode="numeric"
                value={tarifAdmin.delai_paiement_jours}
                onChange={(e) => setTarifAdmin({ ...tarifAdmin, delai_paiement_jours: e.target.value })}
              />
            </label>
            <p className="souligne">
              Prix = forfait + (km au-delà des km inclus) × prix par km, arrondi à 5 centimes. Tant que le
              prix par km est à 0, le prix reste fixe. La distance est estimée du ou des fournisseurs
              jusqu'à l'adresse de livraison.
            </p>
            <button className="valider" onClick={enregistrerTarifAdmin}>Enregistrer le tarif</button>
          </div>
          {entreprisesAdmin.length === 0 ? (
            <p className="aucun-resultat">Aucune entreprise inscrite pour le moment.</p>
          ) : (
            <div className="liste-entreprises-admin">
              {entreprisesAdmin.map((e) => (
                <CarteEntrepriseAdmin
                  key={e.id}
                  entreprise={e}
                  fournisseursDisponibles={[
                    ...new Set([
                      ...fournisseursCarte.map((f) => f.nom),
                      ...produitsTous.map((p) => p.fournisseur)
                    ].filter(Boolean))
                  ]}
                  onEnregistrer={enregistrerEntrepriseAdmin}
                  solde={soldesAdmin[e.id] ? soldesAdmin[e.id].solde_prepaye : 0}
                  encours={soldesAdmin[e.id] ? soldesAdmin[e.id].encours_mensuel : 0}
                  onCrediter={crediterPrepayeAdmin}
                  onApercuFacture={apercuFactureMensuelle}
                  onCreerFacture={creerFactureMensuelle}
                  onListerFactures={listerFacturesMensuelles}
                  onRenvoyerFacture={renvoyerFactureMensuelle}
                />
              ))}
            </div>
          )}
        </>
      )}

      {espace === 'comptesFournisseursAdmin' && role === 'admin' && (
        <>
          <p className="retour retour-gestion" onClick={() => setEspace('admin')}>← Retour au tableau de bord</p>
          <AdminComptesFournisseurs notifier={afficherNotification} onCatalogueChange={chargerProduits} onCarteChange={chargerFournisseursCarte} />
        </>
      )}

      {espace === 'fournisseurEspace' && compteFournisseur && (
        <EspaceFournisseur
          compte={compteFournisseur}
          onRetour={() => { setOuvrirAuDemarrage(null); setEspace('catalogue') }}
          notifier={afficherNotification}
          onCatalogueChange={chargerProduits}
          ongletInitial={ouvrirAuDemarrage}
        />
      )}

      {espace === 'fournisseursAdmin' && role === 'admin' && (
        <>
          <p className="retour retour-gestion" onClick={() => setEspace('admin')}>← Retour au tableau de bord</p>
          <h3>Gérer les fournisseurs</h3>
          <p className="souligne">
            Les fournisseurs ajoutés ici apparaissent sur la carte. Ils deviennent cliquables dès que des
            produits du catalogue portent exactement le même nom de fournisseur.
          </p>

          <div className="carte-auth">
            <h3>Ajouter un fournisseur</h3>
            <input
              type="text"
              placeholder="Nom du fournisseur (ex: Ventilation Léman)"
              value={nouveauNomFournisseur}
              onChange={(e) => setNouveauNomFournisseur(e.target.value)}
            />
            <input
              type="text"
              placeholder="Adresse complète (rue, code postal, ville)"
              value={nouvelleAdresseFournisseur}
              onChange={(e) => setNouvelleAdresseFournisseur(e.target.value)}
            />
            <input
              type="text"
              list="liste-metiers-admin"
              placeholder="Métier (ex: Ventilation, Plomberie)"
              value={nouveauMetierFournisseur}
              onChange={(e) => setNouveauMetierFournisseur(e.target.value)}
            />
            <datalist id="liste-metiers-admin">
              {[...new Set([...metiers.map((m) => m.nom), ...METIERS_A_VENIR.map((m) => m.nom)])].map((nom) => (
                <option key={nom} value={nom} />
              ))}
            </datalist>
            {erreurFournisseurAdmin && <p className="souligne">{erreurFournisseurAdmin}</p>}
            <button className="valider" disabled={envoiFournisseurEnCours} onClick={ajouterFournisseurCarte}>
              {envoiFournisseurEnCours ? 'Localisation en cours...' : 'Ajouter à la carte'}
            </button>
          </div>

          {fournisseursCarte.length > 0 ? (
            <div className="tableau-scroll">
              <table className="tableau-admin">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Adresse</th>
                    <th>Métier</th>
                    <th>Sur le site</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {fournisseursCarte.map((f) => (
                    <tr key={f.id}>
                      <td>{f.nom}</td>
                      <td>{f.adresse}</td>
                      <td>{f.metier}</td>
                      <td>{nomsCatalogue[(f.nom || '').trim().toLowerCase()] ? 'Oui' : 'Bientôt'}</td>
                      <td>
                        <button onClick={() => supprimerFournisseurCarte(f.id)} title="Retirer de la carte">
                          <i className="bi bi-trash"></i>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="aucun-resultat">Aucun fournisseur sur la carte pour le moment.</p>
          )}
        </>
      )}

      {espace === 'catalogueAdmin' && role === 'admin' && (
        <>
          <p className="retour retour-gestion" onClick={() => setEspace('admin')}>← Retour au tableau de bord</p>
          <h3>Gérer le catalogue</h3>

          <div className="carte-auth">
            <h3>Ajouter un produit</h3>
            <input
              type="text"
              placeholder="Fournisseur (facultatif, ex: Ventilation Léman)"
              value={nouveauFournisseur}
              onChange={(e) => setNouveauFournisseur(e.target.value)}
            />
            <input
              type="text"
              list="liste-metiers-admin"
              placeholder="Métier (ex: Ventilation, Plomberie, Électricité)"
              value={nouveauMetierProduit}
              onChange={(e) => setNouveauMetierProduit(e.target.value)}
            />
            <datalist id="liste-metiers-admin">
              {[...new Set([...metiers.map((m) => m.nom), ...METIERS_A_VENIR.map((m) => m.nom)])].map((nom) => (
                <option key={nom} value={nom} />
              ))}
            </datalist>
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
                    <th>Fournisseur</th>
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
                              placeholder="Fournisseur"
                              value={editionFournisseur}
                              onChange={(e) => setEditionFournisseur(e.target.value)}
                            />
                          </td>
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
                          <td>{produit.fournisseur || <span className="souligne">{FOURNISSEUR_PAR_DEFAUT}</span>}</td>
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
      <div className="espace-onglets" aria-hidden="true"></div>
      <nav className="barre-onglets" aria-label="Navigation principale">
        {espaceGestion ? (
          <>
            {navigationGestion.map((item) => (
              <button
                key={item.cle}
                className={espace === item.cle ? 'actif' : ''}
                onClick={() => setEspace(item.cle)}
              >
                <i className={`bi bi-${item.icone}`}></i>
                <span>{item.court}</span>
              </button>
            ))}
            <button onClick={() => setEspace('catalogue')}>
              <i className="bi bi-shop"></i>
              <span>Le site</span>
            </button>
          </>
        ) : (
          <>
            <button
              className={espace === 'catalogue' && vue !== 'panier' ? 'actif' : ''}
              onClick={() => { setEspace('catalogue'); retourAccueil(); window.scrollTo({ top: 0 }) }}
            >
              <i className="bi bi-house"></i>
              <span>Accueil</span>
            </button>
            <button
              className={espace === 'catalogue' && vue === 'panier' ? 'actif' : ''}
              onClick={() => { setEspace('catalogue'); setVue('panier') }}
            >
              <span className="icone-onglet">
                <i className="bi bi-cart3"></i>
                {nombreArticles > 0 && <span className="pastille-onglet">{nombreArticles}</span>}
              </span>
              <span>Panier</span>
            </button>
            <button
              className={['mesCommandes', 'mesFactures', 'suivi'].includes(espace) ? 'actif' : ''}
              onClick={ouvrirOngletCommandes}
            >
              <i className="bi bi-box-seam"></i>
              <span>Commandes</span>
            </button>
            <button onClick={() => { setModeAuth('connexion'); setAfficherAuth(true) }}>
              <i className={`bi ${session ? 'bi-person-check-fill' : 'bi-person'}`}></i>
              <span>Compte</span>
            </button>
          </>
        )}
      </nav>
      </div>
      </div>
    </div>

    </div>
  )
}

export default App
