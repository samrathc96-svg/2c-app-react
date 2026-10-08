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
}): string {
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
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F3EC;border-radius:12px;">
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
      </table>
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
      emailResponsable,
      fraisLivraison,
      modePaiement
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

    // Compte entreprise : 2C ne facture que la livraison ; les produits sont
    // facturés à part par le fournisseur.
    const frais = appelServeur && fraisLivraison !== undefined && fraisLivraison !== null ? Number(fraisLivraison) : null
    const libellesPaiement: Record<string, string> = {
      carte_entreprise: 'carte bancaire réservée, débitée à la livraison',
      prepaye: 'prélevée sur votre solde prépayé',
      mensuel: 'facturée dans la facture mensuelle'
    }
    const libellePaiement = frais !== null ? libellesPaiement[String(modePaiement ?? '')] ?? '' : ''
    const lignesMontant = frais !== null
      ? [
          ligneTableau('Valeur des produits', `${Number(total).toFixed(2)} CHF <span style="color:#79705F;font-size:12px;">(facturée séparément par le fournisseur)</span>`),
          ligneTableau('Livraison 2C', `<strong>${frais.toFixed(2)} CHF</strong>${libellePaiement ? ` <span style="color:#79705F;font-size:12px;">(${echapper(libellePaiement)})</span>` : ''}`)
        ]
      : [ligneTableau('Total', `<strong>${Number(total).toFixed(2)} CHF</strong>`)]

    const blocCode = code
      ? `
        <div style="margin: 18px 0; padding: 16px; border: 2px dashed #FF6A13; border-radius: 12px; text-align: center; background: #FFF7F0;">
          <div style="font-size: 13px; color: #79705F;">Code de livraison</div>
          <div style="font-size: 36px; font-weight: 700; letter-spacing: 10px; margin: 6px 0;">${echapper(code)}</div>
          <div style="font-size: 12px; color: #79705F;">
            À donner au livreur uniquement quand vous avez votre commande en main.
            Ne le communiquez à personne d'autre.
          </div>
        </div>
      `
      : ''

    const lignesEntreprise = [
      nomEntreprise ? ligneTableau('Entreprise', echapper(nomEntreprise)) : '',
      chantier ? ligneTableau('Chantier', echapper(chantier)) : '',
      technicien ? ligneTableau('Commandé par', echapper(technicien)) : ''
    ].filter(Boolean)

    // 1) Email au client (la personne qui commande)
    const htmlClient = gabarit({
      titre: `Merci pour votre commande, ${echapper(nomClient)} !`,
      intro: '<p style="margin:0;">Votre commande a bien été enregistrée chez 2C. Voici le récapitulatif :</p>',
      lignes: [
        ligneTableau('N° de suivi', `<strong>${echapper(numeroSuivi)}</strong>`),
        ...lignesEntreprise,
        ligneTableau('Produits', echapper(produits)),
        ligneTableau('Adresse de livraison', echapper(adresse)),
        ...lignesMontant
      ],
      blocs: blocCode,
      note: `Vous pouvez suivre l'avancement de votre livraison à tout moment depuis le site, via le menu ☰ → « Suivre ma commande ».`
    })

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
      const htmlBon = gabarit({
        titre: 'Bon de commande',
        intro: "<p style=\"margin:0;\">Une commande vient d'être passée au nom de votre entreprise.</p>",
        lignes: [
          ligneTableau('N° de suivi', `<strong>${echapper(numeroSuivi)}</strong>`),
          ...lignesEntreprise,
          ligneTableau('Produits', echapper(produits)),
          ligneTableau('Adresse de livraison', echapper(adresse)),
          ...lignesMontant
        ],
        note: "Le code de livraison a été remis uniquement à la personne qui a passé la commande. Vous recevrez la facture par email une fois la livraison effectuée."
      })
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
