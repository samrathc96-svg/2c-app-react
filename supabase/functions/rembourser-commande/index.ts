// Fonction : rembourser-commande
// Appelée par le site quand une commande est annulée. Elle ne rembourse
// QUE si la commande a bien été payée en ligne, est réellement au statut
// "Annulée" en base, et n'a pas déjà été remboursée — donc impossible de
// s'en servir pour se faire rembourser une commande non annulée.
// Comptes entreprise (la livraison seule est facturée) :
//   carte réservée -> la réservation est annulée (rien n'a été débité) ;
//   prépayé        -> les frais sont recrédités sur le solde ;
//   mensuel        -> la commande sort de l'encours.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { commande_id } = await req.json()
    const id = String(commande_id ?? '')
    if (!/^[0-9a-fA-F-]{1,40}$/.test(id)) return reponse({ error: 'Commande invalide.' }, 400)

    const rc = await rest(
      `commandes?id=eq.${id}&select=paye,rembourse,stripe_payment_intent,mode_paiement,paiement_statut`
    )
    const commande = rc.ok ? (await rc.json())[0] : null
    if (!commande) return reponse({ rembourse: false })

    const rk = await rest(`courses?commande_id=eq.${id}&select=statut`)
    const course = rk.ok ? (await rk.json())[0] : null
    if (!course || course.statut !== 'Annulée') return reponse({ rembourse: false })

    // --- Commandes entreprise ---
    if (commande.mode_paiement === 'prepaye' || commande.mode_paiement === 'mensuel') {
      const rl = await rest('rpc/liberer_paiement_commande', {
        method: 'POST',
        body: JSON.stringify({ p_commande_id: id })
      })
      if (!rl.ok) {
        console.error('liberer_paiement_commande :', await rl.text())
        return reponse({ error: 'La libération a échoué.' }, 500)
      }
      return reponse({ rembourse: false, libere: true, mode: commande.mode_paiement })
    }
    if (commande.mode_paiement === 'carte_entreprise' && commande.paiement_statut === 'autorise') {
      if (!commande.stripe_payment_intent) return reponse({ rembourse: false })
      const ra = await fetch(
        `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(commande.stripe_payment_intent)}/cancel`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${STRIPE_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Idempotency-Key': `annul-reservation-${id}`
          }
        }
      )
      if (!ra.ok) {
        console.error('Annulation de la réservation :', await ra.text())
        return reponse({ error: "L'annulation de la réservation a échoué." }, 502)
      }
      await rest(`commandes?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ paiement_statut: 'libere' })
      })
      return reponse({ rembourse: false, libere: true, mode: 'carte_entreprise' })
    }

    // --- Autres commandes : remboursement classique ---
    if (!commande.paye || commande.rembourse || !commande.stripe_payment_intent) {
      return reponse({ rembourse: false })
    }

    const form = new URLSearchParams()
    form.set('payment_intent', commande.stripe_payment_intent)
    const rr = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `remb-annulation-${id}`
      },
      body: form
    })
    if (!rr.ok) {
      console.error('Remboursement Stripe :', await rr.text())
      return reponse({ error: 'Le remboursement a échoué.' }, 502)
    }

    await rest(`commandes?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ rembourse: true, paiement_statut: 'rembourse' })
    })
    return reponse({ rembourse: true })
  } catch (e) {
    console.error('rembourser-commande :', e)
    return reponse({ error: 'Erreur inattendue.' }, 500)
  }
})
