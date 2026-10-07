// Fonction : stripe-webhook
// Appelée PAR STRIPE (pas par le site) quand un paiement est réussi.
// Vérifie que le message vient bien de Stripe (signature), puis crée la
// commande, puis envoie l'email de confirmation (avec le code de livraison, et
// un bon de commande en copie au responsable pour un compte entreprise).
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

// Carte RÉSERVÉE (comptes entreprise) : Stripe ne marque pas la session comme
// "paid" tant que le montant n'est pas encaissé. On vérifie directement
// l'autorisation auprès de Stripe.
async function autorisationValide(paymentIntent: string): Promise<boolean> {
  try {
    const r = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntent)}`, {
      headers: { Authorization: `Bearer ${STRIPE_KEY}` }
    })
    if (!r.ok) return false
    const pi = await r.json()
    return pi.status === 'requires_capture' || pi.status === 'succeeded'
  } catch (_e) {
    return false
  }
}

async function annulerAutorisation(paymentIntent: string, cle: string) {
  return fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntent)}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': cle
    }
  })
}

// Lecture simple d'une liste via l'API REST (clé serveur). Renvoie [] en cas de souci.
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

// Informations ajoutées à l'email de confirmation : code de livraison de la
// commande, et, pour un compte entreprise, chantier / personne qui commande
// et email du responsable (qui reçoit le bon de commande en copie).
// Tout est facultatif : en cas d'échec, l'email part quand même, sans ces ajouts.
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

Deno.serve(async (req) => {
  const corps = await req.text()

  if (!(await signatureValide(corps, req.headers.get('stripe-signature')))) {
    return new Response('Signature invalide', { status: 400 })
  }

  const evenement = JSON.parse(corps)
  const types = ['checkout.session.completed', 'checkout.session.async_payment_succeeded']
  if (!types.includes(evenement.type)) return new Response('ignoré', { status: 200 })

  const session = evenement.data.object
  const carteReservee = session.metadata?.mode_paiement === 'carte_entreprise'
  if (session.payment_status !== 'paid') {
    const autorisee = carteReservee && session.payment_intent && (await autorisationValide(session.payment_intent))
    if (!autorisee) return new Response('pas encore payé', { status: 200 })
  }

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
      if (carteReservee) {
        await annulerAutorisation(session.payment_intent, `annul-echec-${session.id}`)
      } else {
        await rembourser(session.payment_intent, `remb-echec-${session.id}`)
      }
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
        ...(commande.mode_paiement === 'carte_entreprise'
          ? { fraisLivraison: commande.frais_livraison, modePaiement: 'carte_entreprise' }
          : {}),
        ...infos
      })
    }).catch((e) => console.error('Email de confirmation :', e))
  }

  return new Response('ok', { status: 200 })
})
