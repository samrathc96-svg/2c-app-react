// Fonction : envoyer-bon-commande-fournisseur
// Envoie à chaque FOURNISSEUR concerné par une commande un email "bon de
// commande" : ce qu'il doit préparer (ses produits uniquement), pour qui
// (client / entreprise / chantier) et où (adresse de livraison).
//
// Appelée uniquement par le serveur (webhook Stripe, creer-paiement) avec la
// clé "service role" : un appel venant du navigateur est refusé.
//
// Le lien commande -> fournisseur se fait par le produit (produits.fournisseur).
// Seuls les fournisseurs ayant un compte VALIDÉ (fournisseur_comptes) sont
// prévenus par email ; l'email part à l'adresse de leur compte.
// Chaque fournisseur ne reçoit qu'un seul email par commande (table
// commande_fournisseur_prepa), même si la fonction est appelée deux fois.
//
// En plus de l'email, la fonction envoie des notifications push (téléphone
// verrouillé, comme un SMS) : au fournisseur concerné (commande à préparer)
// et à tous les livreurs disponibles (nouvelle course). Ces envois sont
// facultatifs : si les notifications push ne sont pas installées, la commande
// et les emails ne sont pas affectés.
//
// Prérequis : supabase/commandes_fournisseur.sql exécuté
// (et supabase/notifications_push.sql + fonction notifications-push pour le push).
// Secret requis : RESEND_API_KEY (déjà en place).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const EXPEDITEUR = '2C Delivery <commandes@2cdelivery.ch>'
const REPONDRE_A = 'contact@2cdelivery.ch'
const SITE = 'https://2cdelivery.ch'

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
    headers: { 'Content-Type': 'application/json' }
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

async function lire(chemin: string): Promise<any[]> {
  try {
    const r = await rest(chemin)
    if (!r.ok) {
      console.error('Lecture impossible :', chemin, await r.text())
      return []
    }
    const donnees = await r.json()
    return Array.isArray(donnees) ? donnees : []
  } catch (e) {
    console.error('Lecture impossible :', chemin, e)
    return []
  }
}

// Notification push (facultative) via la fonction notifications-push
async function pousser(corps: Record<string, unknown>) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/notifications-push`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'envoyer', ...corps })
    })
    if (!r.ok) console.error('Notification push non envoyée :', r.status, await r.text().catch(() => ''))
  } catch (e) {
    console.error('Notification push non envoyée :', e)
  }
}

// Email du compte (Supabase Auth) d'un utilisateur
async function emailDuCompte(userId: string): Promise<string | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    })
    if (!r.ok) return null
    const u = await r.json()
    return typeof u?.email === 'string' && u.email ? u.email : null
  } catch (_e) {
    return null
  }
}

async function envoyerEmail(destinataire: string, sujet: string, html: string) {
  const reponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
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
  const resultat = await reponse.json().catch(() => ({}))
  return { ok: reponse.ok, resultat }
}

function chf(n: number): string {
  return `${(Math.round(n * 100) / 100).toFixed(2)} CHF`
}

function ligneInfo(libelle: string, valeurHtml: string): string {
  return `<tr>
    <td style="padding:10px 14px;border-bottom:1px solid #EFEAE0;color:#79705F;font-size:13px;width:34%;vertical-align:top;">${libelle}</td>
    <td style="padding:10px 14px;border-bottom:1px solid #EFEAE0;color:#1E1B17;font-size:14px;vertical-align:top;">${valeurHtml}</td>
  </tr>`
}

type Ligne = { nom: string; reference: string | null; quantite: number; prix: number }

function gabaritFournisseur(o: { fournisseur: string; infos: string[]; lignes: Ligne[]; numero: string }): string {
  const total = o.lignes.reduce((s, l) => s + l.quantite * l.prix, 0)
  const cellule = 'padding:9px 10px;border-bottom:1px solid #EFEAE0;font-size:13px;vertical-align:top;'
  const lignesProduits = o.lignes
    .map(
      (l) => `<tr>
        <td style="${cellule}color:#79705F;">${echapper(l.reference ?? '')}</td>
        <td style="${cellule}">${echapper(l.nom)}</td>
        <td style="${cellule}text-align:center;"><strong>${l.quantite}</strong></td>
        <td style="${cellule}text-align:right;white-space:nowrap;">${chf(l.prix)}</td>
        <td style="${cellule}text-align:right;white-space:nowrap;">${chf(l.quantite * l.prix)}</td>
      </tr>`
    )
    .join('')
  const entete = 'padding:8px 10px;background:#F6F3EC;font-size:11px;color:#79705F;text-transform:uppercase;letter-spacing:.04em;'

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F3EC;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F3EC;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:Arial,Helvetica,sans-serif;color:#1E1B17;">
    <tr><td style="background:#E8E3D8;border-radius:14px 14px 0 0;padding:18px 24px;border-bottom:4px solid #FF6A13;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:14px;"><img src="${SITE}/pwa-192x192.png" width="52" height="52" alt="2C" style="display:block;border-radius:10px;"></td>
        <td style="vertical-align:middle;">
          <div style="font-size:20px;font-weight:700;color:#1E1B17;">2C Delivery</div>
          <div style="font-size:12px;color:#79705F;">Espace fournisseur</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#FFFFFF;padding:26px 24px 8px;">
      <h1 style="margin:0 0 10px;font-size:22px;line-height:1.3;color:#FF6A13;">Nouvelle commande à préparer</h1>
      <div style="font-size:15px;line-height:1.55;">
        <p style="margin:0;">Bonjour ${echapper(o.fournisseur)}, une commande contenant vos produits vient d'être passée. Un livreur 2C passera la récupérer chez vous.</p>
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EFEAE0;border-radius:10px;border-collapse:separate;margin:18px 0 8px;">
        ${o.infos.join('')}
      </table>

      <div style="font-size:13px;font-weight:700;margin:16px 0 6px;">À préparer</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EFEAE0;border-radius:10px;border-collapse:separate;overflow:hidden;">
        <tr>
          <td style="${entete}">Réf.</td>
          <td style="${entete}">Produit</td>
          <td style="${entete}text-align:center;">Qté</td>
          <td style="${entete}text-align:right;">Prix</td>
          <td style="${entete}text-align:right;">Total</td>
        </tr>
        ${lignesProduits}
        <tr>
          <td colspan="4" style="padding:10px;text-align:right;font-size:13px;color:#79705F;">Total de vos produits</td>
          <td style="padding:10px;text-align:right;font-size:14px;"><strong>${chf(total)}</strong></td>
        </tr>
      </table>

      <p style="margin:16px 0 0;color:#79705F;font-size:13px;line-height:1.5;">
        Merci d'indiquer le <strong>n° ${echapper(o.numero)}</strong> sur le colis, puis de marquer la commande comme
        « préparée » dans votre espace fournisseur.
      </p>
    </td></tr>
    <tr><td style="background:#FFFFFF;padding:8px 24px 26px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F3EC;border-radius:12px;">
        <tr><td style="padding:16px 18px;">
          <div style="font-size:15px;font-weight:700;margin-bottom:4px;">Votre espace fournisseur</div>
          <div style="font-size:13px;color:#79705F;line-height:1.5;margin-bottom:12px;">Retrouvez toutes vos commandes, imprimez le bon et indiquez quand c'est prêt.</div>
          <a href="${SITE}/?compte=1" style="display:inline-block;background:#FF6A13;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:999px;">Ouvrir mon espace</a>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="background:#E8E3D8;border-radius:0 0 14px 14px;padding:14px 24px;text-align:center;font-size:12px;color:#79705F;line-height:1.6;">
      2C Delivery · Genève · <a href="mailto:contact@2cdelivery.ch" style="color:#79705F;">contact@2cdelivery.ch</a><br>
      Une question ? Répondez simplement à cet email.
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
}

Deno.serve(async (req) => {
  // Appel serveur uniquement
  if (SERVICE_KEY === '' || req.headers.get('Authorization') !== `Bearer ${SERVICE_KEY}`) {
    return reponseJson({ error: 'Non autorisé' }, 401)
  }

  try {
    const { commandeId } = await req.json()
    if (commandeId === undefined || commandeId === null || commandeId === '') {
      return reponseJson({ error: 'commandeId manquant' }, 400)
    }
    const id = encodeURIComponent(String(commandeId))

    const [commande] = await lire(
      `commandes?id=eq.${id}&select=id,numero_suivi,produits_detail,nom_client,adresse,chantier,technicien,user_id,created_at`
    )
    if (!commande) return reponseJson({ error: 'Commande introuvable' }, 404)

    // Les livreurs disponibles sont prévenus d'une nouvelle course (push)
    await pousser({
      audience: 'livreurs',
      titre: 'Nouvelle course disponible',
      corps: String(commande.adresse ?? '').slice(0, 120),
      url: '/',
      tag: `course-${commande.id}`
    })

    const detail: any[] = Array.isArray(commande.produits_detail) ? commande.produits_detail : []
    const idsProduits = [...new Set(detail.map((l) => l?.id).filter((v) => v !== undefined && v !== null))]
    if (idsProduits.length === 0) return reponseJson({ success: true, envoyes: 0 })

    const liste = idsProduits.map((v) => `"${String(v).replace(/"/g, '')}"`).join(',')
    const produits = await lire(
      `produits?id=in.(${encodeURIComponent(liste)})&select=id,nom,fournisseur,reference,prix`
    )
    const parId = new Map(produits.map((p) => [String(p.id), p]))

    // Lignes de la commande regroupées par fournisseur
    const parFournisseur = new Map<string, Ligne[]>()
    for (const l of detail) {
      const p = parId.get(String(l?.id))
      if (!p || !p.fournisseur) continue
      const ligne: Ligne = {
        nom: String(p.nom ?? l.nom ?? ''),
        reference: p.reference ?? null,
        quantite: Number(l.quantite ?? 1) || 1,
        prix: Number(l.prix ?? p.prix ?? 0) || 0
      }
      parFournisseur.set(p.fournisseur, [...(parFournisseur.get(p.fournisseur) ?? []), ligne])
    }
    if (parFournisseur.size === 0) return reponseJson({ success: true, envoyes: 0 })

    // Entreprise du client (si la commande vient d'un compte entreprise)
    let nomEntreprise = ''
    if (commande.user_id) {
      const [membre] = await lire(
        `entreprise_membres?user_id=eq.${encodeURIComponent(commande.user_id)}&select=entreprises(nom)&limit=1`
      )
      if (membre) {
        nomEntreprise = Array.isArray(membre.entreprises) ? membre.entreprises[0]?.nom ?? '' : membre.entreprises?.nom ?? ''
      }
    }

    const numero = String(commande.numero_suivi ?? commande.id)
    const date = commande.created_at
      ? new Date(commande.created_at).toLocaleString('fr-CH', { timeZone: 'Europe/Zurich', dateStyle: 'short', timeStyle: 'short' })
      : ''

    const infos = [
      ligneInfo('N° de commande', `<strong>${echapper(numero)}</strong>`),
      date ? ligneInfo('Passée le', echapper(date)) : '',
      ligneInfo('Client', echapper(commande.nom_client)),
      nomEntreprise ? ligneInfo('Entreprise', echapper(nomEntreprise)) : '',
      commande.chantier ? ligneInfo('Chantier', echapper(commande.chantier)) : '',
      commande.technicien ? ligneInfo('Commandé par', echapper(commande.technicien)) : '',
      ligneInfo('Livraison à', echapper(commande.adresse))
    ].filter(Boolean)

    let envoyes = 0
    const ignores: string[] = []

    for (const [nomFournisseur, lignes] of parFournisseur) {
      const [compte] = await lire(
        `fournisseur_comptes?nom_fournisseur=eq.${encodeURIComponent(nomFournisseur)}&statut=eq.valide&select=user_id&limit=1`
      )
      if (!compte) {
        ignores.push(`${nomFournisseur} (pas de compte fournisseur validé)`)
        continue
      }
      const adresseEmail = await emailDuCompte(compte.user_id)
      if (!adresseEmail) {
        ignores.push(`${nomFournisseur} (email introuvable)`)
        continue
      }

      // Un seul email par commande et par fournisseur
      const cle = {
        commande_id: String(commande.id),
        fournisseur: nomFournisseur,
        bon_envoye_le: new Date().toISOString()
      }
      const rr = await rest('commande_fournisseur_prepa?on_conflict=commande_id,fournisseur', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(cle)
      })
      const crees = rr.ok ? await rr.json() : null
      if (!rr.ok) {
        console.error('commande_fournisseur_prepa :', await rr.text().catch(() => ''))
        ignores.push(`${nomFournisseur} (SQL commandes_fournisseur.sql non exécuté ?)`)
        continue
      }
      if (Array.isArray(crees) && crees.length === 0) continue // déjà envoyé

      // Notification push au fournisseur (en plus de l'email)
      await pousser({
        userIds: [compte.user_id],
        titre: 'Nouvelle commande à préparer',
        corps: [numero, nomEntreprise || commande.nom_client, `${lignes.length} produit${lignes.length > 1 ? 's' : ''}`]
          .filter(Boolean)
          .join(' · '),
        url: '/?ouvrir=commandes',
        tag: `commande-${commande.id}`
      })

      const html = gabaritFournisseur({ fournisseur: nomFournisseur, infos, lignes, numero })
      const envoi = await envoyerEmail(adresseEmail, `Nouvelle commande à préparer – ${numero}`, html)
      if (envoi.ok) {
        envoyes++
      } else {
        console.error('Bon de commande fournisseur non envoyé :', nomFournisseur, envoi.resultat)
        // On libère la place pour permettre un nouvel essai
        await rest(
          `commande_fournisseur_prepa?commande_id=eq.${encodeURIComponent(String(commande.id))}&fournisseur=eq.${encodeURIComponent(nomFournisseur)}&prepare_le=is.null`,
          { method: 'DELETE' }
        )
        ignores.push(`${nomFournisseur} (échec d'envoi)`)
      }
    }

    return reponseJson({ success: true, envoyes, ignores })
  } catch (erreur) {
    return reponseJson({ error: (erreur as Error).message }, 500)
  }
})
