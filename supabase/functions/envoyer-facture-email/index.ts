// Fonction : envoyer-facture-email
// Envoie la facture (PDF déjà généré côté app) par email, via Resend.
// Appelée automatiquement depuis App.jsx (envoyerFactureAutomatique) dès que
// le statut d'une course passe à "Livrée".
//
// Nouveauté (comptes entreprise) : si "copieEmail" est fourni (email du
// responsable de l'entreprise), il reçoit la même facture en copie.
// L'envoi au client n'est jamais bloqué par un échec de la copie.
//
// Secret requis : RESEND_API_KEY (déjà en place).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

// Évite qu'un texte saisi par un client ne casse ou détourne l'email
function echapper(texte: unknown): string {
  return String(texte ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function reponseJson(corps: unknown, status = 200) {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

async function envoyerEmail(
  cleResend: string | undefined,
  destinataire: string,
  sujet: string,
  html: string,
  piece: { filename: string; content: string }
) {
  const reponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cleResend}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: '2C Delivery <factures@2cdelivery.ch>',
      reply_to: 'contact@2cdelivery.ch',
      to: [destinataire],
      subject: sujet,
      html,
      attachments: [piece]
    })
  })
  const resultat = await reponse.json()
  return { ok: reponse.ok, status: reponse.status, resultat }
}

const PIED = `
  <p style="margin-top: 30px; color: #79705F; font-size: 13px;">
    — L'équipe 2C<br>
    Du rayon au chantier, en un clic.
  </p>
`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email, nomClient, numeroFacture, pdfBase64, copieEmail } = await req.json()

    if (!email || !pdfBase64) {
      return reponseJson({ error: 'Champs manquants' }, 400)
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const piece = {
      filename: `Facture_${String(numeroFacture ?? '').replace(/[^a-zA-Z0-9_-]/g, '')}.pdf`,
      content: pdfBase64
    }

    // 1) Facture au client (la personne qui a commandé)
    const htmlClient = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1E1B17;">
        <h2 style="color: #FF6A13;">Commande livrée !</h2>
        <p>Merci ${echapper(nomClient)}, votre commande vient d'être livrée.</p>
        <p>Vous trouverez votre facture (n° ${echapper(numeroFacture)}) en pièce jointe.</p>
        ${PIED}
      </div>
    `
    const envoiClient = await envoyerEmail(
      resendApiKey,
      email,
      `Votre facture 2C – ${echapper(numeroFacture)}`,
      htmlClient,
      piece
    )
    if (!envoiClient.ok) {
      return reponseJson({ error: envoiClient.resultat }, envoiClient.status)
    }

    // 2) Copie au responsable de l'entreprise, si renseignée et différente
    let copieEnvoyee = false
    const copie = copieEmail ? String(copieEmail).trim() : ''
    if (copie && copie.toLowerCase() !== String(email).trim().toLowerCase()) {
      const htmlCopie = `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1E1B17;">
          <h2 style="color: #FF6A13;">Commande livrée</h2>
          <p>La commande passée au nom de votre entreprise par ${echapper(nomClient)} vient d'être livrée.</p>
          <p>Vous trouverez la facture (n° ${echapper(numeroFacture)}) en pièce jointe.</p>
          ${PIED}
        </div>
      `
      const envoiCopie = await envoyerEmail(
        resendApiKey,
        copie,
        `Facture 2C – ${echapper(numeroFacture)} (copie)`,
        htmlCopie,
        piece
      )
      copieEnvoyee = envoiCopie.ok
      if (!envoiCopie.ok) {
        console.error('Copie de la facture non envoyée :', envoiCopie.resultat)
      }
    }

    return reponseJson({ success: true, copieEnvoyee })
  } catch (erreur) {
    return reponseJson({ error: (erreur as Error).message }, 500)
  }
})
