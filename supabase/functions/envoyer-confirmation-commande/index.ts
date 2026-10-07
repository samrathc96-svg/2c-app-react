// Fonction : envoyer-confirmation-commande
// Envoie par email, via Resend, la confirmation de commande juste après sa
// création. Appelée par le webhook Stripe (jamais depuis le navigateur pour
// les champs sensibles) sans exposer la clé Resend.
//
// Nouveautés (comptes entreprise) :
//  * le client (la personne qui commande) reçoit en plus son CODE DE
//    LIVRAISON à donner au livreur ;
//  * le responsable de l'entreprise reçoit en copie un BON DE COMMANDE,
//    SANS le code de livraison.
// Ces deux champs ne sont pris en compte que si l'appel vient du serveur
// (clé "service role") : un appel venant du navigateur reçoit l'ancien
// email simple, sans code ni copie.
//
// Secret requis : RESEND_API_KEY (déjà en place).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const EXPEDITEUR = '2C Delivery <commandes@2cdelivery.ch>'
const REPONDRE_A = 'contact@2cdelivery.ch'

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

async function envoyerEmail(cleResend: string | undefined, destinataire: string, sujet: string, html: string) {
  const reponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cleResend}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: EXPEDITEUR,
      reply_to: REPONDRE_A,
      to: [destinataire],
      subject: sujet,
      html
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
    const {
      email,
      nomClient,
      produits,
      total,
      numeroSuivi,
      adresse,
      codeLivraison,
      chantier,
      technicien,
      nomEntreprise,
      emailResponsable
    } = await req.json()

    if (!email) {
      return reponseJson({ error: 'Email manquant' }, 400)
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY')

    // Les champs sensibles (code, copie) ne sont acceptés que d'un appel serveur.
    const cleServeur = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const appelServeur = cleServeur !== '' && req.headers.get('Authorization') === `Bearer ${cleServeur}`
    const code = appelServeur && codeLivraison ? String(codeLivraison) : ''
    const copieVers = appelServeur && emailResponsable ? String(emailResponsable).trim() : ''

    const blocCode = code
      ? `
        <div style="margin: 22px 0; padding: 16px; border: 2px dashed #FF6A13; border-radius: 12px; text-align: center;">
          <div style="font-size: 13px; color: #79705F;">Code de livraison</div>
          <div style="font-size: 36px; font-weight: 700; letter-spacing: 10px; margin: 6px 0;">${echapper(code)}</div>
          <div style="font-size: 12px; color: #79705F;">
            À donner au livreur uniquement quand vous avez votre commande en main.
            Ne le communiquez à personne d'autre.
          </div>
        </div>
      `
      : ''

    const detailsEntreprise =
      (nomEntreprise ? `<p><strong>Entreprise :</strong> ${echapper(nomEntreprise)}</p>` : '') +
      (chantier ? `<p><strong>Chantier :</strong> ${echapper(chantier)}</p>` : '') +
      (technicien ? `<p><strong>Commandé par :</strong> ${echapper(technicien)}</p>` : '')

    // 1) Email au client (la personne qui commande)
    const htmlClient = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1E1B17;">
        <h2 style="color: #FF6A13;">Merci pour votre commande, ${echapper(nomClient)} !</h2>
        <p>Votre commande a bien été enregistrée chez 2C.</p>
        ${detailsEntreprise}
        <p><strong>Produits :</strong> ${echapper(produits)}</p>
        <p><strong>Adresse de livraison :</strong> ${echapper(adresse)}</p>
        <p><strong>Total :</strong> ${Number(total).toFixed(2)} CHF</p>
        <p><strong>Numéro de suivi :</strong> ${echapper(numeroSuivi)}</p>
        ${blocCode}
        <p>Vous pouvez suivre l'avancement de votre livraison à tout moment depuis le site, via le menu ☰ → "Suivre ma commande".</p>
        ${PIED}
      </div>
    `

    const envoiClient = await envoyerEmail(
      resendApiKey,
      email,
      `Commande confirmée – ${echapper(numeroSuivi)}`,
      htmlClient
    )
    if (!envoiClient.ok) {
      return reponseJson({ error: envoiClient.resultat }, envoiClient.status)
    }

    // 2) Bon de commande au responsable de l'entreprise (sans le code)
    let copieEnvoyee = false
    if (copieVers && copieVers.toLowerCase() !== String(email).trim().toLowerCase()) {
      const htmlBon = `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1E1B17;">
          <h2 style="color: #FF6A13;">Bon de commande</h2>
          <p>Une commande vient d'être passée au nom de votre entreprise.</p>
          <p><strong>Numéro de suivi :</strong> ${echapper(numeroSuivi)}</p>
          ${detailsEntreprise}
          <p><strong>Produits :</strong> ${echapper(produits)}</p>
          <p><strong>Adresse de livraison :</strong> ${echapper(adresse)}</p>
          <p><strong>Total :</strong> ${Number(total).toFixed(2)} CHF</p>
          <p style="color: #79705F; font-size: 13px;">
            Le code de livraison a été remis uniquement à la personne qui a passé la commande.
            Vous recevrez la facture par email une fois la livraison effectuée.
          </p>
          ${PIED}
        </div>
      `
      const sujetBon = `Bon de commande – ${echapper(numeroSuivi)}${chantier ? ` – ${echapper(chantier)}` : ''}`
      const envoiBon = await envoyerEmail(resendApiKey, copieVers, sujetBon, htmlBon)
      copieEnvoyee = envoiBon.ok
      if (!envoiBon.ok) {
        // Ne bloque jamais la confirmation du client : on note juste l'incident.
        console.error('Bon de commande non envoyé :', envoiBon.resultat)
      }
    }

    return reponseJson({ success: true, copieEnvoyee })
  } catch (erreur) {
    return reponseJson({ error: (erreur as Error).message }, 500)
  }
})
