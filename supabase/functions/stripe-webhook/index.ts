// Fonction : stripe-webhook
// Appelée PAR STRIPE (pas par le site) quand un paiement est réussi.
// Vérifie que le message vient bien de Stripe (signature), puis crée la
// commande, puis envoie l'email de confirmation.
// À déployer avec "Verify JWT" DÉSACTIVÉ (Stripe n'a pas de compte Supabase).
// Secrets requis : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const encodeur = new TextEncoder()

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function egalConstant(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Vérifie la signature Stripe (HMAC-SHA256) et que le message est récent.
async function signatureValide(corps: string, entete: string | null) {
  if (!entete || !WEBHOOK_SECRET) return false
  const parties = Object.fromEntries(
    entete.split(',').map((p) => {
      const [k, ...v] = p.split('=')
      return [k, v.join('=')]
    })
  )
  const t = parties['t']
  const v1 = entete
    .split(',')
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3))
  if (!t || v1.length === 0) return false
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false

  const cle = await crypto.subtle.importKey(
    'raw',
    encodeur.encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const attendu = hex(await crypto.subtle.sign('HMAC', cle, encodeur.encode(`${t}.${corps}`)))
  return v1.some((s) => egalConstant(s, attendu))
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

async function rembourser(paymentIntent: string, cle: string) {
  const form = new URLSearchParams()
  form.set('payment_intent', paymentIntent)
  return fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': cle
    },
    body: form
  })
}

Deno.serve(async (req) => {
  const corps = await req.text()

  if (!(await signatureValide(corps, req.headers.get('stripe-signature')))) {
    return new Response('Signature invalide', { status: 400 })
  }

  const evenement = JSON.parse(corps)
  const types = ['checkout.session.completed', 'checkout.session.async_payment_succeeded']
  if (!types.includes(evenement.type)) return new Response('ignoré', { status: 200 })

  const session = evenement.data.object
  if (session.payment_status !== 'paid') return new Response('pas encore payé', { status: 200 })

  // 1) Création de la commande (idempotent : un événement rejoué ne crée rien en double)
  const rf = await rest('rpc/finaliser_paiement', {
    method: 'POST',
    body: JSON.stringify({ p_session_id: session.id, p_payment_intent: session.payment_intent })
  })

  if (!rf.ok) {
    const erreur = await rf.text()
    console.error('finaliser_paiement a échoué :', erreur)
    // Stock épuisé entre-temps : on rembourse automatiquement, inutile de réessayer.
    if (erreur.includes('Stock insuffisant') && session.payment_intent) {
      await rembourser(session.payment_intent, `remb-echec-${session.id}`)
      await rest(`paiements_en_attente?stripe_session_id=eq.${session.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ statut: 'rembourse_stock' })
      })
      return new Response('remboursé (stock)', { status: 200 })
    }
    // Autre erreur (temporaire ?) : Stripe réessaiera automatiquement.
    return new Response('erreur', { status: 500 })
  }

  const commandes = await rf.json()
  const commande = Array.isArray(commandes) ? commandes[0] : commandes
  if (!commande) return new Response('commande introuvable', { status: 500 })

  // 2) Email de confirmation, une seule fois (même si Stripe renvoie l'événement)
  const rc = await rest(
    `paiements_en_attente?stripe_session_id=eq.${session.id}&confirmation_envoyee=eq.false`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ confirmation_envoyee: true })
    }
  )
  const aEnvoyer = rc.ok ? await rc.json() : []
  if (aEnvoyer.length > 0 && commande.email) {
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
        adresse: commande.adresse
      })
    }).catch((e) => console.error('Email de confirmation :', e))
  }

  return new Response('ok', { status: 200 })
})
