// Fonction : envoyer-candidature
// Reçoit une candidature « Devenir livreur » ou « Devenir partenaire »
// (formulaire public du site, sans compte) et :
//   1) l'envoie par email à 2C (contact@2cdelivery.ch), avec « Répondre » qui
//      écrit directement au candidat ;
//   2) envoie un accusé de réception au candidat.
// Rien n'est créé dans la base : si 2C accepte, elle envoie au candidat son
// lien d'inscription (https://2cdelivery.ch/?livreur ou /?fournisseur).
//
// Protections : types autorisés, longueurs limitées, texte échappé, champ piège
// (robots), délai minimum de remplissage (1,5 s), quelques envois par heure et par adresse IP.
//
// Secret requis : RESEND_API_KEY (déjà en place).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const SITE = 'https://2cdelivery.ch'
const ADRESSE_2C = 'contact@2cdelivery.ch'
const EXPEDITEUR = '2C Delivery <candidatures@2cdelivery.ch>'

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

// Texte saisi : nettoyé, sans retour à la ligne parasite, longueur limitée
function texte(valeur: unknown, max: number): string {
  return String(valeur ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max)
}

function emailValide(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 160
}

// Limite d'envois par adresse IP (best effort : mémoire de l'instance en cours)
const envoisParIp = new Map<string, number[]>()
function tropDEnvois(ip: string): boolean {
  const maintenant = Date.now()
  const recents = (envoisParIp.get(ip) ?? []).filter((t) => maintenant - t < 3600_000)
  if (recents.length >= 5) {
    envoisParIp.set(ip, recents)
    return true
  }
  recents.push(maintenant)
  envoisParIp.set(ip, recents)
  return false
}

async function envoyerEmail(cle: string | undefined, corps: Record<string, unknown>) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corps)
  })
  return { ok: r.ok, status: r.status, resultat: await r.json().catch(() => ({})) }
}

function ligne(libelle: string, valeurHtml: string): string {
  return `<tr>
    <td style="padding:10px 14px;border-bottom:1px solid #EFEAE0;color:#79705F;font-size:13px;width:34%;vertical-align:top;">${libelle}</td>
    <td style="padding:10px 14px;border-bottom:1px solid #EFEAE0;color:#1E1B17;font-size:14px;vertical-align:top;">${valeurHtml}</td>
  </tr>`
}

function gabarit(titre: string, introHtml: string, lignes: string[], noteHtml = ''): string {
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
    <tr><td style="background:#FFFFFF;padding:26px 24px 22px;">
      <h1 style="margin:0 0 10px;font-size:22px;line-height:1.3;color:#FF6A13;">${titre}</h1>
      <div style="font-size:15px;line-height:1.55;">${introHtml}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EFEAE0;border-radius:10px;border-collapse:separate;margin:18px 0 0;">${lignes.join('')}</table>
      ${noteHtml}
    </td></tr>
    <tr><td style="background:#E8E3D8;border-radius:0 0 14px 14px;padding:14px 24px;text-align:center;font-size:12px;color:#79705F;line-height:1.6;">
      2C Delivery · Genève · <a href="mailto:${ADRESSE_2C}" style="color:#79705F;">${ADRESSE_2C}</a>
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
  if (req.method !== 'POST') {
    return reponseJson({ error: 'Méthode non autorisée' }, 405)
  }

  try {
    const corps = await req.json()
    const type = corps.type === 'livreur' || corps.type === 'partenaire' ? corps.type : null
    if (!type) return reponseJson({ error: 'Type de candidature invalide' }, 400)

    // Robots : champ piège rempli, ou formulaire envoyé en moins de 1,5 seconde.
    // On répond « succès » sans rien envoyer pour ne pas les renseigner.
    if (texte(corps.piege, 50) !== '' || Number(corps.duree_ms) < 1500) {
      return reponseJson({ success: true })
    }

    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'inconnue'
    if (tropDEnvois(ip)) {
      return reponseJson({ error: 'Trop de candidatures envoyées, réessayez plus tard.' }, 429)
    }

    const nom = texte(corps.nom, 120)
    const email = texte(corps.email, 160).toLowerCase()
    const telephone = texte(corps.telephone, 30)
    const message = texte(corps.message, 1000)
    if (!nom || !emailValide(email) || telephone.replace(/\D/g, '').length < 8) {
      return reponseJson({ error: 'Champs manquants ou invalides' }, 400)
    }

    const estLivreur = type === 'livreur'
    const lignes: string[] = []
    let societe = ''
    if (estLivreur) {
      const ville = texte(corps.ville, 80)
      const moyen = texte(corps.moyen, 40)
      if (!ville || !moyen || corps.conditions !== true) {
        return reponseJson({ error: 'Champs manquants ou invalides' }, 400)
      }
      lignes.push(ligne('Nom', `<strong>${echapper(nom)}</strong>`))
      lignes.push(ligne('Email', `<a href="mailto:${echapper(email)}" style="color:#FF6A13;">${echapper(email)}</a>`))
      lignes.push(ligne('Téléphone', echapper(telephone)))
      lignes.push(ligne('Ville', echapper(ville)))
      lignes.push(ligne('Moyen de livraison', echapper(moyen)))
      const dispo = texte(corps.disponibilites, 60)
      if (!dispo) return reponseJson({ error: 'Champs manquants ou invalides' }, 400)
      lignes.push(ligne('Disponibilités', echapper(dispo)))
      lignes.push(ligne('Conditions', "Confirme avoir une pièce d'identité valide et un casier judiciaire vierge"))
    } else {
      societe = texte(corps.societe, 120)
      const adresse = texte(corps.adresse, 160)
      const activite = texte(corps.activite, 160)
      if (!societe || !adresse || !activite) {
        return reponseJson({ error: 'Champs manquants ou invalides' }, 400)
      }
      lignes.push(ligne('Société', `<strong>${echapper(societe)}</strong>`))
      lignes.push(ligne('Contact', echapper(nom)))
      lignes.push(ligne('Email', `<a href="mailto:${echapper(email)}" style="color:#FF6A13;">${echapper(email)}</a>`))
      lignes.push(ligne('Téléphone', echapper(telephone)))
      lignes.push(ligne('Point de retrait', echapper(adresse)))
      lignes.push(ligne('Produits proposés', echapper(activite)))
      const site = texte(corps.siteWeb, 160)
      if (site) lignes.push(ligne('Site web', echapper(site)))
    }
    if (message) lignes.push(ligne('Message', echapper(message).replace(/\n/g, '<br>')))

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const libelleType = estLivreur ? 'livreur' : 'partenaire (fournisseur)'
    const lienInscription = estLivreur ? `${SITE}/?livreur` : `${SITE}/?fournisseur`

    // 1) Email à 2C : « Répondre » écrit au candidat
    const aDeuxC = await envoyerEmail(resendApiKey, {
      from: EXPEDITEUR,
      to: [ADRESSE_2C],
      reply_to: email,
      subject: `Candidature ${estLivreur ? 'livreur' : 'partenaire'} – ${estLivreur ? nom : societe}`,
      html: gabarit(
        `Nouvelle candidature ${libelleType}`,
        `<p style="margin:0;">Une candidature vient d'arriver depuis le site. Répondez à cet email pour écrire directement au candidat.</p>`,
        lignes,
        `<p style="margin:16px 0 0;color:#79705F;font-size:13px;line-height:1.5;">Pour l'accepter, envoyez-lui son lien d'inscription : <a href="${lienInscription}" style="color:#FF6A13;">${lienInscription}</a>. Son compte restera « en attente » jusqu'à votre validation dans l'espace admin.</p>`
      )
    })
    if (!aDeuxC.ok) {
      console.error('Candidature non transmise à 2C :', aDeuxC.resultat)
      return reponseJson({ error: "L'envoi a échoué" }, 502)
    }

    // 2) Accusé de réception au candidat (un échec ici ne bloque rien)
    const accuse = await envoyerEmail(resendApiKey, {
      from: EXPEDITEUR,
      to: [email],
      reply_to: ADRESSE_2C,
      subject: 'Nous avons bien reçu votre candidature – 2C Delivery',
      html: gabarit(
        'Candidature reçue',
        `<p style="margin:0;">Bonjour ${echapper(nom.split(' ')[0])}, merci pour votre candidature ${estLivreur ? 'de livreur' : 'de partenaire'} chez 2C Delivery. Nous l'étudions et revenons vers vous par email dans les prochains jours.</p>`,
        lignes.slice(0, 1).concat(estLivreur ? [] : [ligne('Contact', echapper(nom))]),
        `<p style="margin:16px 0 0;color:#79705F;font-size:13px;line-height:1.5;">Si votre candidature est retenue, nous vous enverrons votre lien d'inscription personnel. Aucun compte n'a été créé à ce stade.</p>`
      )
    })
    if (!accuse.ok) console.error("Accusé de réception non envoyé :", accuse.resultat)

    return reponseJson({ success: true })
  } catch (erreur) {
    return reponseJson({ error: (erreur as Error).message }, 500)
  }
})
