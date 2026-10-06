// Fonction : creer-paiement
// Reçoit le panier + les coordonnées du client, recalcule le prix À PARTIR
// DU CATALOGUE (jamais depuis le navigateur), met le panier de côté, puis
// crée la page de paiement Stripe et renvoie son adresse.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (!STRIPE_KEY) return reponse({ error: 'Paiement non configuré.' }, 500)

    const { panier, nomClient, adresse, telephone, email, chantier, technicien } = await req.json()

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

    // Tous les clients (y compris les comptes entreprise) paient en ligne.
    const userId = await utilisateurConnecte(req)

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

    if (totalCentimes < 50) return reponse({ error: 'Montant trop faible pour un paiement en ligne.' }, 400)

    const total = totalCentimes / 100
    const produitsTexte = detail.map((l) => (l.quantite > 1 ? `${l.nom} x${l.quantite}` : l.nom)).join(', ')

    // Panier mis de côté en attendant le paiement.
    const ri = await rest('paiements_en_attente', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: userId,
        total,
        payload: {
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
