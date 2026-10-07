// Fonction : encaisser-livraison
// Appelée par le site quand le livreur a validé une livraison. Si la commande
// est une commande entreprise "carte réservée", elle DÉBITE la carte (capture
// de la réservation faite à la commande). Sans effet pour les autres cas.
//
// Sécurité : seuls un livreur ou un admin connecté peuvent l'appeler, et
// uniquement si la course est réellement au statut "Livrée" en base.
// Secret requis : STRIPE_SECRET_KEY.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

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

async function roleDeLUtilisateur(req: Request): Promise<string | null> {
  const jeton = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  if (!jeton) return null
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${jeton}` }
  })
  if (!r.ok) return null
  const u = await r.json()
  if (!u?.id) return null
  const rp = await rest(`profils?id=eq.${encodeURIComponent(u.id)}&select=role`)
  const p = rp.ok ? (await rp.json())[0] : null
  return p?.role ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const role = await roleDeLUtilisateur(req)
    if (role !== 'livreur' && role !== 'admin') return reponse({ error: 'Accès refusé.' }, 403)

    const { commande_id } = await req.json()
    const id = String(commande_id ?? '')
    if (!/^[0-9a-fA-F-]{1,40}$/.test(id)) return reponse({ error: 'Commande invalide.' }, 400)

    const rc = await rest(`commandes?id=eq.${id}&select=mode_paiement,paiement_statut,stripe_payment_intent,frais_livraison`)
    const commande = rc.ok ? (await rc.json())[0] : null
    if (!commande || commande.mode_paiement !== 'carte_entreprise') return reponse({ encaisse: false })
    if (commande.paiement_statut === 'capture') return reponse({ encaisse: true, deja: true })
    if (commande.paiement_statut !== 'autorise' && commande.paiement_statut !== 'echec_capture') {
      return reponse({ encaisse: false })
    }
    if (!commande.stripe_payment_intent) return reponse({ encaisse: false })

    const rk = await rest(`courses?commande_id=eq.${id}&select=statut`)
    const course = rk.ok ? (await rk.json())[0] : null
    if (!course || course.statut !== 'Livrée') return reponse({ encaisse: false })

    const rr = await fetch(
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(commande.stripe_payment_intent)}/capture`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${STRIPE_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': `capture-${id}`
        }
      }
    )
    if (!rr.ok) {
      console.error('Capture Stripe :', await rr.text())
      await rest(`commandes?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ paiement_statut: 'echec_capture' })
      })
      return reponse({ encaisse: false, echec: true }, 200)
    }

    await rest(`commandes?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ paye: true, paye_le: new Date().toISOString(), paiement_statut: 'capture' })
    })
    return reponse({ encaisse: true })
  } catch (e) {
    console.error('encaisser-livraison :', e)
    return reponse({ error: 'Erreur inattendue.' }, 500)
  }
})
