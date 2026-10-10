// =========================================================
// Produits habituels d'un client
// =========================================================
// Le calcul se fait dans le navigateur, à partir des commandes déjà passées
// (aucune donnée supplémentaire envoyée au serveur) :
//  * chaque commande où le produit apparaît compte pour 1 point, mais ce
//    point diminue avec le temps (il est divisé par 2 tous les 60 jours) :
//    un produit commandé souvent et récemment passe devant un produit
//    commandé une seule fois il y a six mois ;
//  * le score d'un fournisseur = la somme des scores de ses produits, ce
//    qui permet de lui donner la première place dans les listes.

export const DEMI_VIE_JOURS = 60
// En dessous (un seul achat vieux de plus de ~8 mois), le produit n'est plus « habituel ».
const SCORE_MINIMUM = 0.05
const CLE_HISTORIQUE = 'historiqueLignes2C'
const MAX_COMMANDES_LOCALES = 40

const JOUR_MS = 24 * 3600 * 1000

function normaliser(texte) {
  return String(texte || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

// Transforme des commandes (colonne produits_detail) en historique simple :
// [{ date, lignes: [{ id, nom, quantite }] }]
export function historiqueDepuisCommandes(commandes) {
  if (!Array.isArray(commandes)) return []
  return commandes
    .filter((c) => c && Array.isArray(c.produits_detail) && c.produits_detail.length > 0)
    .map((c) => ({
      date: c.created_at || null,
      lignes: c.produits_detail
        .filter((l) => l && l.nom)
        .map((l) => ({ id: l.id === undefined ? null : l.id, nom: l.nom, quantite: Number(l.quantite) || 1 }))
    }))
}

// Visiteur sans compte : l'historique reste dans ce navigateur uniquement.
export function lireHistoriqueLocal() {
  try {
    const brut = window.localStorage.getItem(CLE_HISTORIQUE)
    const liste = brut ? JSON.parse(brut) : []
    return Array.isArray(liste) ? liste : []
  } catch (e) {
    return []
  }
}

export function ajouterHistoriqueLocal(commande) {
  try {
    const nouvelles = historiqueDepuisCommandes([commande])
    if (nouvelles.length === 0) return lireHistoriqueLocal()
    const liste = [...nouvelles, ...lireHistoriqueLocal()].slice(0, MAX_COMMANDES_LOCALES)
    window.localStorage.setItem(CLE_HISTORIQUE, JSON.stringify(liste))
    return liste
  } catch (e) {
    return []
  }
}

// historique : voir ci-dessus. produits : produits du catalogue à plat.
// disponible(produit) : false pour un produit à écarter (démonstration,
// rupture de stock...).
export function calculerHabitudes(historique, produits, disponible = () => true, maintenant = Date.now()) {
  const parId = new Map()
  const parNom = new Map()
  produits.forEach((p) => {
    parId.set(String(p.id), p)
    parNom.set(normaliser(p.nom), p)
  })

  const scores = new Map() // id produit -> { produit, score, fois, derniere }
  ;(historique || []).forEach((commande) => {
    const date = commande.date ? new Date(commande.date).getTime() : NaN
    const age = Number.isFinite(date) ? Math.max(0, (maintenant - date) / JOUR_MS) : 365
    const poids = Math.pow(0.5, age / DEMI_VIE_JOURS)
    const vusDansCommande = new Set()
    ;(commande.lignes || []).forEach((ligne) => {
      const produit =
        (ligne.id !== null && ligne.id !== undefined && parId.get(String(ligne.id))) ||
        parNom.get(normaliser(ligne.nom))
      if (!produit || vusDansCommande.has(produit.id)) return
      vusDansCommande.add(produit.id)
      const courant = scores.get(produit.id) || { produit, score: 0, fois: 0, derniere: 0 }
      courant.score += poids
      courant.fois += 1
      if (Number.isFinite(date) && date > courant.derniere) courant.derniere = date
      scores.set(produit.id, courant)
    })
  })

  const habituels = [...scores.values()]
    .filter((h) => h.score >= SCORE_MINIMUM && disponible(h.produit))
    .sort((a, b) => b.score - a.score || b.fois - a.fois || b.derniere - a.derniere)

  const parFournisseur = {}
  habituels.forEach((h) => {
    const nom = h.produit.fournisseur
    parFournisseur[nom] = (parFournisseur[nom] || 0) + h.score
  })

  return { produits: habituels, parFournisseur }
}

// "il y a 3 jours", "aujourd'hui"...
export function libelleDernierAchat(derniere, maintenant = Date.now()) {
  if (!derniere) return ''
  const jours = Math.floor((maintenant - derniere) / JOUR_MS)
  if (jours <= 0) return "aujourd'hui"
  if (jours === 1) return 'hier'
  if (jours < 30) return `il y a ${jours} jours`
  const mois = Math.floor(jours / 30)
  return mois === 1 ? 'il y a 1 mois' : `il y a ${mois} mois`
}
