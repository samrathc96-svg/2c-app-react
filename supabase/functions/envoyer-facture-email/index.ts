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

// ---------------------------------------------------------------------------
// Mise en page commune des emails 2C Delivery (même bloc dans chaque fonction).
// Le logo et le QR code sont servis par le site (dossier public/) :
//   /pwa-192x192.png et /qr-compte.png
// ---------------------------------------------------------------------------
const SITE = 'https://2cdelivery.ch'
const LIEN_COMPTE = `${SITE}/?compte=1`

// Ligne d'un tableau "libellé / valeur" (la valeur est du HTML déjà échappé).
function ligneTableau(libelle: string, valeurHtml: string): string {
  return `<tr>
    <td style="padding:10px 14px;border-bottom:1px solid #EFEAE0;color:#79705F;font-size:13px;width:36%;vertical-align:top;">${libelle}</td>
    <td style="padding:10px 14px;border-bottom:1px solid #EFEAE0;color:#1E1B17;font-size:14px;vertical-align:top;">${valeurHtml}</td>
  </tr>`
}

function gabarit(o: {
  titre: string
  intro: string
  lignes?: string[]
  blocs?: string
  note?: string
  // false = la personne a commandé sans compte : on lui propose d'en créer un.
  aUnCompte?: boolean
}): string {
  const blocCompte = o.aUnCompte === false
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F3EC;border-radius:12px;">
        <tr><td style="padding:16px 18px;">
          <div style="font-size:15px;font-weight:700;margin-bottom:4px;">Créez votre compte 2C <span style="font-weight:400;color:#79705F;font-size:12px;">(facultatif)</span></div>
          <div style="font-size:13px;color:#79705F;line-height:1.5;margin-bottom:12px;">À titre d'information : avec un compte gratuit, vous pouvez suivre vos commandes et retrouver toutes vos factures au même endroit.</div>
          <a href="${SITE}/?inscription=1" style="display:inline-block;background:#FF6A13;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:999px;">Créer mon compte</a>
        </td></tr>
      </table>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F3EC;border-radius:12px;">
        <tr>
          <td style="padding:16px 18px;vertical-align:middle;">
            <div style="font-size:15px;font-weight:700;margin-bottom:4px;">Votre espace 2C</div>
            <div style="font-size:13px;color:#79705F;line-height:1.5;margin-bottom:12px;">Suivez vos commandes et retrouvez vos factures depuis votre compte.</div>
            <a href="${LIEN_COMPTE}" style="display:inline-block;background:#FF6A13;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:999px;">Accéder à mon compte</a>
          </td>
          <td width="120" align="center" style="padding:12px 16px 12px 0;vertical-align:middle;">
            <img src="${SITE}/qr-compte.png" width="100" height="100" alt="QR code d'accès au compte" style="display:block;border-radius:6px;background:#FFFFFF;">
            <div style="font-size:10px;color:#79705F;margin-top:4px;">Sur ordinateur ?<br>Scannez avec votre téléphone</div>
          </td>
        </tr>
      </table>`
  const tableau = o.lignes && o.lignes.length > 0
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EFEAE0;border-radius:10px;border-collapse:separate;margin:18px 0;">${o.lignes.join('')}</table>`
    : ''
  const note = o.note
    ? `<p style="margin:16px 0 0;color:#79705F;font-size:13px;line-height:1.5;">${o.note}</p>`
    : ''
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F3EC;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F3EC;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:Arial,Helvetica,sans-serif;color:#1E1B17;">
    <tr><td style="background:#E8E3D8;border-radius:14px 14px 0 0;padding:18px 24px;border-bottom:4px solid #FF6A13;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:14px;"><img src="${SITE}/pwa-192x192.png" width="52" height="52" alt="2C" style="display:block;border-radius:10px;"></td>
        <td style="vertical-align:middle;">
          <div style="font-size:20px;font-weight:700;color:#1E1B17;">2C Delivery</div>
          <div style="font-size:12px;color:#79705F;">Du rayon au chantier, en un clic.</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#FFFFFF;padding:26px 24px 8px;">
      <h1 style="margin:0 0 10px;font-size:22px;line-height:1.3;color:#FF6A13;">${o.titre}</h1>
      <div style="font-size:15px;line-height:1.55;">${o.intro}</div>
      ${tableau}
      ${o.blocs ?? ''}
      ${note}
    </td></tr>
    <tr><td style="background:#FFFFFF;padding:8px 24px 26px;">
      ${blocCompte}
    </td></tr>
    <tr><td style="background:#E8E3D8;border-radius:0 0 14px 14px;padding:14px 24px;text-align:center;font-size:12px;color:#79705F;line-height:1.6;">
      2C Delivery · Genève · <a href="mailto:contact@2cdelivery.ch" style="color:#79705F;">contact@2cdelivery.ch</a><br>
      Besoin d'aide ? Répondez simplement à cet email.
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email, nomClient, numeroFacture, pdfBase64, copieEmail, mensuelle, periode, aUnCompte } = await req.json()

    if (!email || !pdfBase64) {
      return reponseJson({ error: 'Champs manquants' }, 400)
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const piece = {
      filename: `Facture_${String(numeroFacture ?? '').replace(/[^a-zA-Z0-9_-]/g, '')}.pdf`,
      content: pdfBase64
    }

    // Facture mensuelle (envoyée au responsable d'une entreprise)
    if (mensuelle === true) {
      const htmlMensuelle = gabarit({
        titre: 'Votre facture mensuelle',
        intro: `<p style="margin:0;">Bonjour ${echapper(nomClient)},<br>voici votre facture mensuelle 2C Delivery, en pièce jointe (PDF).</p>`,
        lignes: [
          ligneTableau('N° de facture', `<strong>${echapper(numeroFacture)}</strong>`),
          ligneTableau('Type', 'Facture mensuelle'),
          periode ? ligneTableau('Période', echapper(periode)) : '',
          ligneTableau('Contenu', 'Frais de livraison uniquement, avec le détail de chaque livraison et le contenu des commandes')
        ].filter(Boolean),
        note: "Les produits sont facturés séparément par le fournisseur."
      })
      const envoiMensuelle = await envoyerEmail(
        resendApiKey,
        email,
        `Facture mensuelle 2C – ${echapper(numeroFacture)}${periode ? ' – ' + echapper(periode) : ''}`,
        htmlMensuelle,
        piece
      )
      if (!envoiMensuelle.ok) {
        return reponseJson({ error: envoiMensuelle.resultat }, envoiMensuelle.status)
      }
      return reponseJson({ success: true, copieEnvoyee: false })
    }

    // 1) Facture au client (la personne qui a commandé)
    const htmlClient = gabarit({
      titre: 'Commande livrée !',
      intro: `<p style="margin:0;">Merci ${echapper(nomClient)}, votre commande vient d'être livrée. Votre facture est en pièce jointe (PDF).</p>`,
      lignes: [ligneTableau('N° de facture', `<strong>${echapper(numeroFacture)}</strong>`)],
      aUnCompte: aUnCompte !== false
    })
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
      const htmlCopie = gabarit({
        titre: 'Commande livrée',
        intro: `<p style="margin:0;">La commande passée au nom de votre entreprise par ${echapper(nomClient)} vient d'être livrée. La facture est en pièce jointe (PDF).</p>`,
        lignes: [ligneTableau('N° de facture', `<strong>${echapper(numeroFacture)}</strong>`)]
      })
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
