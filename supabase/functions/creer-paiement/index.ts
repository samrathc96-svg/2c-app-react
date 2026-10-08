// Fonction : creer-paiement
// Reçoit le panier + les coordonnées du client, recalcule le prix À PARTIR
// DU CATALOGUE (jamais depuis le navigateur), met le panier de côté, puis
// crée la page de paiement Stripe et renvoie son adresse.
// Comptes entreprise (rattachés à une entreprise) : 2C ne facture que la
// LIVRAISON (tarif réglé dans l'admin). Selon le mode de l'entreprise :
//   carte   -> carte réservée sur la page Stripe, débitée à la livraison ;
//   prepaye -> frais retirés du solde prépayé, sans passer par Stripe ;
//   mensuel -> aucun paiement maintenant (plafond contrôlé), facture mensuelle.
// Les autres clients (particuliers, invités) paient leurs produits en ligne
// comme avant.
// Action "recharge" : le responsable d'une entreprise en mode prépayé recharge
// son solde par carte (le crédit est fait par le webhook Stripe).
// Secrets requis : STRIPE_SECRET_KEY (SUPABASE_URL et
// SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://2cdelivery.ch'

function reponse(corps: unknown, status = 200) {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

function rest(chemin: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  })
}

// Identifie le client connecté (s'il y en a un) à partir de son jeton.
async function utilisateurConnecte(req: Request): Promise<string | null> {
  const jeton = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  if (!jeton) return null
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${jeton}` }
  })
  if (!r.ok) return null
  const utilisateur = await r.json()
  return utilisateur?.id ?? null
}

// Lecture simple via l'API REST (clé serveur). Renvoie [] en cas de souci.
async function lire(chemin: string): Promise<any[]> {
  try {
    const r = await rest(chemin)
    if (!r.ok) return []
    const donnees = await r.json()
    return Array.isArray(donnees) ? donnees : []
  } catch (_e) {
    return []
  }
}

// --- Tarif de livraison -------------------------------------------------

type Point = { lat: number; lon: number }

function kmEntre(a: Point, b: Point) {
  const rad = (x: number) => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

async function geocoder(adresse: string): Promise<Point | null> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ch,fr&q=${encodeURIComponent(adresse)}`,
      { headers: { 'User-Agent': '2CDelivery/1.0 (contact@2cdelivery.ch)', 'Accept-Language': 'fr' } }
    )
    if (!r.ok) return null
    const res = await r.json()
    if (!Array.isArray(res) || res.length === 0) return null
    return { lat: parseFloat(res[0].lat), lon: parseFloat(res[0].lon) }
  } catch (_e) {
    return null
  }
}

// Frais de livraison = forfait + (km au-delà de km_inclus) x prix_km.
// Tant que prix_km vaut 0 (réglage de départ), le prix est fixe et aucune
// distance n'est calculée. Distance = trajet estimé fournisseur(s) -> adresse
// (à vol d'oiseau x 1,3). Si l'adresse est introuvable : forfait seul.
async function calculerFrais(
  adresse: string,
  nomsFournisseurs: string[]
): Promise<{ frais: number; distanceKm: number | null }> {
  const [t] = await lire('tarif_livraison?id=eq.1&select=forfait,km_inclus,prix_km')
  const forfait = t ? Number(t.forfait) : 10
  const kmInclus = t ? Number(t.km_inclus) : 0
  const prixKm = t ? Number(t.prix_km) : 0
  const arrondi = (x: number) => Math.max(0.5, Math.round(x * 20) / 20)
  if (!(prixKm > 0)) return { frais: arrondi(forfait), distanceKm: null }

  const destination = await geocoder(adresse)
  if (!destination) return { frais: arrondi(forfait), distanceKm: null }

  const liste = nomsFournisseurs.filter(Boolean)
  let fiches: Point[] = []
  if (liste.length > 0) {
    const noms = liste.map((n) => `"${n.replace(/"/g, '')}"`).join(',')
    const lignes = await lire(`fournisseurs?nom=in.(${encodeURIComponent(noms)})&select=latitude,longitude`)
    fiches = lignes
      .filter((f) => typeof f.latitude === 'number' && typeof f.longitude === 'number')
      .map((f) => ({ lat: f.latitude, lon: f.longitude }))
  }
  if (fiches.length === 0) return { frais: arrondi(forfait), distanceKm: null }

  // Parcours : on part du fournisseur le plus éloigné de la destination, puis
  // on enchaîne toujours le plus proche, jusqu'à la destination.
  const restants = [...fiches].sort((a, b) => kmEntre(b, destination) - kmEntre(a, destination))
  let courant = restants.shift() as Point
  let vol = 0
  while (restants.length > 0) {
    restants.sort((a, b) => kmEntre(courant, a) - kmEntre(courant, b))
    const suivant = restants.shift() as Point
    vol += kmEntre(courant, suivant)
    courant = suivant
  }
  vol += kmEntre(courant, destination)
  const distanceKm = Math.round(vol * 1.3 * 10) / 10
  const frais = arrondi(forfait + Math.max(0, distanceKm - kmInclus) * prixKm)
  return { frais, distanceKm }
}

// Informations ajoutées à l'email de confirmation d'une commande entreprise.
async function infosEmailCommande(commandeId: unknown) {
  const infos: Record<string, unknown> = {}
  const id = encodeURIComponent(String(commandeId))

  const [commande] = await lire(`commandes?id=eq.${id}&select=user_id,chantier,technicien`)
  if (commande) {
    if (commande.chantier) infos.chantier = commande.chantier
    if (commande.technicien) infos.technicien = commande.technicien
  }

  const [course] = await lire(`courses?commande_id=eq.${id}&select=id&limit=1`)
  if (course) {
    const [codeLigne] = await lire(
      `codes_livraison?course_id=eq.${encodeURIComponent(String(course.id))}&select=code`
    )
    if (codeLigne?.code) infos.codeLivraison = codeLigne.code
  }

  if (commande?.user_id) {
    const [membre] = await lire(
      `entreprise_membres?user_id=eq.${encodeURIComponent(commande.user_id)}&select=entreprise_id,entreprises(nom)`
    )
    if (membre) {
      const nomEntreprise = Array.isArray(membre.entreprises) ? membre.entreprises[0]?.nom : membre.entreprises?.nom
      if (nomEntreprise) infos.nomEntreprise = nomEntreprise
      const [responsable] = await lire(
        `entreprise_membres?entreprise_id=eq.${encodeURIComponent(membre.entreprise_id)}&role_entreprise=eq.responsable&actif=eq.true&select=user_id&limit=1`
      )
      if (responsable) {
        const [profil] = await lire(`profils?id=eq.${encodeURIComponent(responsable.user_id)}&select=email`)
        if (profil?.email) infos.emailResponsable = profil.email
      }
    }
  }
  return infos
}

// Recharge du solde prépayé par le responsable de l'entreprise.
async function recharger(req: Request, corps: { montant?: unknown }) {
  const userId = await utilisateurConnecte(req)
  if (!userId) return reponse({ error: 'Connectez-vous pour recharger votre solde.' }, 401)

  const [membre] = await lire(
    `entreprise_membres?user_id=eq.${encodeURIComponent(userId)}&select=entreprise_id,actif,role_entreprise,entreprises(nom,statut,mode_paiement)`
  )
  const ent = membre ? (Array.isArray(membre.entreprises) ? membre.entreprises[0] : membre.entreprises) : null
  if (!membre || !membre.actif || membre.role_entreprise !== 'responsable' || !ent) {
    return reponse({ error: "Seul le responsable de l'entreprise peut recharger le solde." }, 403)
  }
  if (ent.statut === 'suspendue') {
    return reponse({ error: 'Le compte de votre entreprise est suspendu. Contactez 2C Delivery.' }, 403)
  }
  if (ent.mode_paiement !== 'prepaye') {
    return reponse({ error: "Votre entreprise n'est pas en mode compte prépayé." }, 400)
  }

  const montant = Math.round(Number(corps.montant) * 100) / 100
  if (!Number.isFinite(montant) || montant < 20 || montant > 5000) {
    return reponse({ error: 'Le montant de la recharge doit être compris entre 20 et 5000 CHF.' }, 400)
  }

  const [profil] = await lire(`profils?id=eq.${encodeURIComponent(userId)}&select=email`)

  const form = new URLSearchParams()
  form.set('mode', 'payment')
  form.set('locale', 'fr')
  if (profil?.email) form.set('customer_email', String(profil.email))
  form.set('metadata[type]', 'recharge')
  form.set('metadata[entreprise_id]', String(membre.entreprise_id))
  form.set('success_url', `${SITE_URL}/?recharge=ok`)
  form.set('cancel_url', `${SITE_URL}/?recharge=annule`)
  form.set('line_items[0][quantity]', '1')
  form.set('line_items[0][price_data][currency]', 'chf')
  form.set('line_items[0][price_data][unit_amount]', String(Math.round(montant * 100)))
  form.set('line_items[0][price_data][product_data][name]', `Recharge du solde prépayé – ${ent.nom}`)

  const rs = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form
  })
  const session = await rs.json()
  if (!rs.ok || !session.url) {
    console.error('Erreur Stripe (recharge) :', session)
    return reponse({ error: 'La recharge n’a pas pu être lancée, réessayez.' }, 502)
  }
  return reponse({ url: session.url })
}

// Traduit les messages d'erreur de la base en messages clairs.
function messageErreurEntreprise(texte: string): { message: string; status: number } {
  if (texte.includes('Solde prépayé insuffisant')) {
    return { message: "Le solde prépayé de votre entreprise est insuffisant. Demandez à votre responsable de le recharger.", status: 402 }
  }
  if (texte.includes('Plafond mensuel atteint')) {
    return { message: "Le plafond mensuel de votre entreprise est atteint. Contactez votre responsable ou 2C Delivery.", status: 402 }
  }
  if (texte.includes('Facturation mensuelle non activée') || texte.includes('Plafond mensuel non défini')) {
    return { message: "La facturation mensuelle n'est pas encore activée pour votre entreprise. Contactez 2C Delivery.", status: 403 }
  }
  if (texte.includes('Accès entreprise désactivé')) {
    return { message: 'Votre accès a été désactivé par le responsable de votre entreprise.', status: 403 }
  }
  if (texte.includes('Entreprise suspendue')) {
    return { message: 'Le compte de votre entreprise est suspendu. Contactez 2C Delivery.', status: 403 }
  }
  if (texte.includes('Stock insuffisant')) {
    return { message: 'Stock insuffisant pour un ou plusieurs produits. Ajuste les quantités.', status: 409 }
  }
  return { message: "La commande n'a pas pu être enregistrée, réessayez.", status: 500 }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (!STRIPE_KEY) return reponse({ error: 'Paiement non configuré.' }, 500)

    const corpsRequete = await req.json()
    if (corpsRequete.action === 'recharge') return await recharger(req, corpsRequete)
    const { panier, nomClient, adresse, telephone, email, chantier, technicien } = corpsRequete

    const texte = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
    const nom = texte(nomClient, 120)
    const adr = texte(adresse, 250)
    const tel = texte(telephone, 40)
    const mail = texte(email, 200)
    // Comptes entreprise : chantier et collaborateur qui commande (facultatifs ici,
    // exigés par l'application pour ces comptes).
    const chantierTexte = texte(chantier, 160) || null
    const technicienTexte = texte(technicien, 120) || null

    if (!nom || !adr || !tel || !mail || !/^\S+@\S+\.\S+$/.test(mail)) {
      return reponse({ error: "Merci de renseigner le nom, l'adresse, le téléphone et un email valide." }, 400)
    }
    if (!Array.isArray(panier) || panier.length === 0 || panier.length > 50) {
      return reponse({ error: 'Panier invalide.' }, 400)
    }

    const userId = await utilisateurConnecte(req)

    // Compte rattaché à une entreprise ? (contrôle fait ici, côté serveur)
    let entreprise: { mode: string; statut: string } | null = null
    if (userId) {
      const [membre] = await lire(
        `entreprise_membres?user_id=eq.${encodeURIComponent(userId)}&select=actif,entreprises(statut,mode_paiement)`
      )
      if (membre) {
        if (!membre.actif) {
          return reponse({ error: 'Votre accès a été désactivé par le responsable de votre entreprise.' }, 403)
        }
        const ent = Array.isArray(membre.entreprises) ? membre.entreprises[0] : membre.entreprises
        if (ent?.statut === 'suspendue') {
          return reponse({ error: 'Le compte de votre entreprise est suspendu. Contactez 2C Delivery.' }, 403)
        }
        entreprise = { mode: ent?.mode_paiement ?? 'carte', statut: ent?.statut ?? 'en_attente' }
      }
    }

    // Prix du catalogue pour les produits connus (id numérique).
    const idsCatalogue = panier
      .map((l: { id: unknown }) => String(l.id))
      .filter((id: string) => /^[0-9]+$/.test(id))
    const produitsDb: Record<string, { nom: string; prix: number; quantite_stock: number | null }> = {}
    if (idsCatalogue.length > 0) {
      const rpd = await rest(`produits?id=in.(${idsCatalogue.join(',')})&select=id,nom,prix,quantite_stock`)
      if (!rpd.ok) return reponse({ error: 'Catalogue indisponible, réessaie.' }, 500)
      for (const p of await rpd.json()) produitsDb[String(p.id)] = p
    }

    // Fournisseurs concernés (pour le calcul de distance) — facultatif.
    const fournisseursPanier = new Set<string>()
    if (entreprise && idsCatalogue.length > 0) {
      const lignesF = await lire(`produits?id=in.(${idsCatalogue.join(',')})&select=fournisseur`)
      for (const l of lignesF) if (l.fournisseur) fournisseursPanier.add(String(l.fournisseur))
    }

    const detail: { id: unknown; nom: string; prix: number; quantite: number }[] = []
    let totalCentimes = 0
    for (const ligne of panier) {
      const quantite = Number(ligne.quantite)
      if (!Number.isInteger(quantite) || quantite < 1 || quantite > 999) {
        return reponse({ error: 'Quantité invalide.' }, 400)
      }
      const id = String(ligne.id)
      let nomLigne: string
      let prix: number
      if (/^[0-9]+$/.test(id)) {
        const p = produitsDb[id]
        if (!p) return reponse({ error: 'Un produit de ton panier n’existe plus.' }, 400)
        if (p.quantite_stock !== null && p.quantite_stock < quantite) {
          return reponse({ error: 'Stock insuffisant pour un ou plusieurs produits. Ajuste les quantités.' }, 409)
        }
        nomLigne = p.nom
        prix = Number(p.prix)
      } else {
        // Pièce sur mesure du configurateur : le prix est calculé dans l'app.
        nomLigne = texte(ligne.nom, 120)
        prix = Number(ligne.prix)
        if (!nomLigne || !Number.isFinite(prix) || prix <= 0 || prix > 5000) {
          return reponse({ error: 'Pièce sur mesure invalide.' }, 400)
        }
      }
      const centimes = Math.round(prix * 100)
      totalCentimes += centimes * quantite
      detail.push({ id: ligne.id, nom: nomLigne, prix: centimes / 100, quantite })
    }

    const total = totalCentimes / 100
    const produitsTexte = detail.map((l) => (l.quantite > 1 ? `${l.nom} x${l.quantite}` : l.nom)).join(', ')

    // ---------- Compte entreprise : on ne facture que la livraison ----------
    if (entreprise) {
      const { frais, distanceKm } = await calculerFrais(adr, [...fournisseursPanier])

      if (entreprise.mode === 'prepaye' || entreprise.mode === 'mensuel') {
        const rc = await rest('rpc/creer_commande_entreprise', {
          method: 'POST',
          body: JSON.stringify({
            p_user_id: userId,
            p_produits: produitsTexte,
            p_detail: detail,
            p_total: total,
            p_nom: nom,
            p_adresse: adr,
            p_telephone: tel,
            p_email: mail,
            p_technicien: technicienTexte,
            p_chantier: chantierTexte,
            p_frais: frais,
            p_distance: distanceKm
          })
        })
        if (!rc.ok) {
          const erreur = await rc.text()
          console.error('creer_commande_entreprise :', erreur)
          const { message, status } = messageErreurEntreprise(erreur)
          return reponse({ error: message }, status)
        }
        const resultat = await rc.json()
        const commande = Array.isArray(resultat) ? resultat[0] : resultat
        if (!commande) return reponse({ error: "La commande n'a pas pu être enregistrée, réessayez." }, 500)

        // Email de confirmation (avec code de livraison + bon de commande au responsable)
        if (commande.email) {
          const infos = await infosEmailCommande(commande.id)
          await fetch(`${SUPABASE_URL}/functions/v1/envoyer-confirmation-commande`, {
            method: 'POST',
            headers: {
              apikey: SERVICE_KEY,
              Authorization: `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              email: commande.email,
              nomClient: commande.nom_client,
              produits: commande.produits,
              total: commande.total,
              numeroSuivi: commande.numero_suivi,
              adresse: commande.adresse,
              fraisLivraison: frais,
              modePaiement: entreprise.mode,
              ...infos
            })
          }).catch((e) => console.error('Email de confirmation :', e))
        }
        return reponse({ commande })
      }

      // Mode carte : la carte est RÉSERVÉE maintenant, débitée à la livraison.
      const ri = await rest('paiements_en_attente', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          user_id: userId,
          total,
          payload: {
            mode_paiement: 'carte_entreprise',
            total_produits: total,
            frais,
            distance_km: distanceKm,
            produits: produitsTexte,
            produits_detail: detail,
            nom_client: nom,
            adresse: adr,
            telephone: tel,
            email: mail,
            chantier: chantierTexte,
            technicien: technicienTexte
          }
        })
      })
      if (!ri.ok) return reponse({ error: 'Impossible de préparer le paiement.' }, 500)
      const attenteCarte = (await ri.json())[0]

      const formCarte = new URLSearchParams()
      formCarte.set('mode', 'payment')
      formCarte.set('locale', 'fr')
      formCarte.set('customer_email', mail)
      formCarte.set('client_reference_id', attenteCarte.id)
      formCarte.set('metadata[pending_id]', attenteCarte.id)
      formCarte.set('metadata[mode_paiement]', 'carte_entreprise')
      formCarte.set('payment_intent_data[capture_method]', 'manual')
      formCarte.set('payment_intent_data[metadata][pending_id]', attenteCarte.id)
      formCarte.set('payment_intent_data[description]', `Livraison 2C Delivery${chantierTexte ? ` – ${chantierTexte}` : ''}`)
      formCarte.set('success_url', `${SITE_URL}/?paiement=ok&session_id={CHECKOUT_SESSION_ID}`)
      formCarte.set('cancel_url', `${SITE_URL}/?paiement=annule`)
      formCarte.set('line_items[0][quantity]', '1')
      formCarte.set('line_items[0][price_data][currency]', 'chf')
      formCarte.set('line_items[0][price_data][unit_amount]', String(Math.round(frais * 100)))
      formCarte.set('line_items[0][price_data][product_data][name]', 'Livraison 2C Delivery')
      formCarte.set(
        'line_items[0][price_data][product_data][description]',
        'Montant réservé sur votre carte, débité uniquement une fois la livraison effectuée.'
      )

      const rsCarte = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${STRIPE_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': attenteCarte.id
        },
        body: formCarte
      })
      const sessionCarte = await rsCarte.json()
      if (!rsCarte.ok || !sessionCarte.url) {
        console.error('Erreur Stripe :', sessionCarte)
        return reponse({ error: 'Le paiement n’a pas pu être lancé, réessayez.' }, 502)
      }
      await rest(`paiements_en_attente?id=eq.${attenteCarte.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ stripe_session_id: sessionCarte.id })
      })
      return reponse({ url: sessionCarte.url })
    }

    // ---------- Particuliers et invités : produits payés en ligne ----------
    if (totalCentimes < 50) return reponse({ error: 'Montant trop faible pour un paiement en ligne.' }, 400)

    // Panier mis de côté en attendant le paiement.
    const ri = await rest('paiements_en_attente', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: userId,
        total,
        payload: {
          mode_paiement: 'en_ligne',
          total_produits: total,
          produits: produitsTexte,
          produits_detail: detail,
          nom_client: nom,
          adresse: adr,
          telephone: tel,
          email: mail,
          chantier: chantierTexte,
          technicien: technicienTexte
        }
      })
    })
    if (!ri.ok) return reponse({ error: 'Impossible de préparer le paiement.' }, 500)
    const attente = (await ri.json())[0]

    // Page de paiement Stripe (les moyens de paiement — carte, TWINT, etc. —
    // se règlent dans le tableau de bord Stripe, pas ici).
    const form = new URLSearchParams()
    form.set('mode', 'payment')
    form.set('locale', 'fr')
    form.set('customer_email', mail)
    form.set('client_reference_id', attente.id)
    form.set('metadata[pending_id]', attente.id)
    form.set('success_url', `${SITE_URL}/?paiement=ok&session_id={CHECKOUT_SESSION_ID}`)
    form.set('cancel_url', `${SITE_URL}/?paiement=annule`)
    detail.forEach((l, i) => {
      form.set(`line_items[${i}][quantity]`, String(l.quantite))
      form.set(`line_items[${i}][price_data][currency]`, 'chf')
      form.set(`line_items[${i}][price_data][unit_amount]`, String(Math.round(l.prix * 100)))
      form.set(`line_items[${i}][price_data][product_data][name]`, l.nom)
    })

    const rs = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': attente.id
      },
      body: form
    })
    const session = await rs.json()
    if (!rs.ok || !session.url) {
      console.error('Erreur Stripe :', session)
      return reponse({ error: 'Le paiement n’a pas pu être lancé, réessaie.' }, 502)
    }

    await rest(`paiements_en_attente?id=eq.${attente.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ stripe_session_id: session.id })
    })

    return reponse({ url: session.url })
  } catch (e) {
    console.error('creer-paiement :', e)
    return reponse({ error: 'Erreur inattendue, réessaie.' }, 500)
  }
})
