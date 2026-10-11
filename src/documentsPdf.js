// =========================================================
// Documents PDF de 2C Delivery : factures et bon de livraison
// =========================================================
// Toute la mise en page des PDF est ici (une seule charte pour tous les
// documents). Format A4, marges de 18 mm, teintes sobres, orange 2C en touches.
import { jsPDF } from 'jspdf'
import { LOGO_2C_PNG } from './logo2cPdf'

// Informations d'entreprise affichées sur les documents. "nom" est le vrai nom.
// Le reste (adresse, contact, TVA, IBAN) est en attente : "donneesTest" à true
// fait apparaître un petit avertissement en pied de page tant que ce n'est pas
// finalisé. Une fois les vraies infos en main, compléter les champs ci-dessous
// et repasser "donneesTest" à false.
export const INFOS_ENTREPRISE = {
  nom: '2C',
  adresse: "Adresse de l'entreprise — à compléter",
  contact: 'contact@2cdelivery.ch • Téléphone à compléter',
  tvaNumero: null, // ex: 'CHE-123.456.789 TVA'
  tvaTaux: null,   // ex: 8.1 (en %), une fois le statut TVA connu
  iban: null,      // ex: 'CH00 0000 0000 0000 0000 0' : affiché sur les factures mensuelles
  donneesTest: true
}

const COULEUR = {
  encre: [30, 27, 23],
  muted: [121, 112, 95],
  accent: [255, 106, 19],
  filet: [226, 221, 210],
  doux: [248, 246, 241],
  ok: [39, 122, 78]
}
const MARGE = 18
const DROITE = 192 // bord droit du contenu
const LARGEUR = DROITE - MARGE

// ---------- Petits outils ----------

function montantCHF(n) {
  const [entier, decimales] = Number(n || 0).toFixed(2).split('.')
  return `${entier.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${decimales}`
}

function dateCH(v) {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function heureCH(v) {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })
}

function texte(doc, { police = 'normal', taille = 10, couleur = COULEUR.encre } = {}) {
  doc.setFont('helvetica', police)
  doc.setFontSize(taille)
  doc.setTextColor(...couleur)
}

// Texte en lettres espacées (capitales des intitulés), lettre par lettre :
// l'espacement natif de jsPDF fausse l'alignement à droite et les largeurs.
function largeurEspacee(doc, str, ecart) {
  const lettres = [...str]
  return lettres.reduce((s, l) => s + doc.getTextWidth(l), 0) + ecart * (lettres.length - 1)
}

function ecrireEspace(doc, str, x, y, ecart, align = 'left') {
  const lettres = [...str]
  const total = largeurEspacee(doc, str, ecart)
  let xx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x
  lettres.forEach((l) => {
    doc.text(l, xx, y)
    xx += doc.getTextWidth(l) + ecart
  })
  return total
}

function filet(doc, y, x1 = MARGE, x2 = DROITE, couleur = COULEUR.filet, epaisseur = 0.25) {
  doc.setDrawColor(...couleur)
  doc.setLineWidth(epaisseur)
  doc.line(x1, y, x2, y)
}

// Petit intitulé en capitales grises (ÉMETTEUR, FACTURÉ À…)
function etiquette(doc, libelle, x, y, align = 'left') {
  texte(doc, { police: 'bold', taille: 7, couleur: COULEUR.muted })
  ecrireEspace(doc, libelle.toUpperCase(), x, y, 0.45, align)
}

// ---------- Blocs communs ----------

// En-tête : logo à gauche, titre du document + numéro à droite. Renvoie le y suivant.
function enTete(doc, { titre, numero }) {
  doc.addImage(LOGO_2C_PNG, 'PNG', MARGE, 14, 13.5, 13.1)
  // « DELIVERY » en lettres espacées : DELI orange, VERY encre (comme le logo)
  texte(doc, { police: 'bold', taille: 10.5, couleur: COULEUR.accent })
  const largeurDeli = ecrireEspace(doc, 'DELI', MARGE + 17, 21, 1.1) + 1.1
  texte(doc, { police: 'bold', taille: 10.5, couleur: COULEUR.encre })
  ecrireEspace(doc, 'VERY', MARGE + 17 + largeurDeli, 21, 1.1)
  texte(doc, { taille: 7.5, couleur: COULEUR.muted })
  doc.text('Du rayon au chantier, en un clic.', MARGE + 17, 26)

  texte(doc, { police: 'bold', taille: 19 })
  ecrireEspace(doc, titre.toUpperCase(), DROITE, 21, 0.9, 'right')
  texte(doc, { police: 'bold', taille: 10.5, couleur: COULEUR.accent })
  doc.text(`N° ${numero}`, DROITE, 27.5, { align: 'right' })

  filet(doc, 34)
  doc.setDrawColor(...COULEUR.accent)
  doc.setLineWidth(0.9)
  doc.line(MARGE, 34, MARGE + 28, 34)
  return 44
}

// Page suivante : petit rappel en haut
function pageSuite(doc, { titre, numero }) {
  doc.addPage()
  texte(doc, { police: 'bold', taille: 8.5, couleur: COULEUR.muted })
  ecrireEspace(doc, `${titre.toUpperCase()}  N° ${numero}  (SUITE)`, MARGE, 16, 0.4)
  filet(doc, 20)
  return 30
}

// Deux colonnes d'adresses : émetteur à gauche, destinataire à droite. Renvoie le y suivant.
function parties(doc, y, { gauche, droite }) {
  const xDroite = 108
  etiquette(doc, gauche.titre, MARGE, y)
  etiquette(doc, droite.titre, xDroite, y)
  const bloc = (lignes, x, y0, toutGras) => {
    let yy = y0
    lignes.forEach((l, i) => {
      if (!l) return
      const gras = i === 0 || toutGras
      if (gras) texte(doc, { police: 'bold', taille: 10.5 })
      else texte(doc, { taille: 9.5 })
      const morceaux = doc.splitTextToSize(String(l), 80)
      doc.text(morceaux, x, yy)
      yy += morceaux.length * (gras ? 5.4 : 4.8)
    })
    return yy
  }
  const y1 = bloc(gauche.lignes, MARGE, y + 6, gauche.toutGras)
  const y2 = bloc(droite.lignes, xDroite, y + 6, droite.toutGras)
  return Math.max(y1, y2) + 4
}

// Bandeau gris clair avec 3 ou 4 informations clés (date, commande, paiement…).
function bandeauInfos(doc, y, cellules) {
  const h = 15
  doc.setFillColor(...COULEUR.doux)
  doc.roundedRect(MARGE, y, LARGEUR, h, 1.5, 1.5, 'F')
  const pas = LARGEUR / cellules.length
  cellules.forEach((c, i) => {
    const x = MARGE + 5 + i * pas
    etiquette(doc, c.libelle, x, y + 5.5)
    if (c.pastille) {
      texte(doc, { police: 'bold', taille: 7.5, couleur: c.couleur })
      const l = largeurEspacee(doc, c.valeur.toUpperCase(), 0.5) + 7
      doc.setDrawColor(...c.couleur)
      doc.setLineWidth(0.4)
      doc.roundedRect(x, y + 7.2, l, 5, 2.5, 2.5, 'S')
      ecrireEspace(doc, c.valeur.toUpperCase(), x + 3.5, y + 10.7, 0.5)
    } else {
      texte(doc, { police: 'bold', taille: 9.5 })
      doc.text(String(c.valeur), x, y + 11)
    }
  })
  return y + h + 9
}

// En-tête d'un tableau : libellés en capitales grises + filet foncé dessous.
function enteteTableau(doc, y, colonnes) {
  texte(doc, { police: 'bold', taille: 7, couleur: COULEUR.muted })
  colonnes.forEach((c) => ecrireEspace(doc, c.titre.toUpperCase(), c.x, y, 0.45, c.align || 'left'))
  filet(doc, y + 2.6, MARGE, DROITE, COULEUR.encre, 0.4)
  return y + 9
}

// Totaux alignés à droite. lignes = [{ libelle, valeur, fort }]. Renvoie le y suivant.
function totaux(doc, y, lignes) {
  const x0 = 120
  lignes.forEach((l) => {
    if (l.fort) {
      y += 2
      doc.setFillColor(...COULEUR.doux)
      doc.roundedRect(x0 - 4, y - 5.5, DROITE - x0 + 8, 11, 1.5, 1.5, 'F')
      texte(doc, { police: 'bold', taille: 11 })
      doc.text(l.libelle, x0, y + 1.6)
      texte(doc, { police: 'bold', taille: 14, couleur: COULEUR.accent })
      doc.text(l.valeur, DROITE - 1, y + 2, { align: 'right' })
      y += 10
    } else {
      texte(doc, { taille: 9, couleur: COULEUR.muted })
      doc.text(l.libelle, x0, y)
      texte(doc, { taille: 9.5 })
      doc.text(l.valeur, DROITE - 1, y, { align: 'right' })
      y += 6
    }
  })
  return y
}

// QR d'accès au compte (lien : https://2cdelivery.ch/?compte=1), dessiné en
// vectoriel. "1" = module noir.
const QR_COMPTE = ["1111111010001000001111111", "1000001000100110001000001", "1011101001000110101011101", "1011101001101110001011101", "1011101001100110101011101", "1000001000111110001000001", "1111111010101010101111111", "0000000010100110100000000", "1101101001100011101000001", "0101100001110011000111110", "0110001010111111011001001", "0000010011111011000001111", "1010101101010001001000001", "1001100100010011100110010", "1111111110100101011011111", "1000100100000010101101101", "1111111111101110111110110", "0000000011000100100010110", "1111111001010000101010001", "1000001000110101100010010", "1011101010111001111110010", "1011101010110100111000011", "1011101001010100110011111", "1000001010101010001110111", "1111111010111000101001001"]

// Bloc « Votre espace 2C » + QR code, en bas de la dernière page.
function blocCompte(doc, y, suite) {
  let yy = Math.max(y + 8, 247)
  if (yy + 27 > 278) yy = pageSuite(doc, suite)
  doc.setFillColor(...COULEUR.doux)
  doc.roundedRect(MARGE, yy, LARGEUR, 25, 1.5, 1.5, 'F')
  texte(doc, { police: 'bold', taille: 10 })
  doc.text('Votre espace 2C', MARGE + 6, yy + 9)
  texte(doc, { taille: 8.5, couleur: COULEUR.muted })
  doc.text('Retrouvez vos commandes et vos factures depuis votre compte :', MARGE + 6, yy + 14.5)
  doc.text('2cdelivery.ch  (ou scannez le QR code)', MARGE + 6, yy + 19)
  const taille = 19
  const module = taille / QR_COMPTE.length
  const x0 = DROITE - taille - 4
  const y0 = yy + 3
  doc.setFillColor(0, 0, 0)
  QR_COMPTE.forEach((ligne, r) => {
    for (let k = 0; k < ligne.length; k += 1) {
      if (ligne[k] === '1') doc.rect(x0 + k * module, y0 + r * module, module + 0.02, module + 0.02, 'F')
    }
  })
  return yy + 25
}

// Pied de page sur toutes les pages : coordonnées de 2C + numéro de page.
function finaliser(doc) {
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i)
    filet(doc, 284)
    texte(doc, { taille: 7.5, couleur: COULEUR.muted })
    doc.text(`${INFOS_ENTREPRISE.nom} • ${INFOS_ENTREPRISE.adresse} • ${INFOS_ENTREPRISE.contact}`, MARGE, 289)
    const ligne2 = []
    if (INFOS_ENTREPRISE.tvaNumero) ligne2.push(`N° TVA : ${INFOS_ENTREPRISE.tvaNumero}`)
    if (INFOS_ENTREPRISE.iban) ligne2.push(`IBAN : ${INFOS_ENTREPRISE.iban}`)
    if (ligne2.length) doc.text(ligne2.join(' • '), MARGE, 293)
    if (INFOS_ENTREPRISE.donneesTest) {
      texte(doc, { taille: 7, couleur: COULEUR.accent })
      doc.text("Informations d'entreprise provisoires (test) — à compléter avant tout envoi officiel.", MARGE, ligne2.length ? 296.5 : 293)
    }
    texte(doc, { taille: 7.5, couleur: COULEUR.muted })
    doc.text(`Page ${i} / ${total}`, DROITE, 289, { align: 'right' })
  }
  doc.setPage(total)
}

function blocEmetteur() {
  return {
    titre: 'Émetteur',
    lignes: [
      INFOS_ENTREPRISE.nom,
      INFOS_ENTREPRISE.adresse,
      INFOS_ENTREPRISE.contact,
      INFOS_ENTREPRISE.tvaNumero ? `N° TVA : ${INFOS_ENTREPRISE.tvaNumero}` : null
    ]
  }
}

// Tableau de lignes simples (désignation / quantité / prix / total).
function tableauProduits(doc, y, lignes, suite) {
  const colonnes = [
    { titre: 'Désignation', x: MARGE },
    { titre: 'Qté', x: 120, align: 'right' },
    { titre: 'Prix unitaire', x: 154, align: 'right' },
    { titre: 'Total', x: DROITE, align: 'right' }
  ]
  y = enteteTableau(doc, y, colonnes)
  lignes.forEach((l) => {
    const nom = doc.splitTextToSize(String(l.nom || ''), 92)
    const sous = l.detail ? doc.splitTextToSize(String(l.detail), 92) : []
    const h = nom.length * 4.8 + sous.length * 4.1 + 3.2
    if (y + h > 262) y = enteteTableau(doc, pageSuite(doc, suite), colonnes)
    texte(doc, { police: l.fort ? 'bold' : 'normal', taille: 9.5 })
    doc.text(nom, MARGE, y)
    if (sous.length) {
      texte(doc, { taille: 8, couleur: COULEUR.muted })
      doc.text(sous, MARGE, y + nom.length * 4.8 - 0.4)
    }
    texte(doc, { taille: 9.5 })
    if (l.prix !== null && l.prix !== undefined) {
      doc.text(String(l.quantite), 120, y, { align: 'right' })
      doc.text(montantCHF(l.prix), 154, y, { align: 'right' })
      texte(doc, { police: 'bold', taille: 9.5 })
      doc.text(montantCHF(l.prix * l.quantite), DROITE, y, { align: 'right' })
    }
    y += h
    filet(doc, y - 3.6)
  })
  return y + 2
}

// ---------- Facture d'une commande ----------

export function construireFacturePDF(commande) {
  const doc = new jsPDF()
  // Compte entreprise : 2C ne facture que la livraison (les produits sont
  // facturés par le fournisseur).
  const livraisonSeule = Boolean(commande.livraison_seule)
  const montantFacture = livraisonSeule ? Number(commande.frais_livraison || 0) : Number(commande.total || 0)
  const numeroFacture = `2C-${String(commande.id).padStart(5, '0')}`
  const suite = { titre: 'Facture', numero: numeroFacture }

  let y = enTete(doc, suite)

  const lignesClient = [commande.nom_client || '—']
  if (livraisonSeule && commande.chantier) lignesClient.push(`Chantier : ${commande.chantier}`)
  if (livraisonSeule && commande.technicien) lignesClient.push(`Commandé par : ${commande.technicien}`)
  if (commande.adresse) lignesClient.push(commande.adresse)
  if (commande.telephone) lignesClient.push(commande.telephone)
  if (commande.email) lignesClient.push(commande.email)
  y = parties(doc, y, { gauche: blocEmetteur(), droite: { titre: 'Facturé à', lignes: lignesClient } })

  y = bandeauInfos(doc, y + 2, [
    { libelle: 'Date de facture', valeur: dateCH(commande.created_at) },
    { libelle: 'Commande n°', valeur: commande.numero_suivi || commande.id },
    commande.deja_regle
      ? { libelle: 'Statut', valeur: 'Payée', pastille: true, couleur: COULEUR.ok }
      : { libelle: 'Statut', valeur: 'À payer', pastille: true, couleur: COULEUR.accent }
  ])

  // Les commandes passées avant l'ajout du détail ligne par ligne n'ont pas
  // "produits_detail" : on retombe alors sur le texte résumé, sans prix par article.
  const lignes = livraisonSeule
    ? [{
        nom: 'Livraison 2C Delivery',
        detail: `Commande ${commande.numero_suivi || commande.id}`,
        prix: montantFacture,
        quantite: 1,
        fort: true
      }]
    : commande.produits_detail && commande.produits_detail.length > 0
      ? commande.produits_detail
      : [{ nom: commande.produits, prix: null, quantite: null }]
  y = tableauProduits(doc, y, lignes, suite)

  if (y > 232) y = pageSuite(doc, suite)
  const lignesTotaux = []
  if (INFOS_ENTREPRISE.tvaTaux) {
    const sousTotal = montantFacture / (1 + INFOS_ENTREPRISE.tvaTaux / 100)
    lignesTotaux.push({ libelle: 'Sous-total HT', valeur: `${montantCHF(sousTotal)} CHF` })
    lignesTotaux.push({ libelle: `TVA (${INFOS_ENTREPRISE.tvaTaux}%)`, valeur: `${montantCHF(montantFacture - sousTotal)} CHF` })
  } else {
    lignesTotaux.push({ libelle: 'TVA', valeur: 'non applicable' })
  }
  lignesTotaux.push({
    libelle: commande.deja_regle ? 'Total payé' : 'Total à payer',
    valeur: `${montantCHF(montantFacture)} CHF`,
    fort: true
  })
  const yTotaux = y + 3
  if (commande.mention_paiement) {
    etiquette(doc, 'Paiement', MARGE, yTotaux + 1)
    texte(doc, { taille: 9, couleur: COULEUR.encre })
    doc.text(doc.splitTextToSize(commande.mention_paiement, 80), MARGE, yTotaux + 6.5)
  }
  y = totaux(doc, yTotaux, lignesTotaux)

  if (livraisonSeule) {
    // Contenu de la commande : sert de preuve en cas de litige de livraison
    // (à comparer avec ce que le fournisseur a remis au livreur).
    y += 6
    const contenu = commande.produits_detail && commande.produits_detail.length > 0
      ? commande.produits_detail
      : [{ nom: commande.produits, quantite: null }]
    if (y + 30 > 262) y = pageSuite(doc, suite)
    etiquette(doc, 'Contenu de la commande remis au livreur', MARGE, y)
    y += 4
    const colonnes = [
      { titre: 'Désignation', x: MARGE },
      { titre: 'Qté', x: DROITE, align: 'right' }
    ]
    y = enteteTableau(doc, y + 2, colonnes)
    contenu.forEach((l) => {
      const nom = doc.splitTextToSize(String(l.nom || ''), 150)
      const h = nom.length * 4.6 + 2.6
      if (y + h > 262) y = enteteTableau(doc, pageSuite(doc, suite), colonnes)
      texte(doc, { taille: 9 })
      doc.text(nom, MARGE, y)
      if (l.quantite !== null && l.quantite !== undefined) doc.text(String(l.quantite), DROITE, y, { align: 'right' })
      y += h
      filet(doc, y - 3.4)
    })
    texte(doc, { taille: 8.5, couleur: COULEUR.muted })
    y += 3
    doc.text(
      `Valeur de la commande fournisseur : ${montantCHF(commande.total)} CHF — facturée séparément par le fournisseur.`,
      MARGE, y
    )
  }

  blocCompte(doc, y, suite)
  finaliser(doc)
  return { doc, numeroFacture }
}

// ---------- Facture mensuelle des frais de livraison d'une entreprise ----------

// Libellé de la période d'une facture mensuelle : "octobre 2026" si elle couvre
// un mois entier, sinon "du 01.10.2026 au 15.10.2026".
export function libellePeriodeFacture(d) {
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

// `d` = données renvoyées par la base (admin_creer_facture_mensuelle).
export function construireFactureMensuellePDF(d) {
  const doc = new jsPDF()
  const montant = Number(d.montant_total || 0)
  const lignes = d.lignes || []
  const suite = { titre: 'Facture mensuelle', numero: d.numero }

  let y = enTete(doc, suite)

  const lignesClient = [d.entreprise_nom || '—']
  if (d.responsable_nom) lignesClient.push(d.responsable_nom)
  if (d.responsable_email) lignesClient.push(d.responsable_email)
  y = parties(doc, y, { gauche: blocEmetteur(), droite: { titre: 'Facturé à', lignes: lignesClient } })

  y = bandeauInfos(doc, y + 2, [
    { libelle: 'Émise le', valeur: dateCH(d.emise_le) },
    { libelle: 'Période', valeur: libellePeriodeFacture(d) },
    { libelle: 'Livraisons', valeur: String(lignes.length) },
    { libelle: 'À régler avant le', valeur: dateCH(d.echeance) }
  ])

  const colonnes = [
    { titre: 'Date', x: MARGE },
    { titre: 'Suivi', x: 40 },
    { titre: 'Chantier / commandé par', x: 70 },
    { titre: 'Livraison', x: DROITE, align: 'right' }
  ]
  y = enteteTableau(doc, y, colonnes)
  lignes.forEach((ligne) => {
    const detail = [ligne.chantier, ligne.technicien].filter(Boolean).join(' — ') || '—'
    const detailLignes = doc.splitTextToSize(detail, 100)
    // Produits de la livraison (preuve en cas de litige), en petit sous la ligne.
    const produitsTexte = Array.isArray(ligne.produits_detail) && ligne.produits_detail.length > 0
      ? ligne.produits_detail.map((p) => `${p.quantite} x ${p.nom}`).join(' ; ')
      : ligne.produits_texte || ''
    const produitsLignes = produitsTexte ? doc.splitTextToSize(`Contenu : ${produitsTexte}`, 150) : []
    const h = detailLignes.length * 4.8 + produitsLignes.length * 3.8 + 3.2
    if (y + h > 262) y = enteteTableau(doc, pageSuite(doc, suite), colonnes)
    texte(doc, { taille: 9 })
    doc.text(dateCH(ligne.date), MARGE, y)
    doc.text(String(ligne.numero_suivi || '—'), 40, y)
    doc.text(detailLignes, 70, y)
    texte(doc, { police: 'bold', taille: 9.5 })
    doc.text(`${montantCHF(ligne.frais)}`, DROITE, y, { align: 'right' })
    if (produitsLignes.length > 0) {
      texte(doc, { taille: 7.5, couleur: COULEUR.muted })
      doc.text(produitsLignes, MARGE, y + detailLignes.length * 4.8 - 0.4)
    }
    y += h
    filet(doc, y - 3.6)
  })

  if (y > 215) y = pageSuite(doc, suite)
  const lignesTotaux = []
  if (INFOS_ENTREPRISE.tvaTaux) {
    const sousTotal = montant / (1 + INFOS_ENTREPRISE.tvaTaux / 100)
    lignesTotaux.push({ libelle: 'Sous-total HT', valeur: `${montantCHF(sousTotal)} CHF` })
    lignesTotaux.push({ libelle: `TVA (${INFOS_ENTREPRISE.tvaTaux}%)`, valeur: `${montantCHF(montant - sousTotal)} CHF` })
  } else {
    lignesTotaux.push({ libelle: 'TVA', valeur: 'non applicable' })
  }
  lignesTotaux.push({ libelle: 'Total à payer', valeur: `${montantCHF(montant)} CHF`, fort: true })
  y = totaux(doc, y + 3, lignesTotaux)

  // Modalités de paiement
  y += 4
  if (y + 30 > 270) y = pageSuite(doc, suite)
  doc.setDrawColor(...COULEUR.filet)
  doc.setLineWidth(0.4)
  const hauteurBloc = INFOS_ENTREPRISE.iban ? 24 : 16
  doc.roundedRect(MARGE, y, LARGEUR, hauteurBloc, 1.5, 1.5, 'S')
  etiquette(doc, 'Paiement par virement', MARGE + 5, y + 6)
  texte(doc, { taille: 9 })
  doc.text(`À régler avant le ${dateCH(d.echeance)} (${d.delai_jours} jours).`, MARGE + 5, y + 12)
  if (INFOS_ENTREPRISE.iban) {
    texte(doc, { police: 'bold', taille: 9 })
    doc.text(`IBAN : ${INFOS_ENTREPRISE.iban}`, MARGE + 5, y + 17.5)
    texte(doc, { taille: 9 })
    doc.text(`Référence à indiquer : ${d.numero}`, MARGE + 5, y + 22)
  }
  y += hauteurBloc + 6
  texte(doc, { taille: 8.5, couleur: COULEUR.muted })
  doc.text('Frais de livraison 2C Delivery uniquement : les produits sont facturés séparément par le fournisseur.', MARGE, y)

  blocCompte(doc, y, suite)
  finaliser(doc)
  return doc
}

// ---------- Bon de livraison ----------

// Document joint à l'email de livraison : ce qui a été enlevé, pour qui, le
// contenu de la commande et la confirmation de remise. La remise est prouvée
// par le code de livraison du client : aucune signature n'est demandée, et le
// code lui-même n'y figure JAMAIS.
export function construireBonLivraisonPDF(c) {
  const doc = new jsPDF()
  const suite = { titre: 'Bon de livraison', numero: c.numero_suivi }
  let y = enTete(doc, suite)

  const fournisseurs = Array.isArray(c.fournisseurs) ? c.fournisseurs : c.fournisseurs ? [c.fournisseurs] : []
  const destinataire = [c.entreprise || c.nom_client || '—']
  if (c.entreprise && c.nom_client) destinataire.push(c.nom_client)
  if (c.chantier) destinataire.push(`Chantier : ${c.chantier}`)
  if (c.technicien) destinataire.push(`Commandé par : ${c.technicien}`)
  if (c.adresse) destinataire.push(c.adresse)
  if (c.telephone) destinataire.push(c.telephone)
  y = parties(doc, y, {
    gauche: { titre: 'Enlevé chez', toutGras: true, lignes: fournisseurs.length ? fournisseurs : ['2C Delivery'] },
    droite: { titre: 'Livré à', lignes: destinataire }
  })

  const livree = Boolean(c.livre_le)
  const cellules = [
    { libelle: 'Commande passée le', valeur: dateCH(c.created_at) },
    { libelle: livree ? 'Livrée le' : 'Livraison', valeur: livree ? `${dateCH(c.livre_le)} à ${heureCH(c.livre_le)}` : '—' }
  ]
  if (c.nb_colis) cellules.push({ libelle: 'Colis', valeur: `${c.nb_colis} colis${c.box ? ` (box ${c.box})` : ''}` })
  cellules.push(
    livree
      ? { libelle: 'Statut', valeur: 'Livrée', pastille: true, couleur: COULEUR.ok }
      : { libelle: 'Statut', valeur: 'À livrer', pastille: true, couleur: COULEUR.accent }
  )
  y = bandeauInfos(doc, y + 2, cellules)

  // Contenu de la commande
  const colonnes = [
    { titre: 'Désignation', x: MARGE },
    { titre: 'Qté', x: DROITE, align: 'right' }
  ]
  y = enteteTableau(doc, y, colonnes)
  const contenu = c.produits_detail && c.produits_detail.length > 0
    ? c.produits_detail
    : [{ nom: c.produits || '—', quantite: null }]
  contenu.forEach((l) => {
    const nom = doc.splitTextToSize(String(l.nom || ''), 140)
    const h = nom.length * 4.8 + 3.6
    if (y + h > 255) y = enteteTableau(doc, pageSuite(doc, suite), colonnes)
    texte(doc, { taille: 9.5 })
    doc.text(nom, MARGE, y)
    if (l.quantite !== null && l.quantite !== undefined) {
      texte(doc, { police: 'bold', taille: 9.5 })
      doc.text(String(l.quantite), DROITE, y, { align: 'right' })
    }
    y += h
    filet(doc, y - 3.8)
  })

  // Confirmation de remise (par le code de livraison)
  y += 8
  if (y + 40 > 278) y = pageSuite(doc, suite)
  etiquette(doc, 'Remise de la commande', MARGE, y)
  y += 3
  const lignesRemise = [
    ['Remise à', c.recu_par || '—'],
    [livree ? 'Livrée le' : 'Livraison', livree ? `${dateCH(c.livre_le)} à ${heureCH(c.livre_le)}` : '—'],
    ['Confirmation', livree ? 'Code de livraison validé par le client' : 'En attente du code de livraison']
  ]
  doc.setFillColor(...COULEUR.doux)
  doc.roundedRect(MARGE, y, LARGEUR, 9 + lignesRemise.length * 7, 1.5, 1.5, 'F')
  lignesRemise.forEach(([libelle, valeur], i) => {
    const yy = y + 9 + i * 7
    texte(doc, { taille: 8.5, couleur: COULEUR.muted })
    doc.text(libelle, MARGE + 6, yy)
    texte(doc, { police: 'bold', taille: 9.5 })
    doc.text(String(valeur), MARGE + 42, yy)
  })
  y += 9 + lignesRemise.length * 7 + 7
  texte(doc, { taille: 8, couleur: COULEUR.muted })
  doc.text(
    'Bon établi automatiquement par 2C Delivery : la remise de la commande est confirmée par le code de livraison du client.',
    MARGE, y
  )

  finaliser(doc)
  return doc
}
