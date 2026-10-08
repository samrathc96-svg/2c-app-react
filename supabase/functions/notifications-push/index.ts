// Fonction : notifications-push
// Notifications push « comme un SMS » (téléphone verrouillé, site fermé),
// sans aucune bibliothèque externe : protocole Web Push (RFC 8030, 8291,
// 8292) écrit avec les fonctions de chiffrement intégrées.
//
// Trois usages, selon le champ "action" du corps JSON :
//  * "cle"     : renvoie la clé publique d'envoi (VAPID) au navigateur qui
//                veut s'abonner. Les clés sont fabriquées automatiquement la
//                toute première fois et rangées dans la table push_config.
//                Appelable par toute personne connectée.
//  * "test"    : envoie une notification d'essai à TOUS LES APPAREILS DE LA
//                PERSONNE qui appelle (bouton « Tester » de l'espace).
//  * "envoyer" : envoi réel (nouvelle commande, nouvelle course...). Réservé
//                au serveur (clé "service role") : un appel venant du
//                navigateur est refusé. Destinataires : "userIds" (liste)
//                et/ou "audience": "livreurs" (livreurs disponibles).
//
// Les abonnements expirés (téléphone désinstallé, autorisation retirée)
// sont supprimés automatiquement.
//
// Prérequis : supabase/notifications_push.sql exécuté.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CONTACT_VAPID = 'mailto:contact@2cdelivery.ch'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

function reponseJson(corps: unknown, status = 200) {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

// ---------- Outils base64url / octets ----------

function versBase64Url(octets: Uint8Array): string {
  let texte = ''
  for (const o of octets) texte += String.fromCharCode(o)
  return btoa(texte).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function depuisBase64Url(texte: string): Uint8Array {
  const base = texte.replace(/-/g, '+').replace(/_/g, '/')
  const complete = base + '='.repeat((4 - (base.length % 4)) % 4)
  const binaire = atob(complete)
  const octets = new Uint8Array(binaire.length)
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i)
  return octets
}

function assembler(...parties: Uint8Array[]): Uint8Array {
  const total = parties.reduce((s, p) => s + p.length, 0)
  const resultat = new Uint8Array(total)
  let position = 0
  for (const p of parties) {
    resultat.set(p, position)
    position += p.length
  }
  return resultat
}

const encodeur = new TextEncoder()

// ---------- Accès base de données (clé service) ----------

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

// ---------- Clés d'envoi (VAPID) ----------

type ClesVapid = { publique: string; privee: JsonWebKey }

async function chargerCles(): Promise<ClesVapid | null> {
  const [ligne] = await lire('push_config?id=eq.1&select=cle_publique,cle_privee')
  if (!ligne) return null
  return { publique: ligne.cle_publique, privee: ligne.cle_privee }
}

async function obtenirCles(): Promise<ClesVapid> {
  const existantes = await chargerCles()
  if (existantes) return existantes

  // Première utilisation : on fabrique la paire de clés une fois pour toutes
  const paire = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', paire.privateKey)
  const publiqueBrute = assembler(
    new Uint8Array([4]),
    depuisBase64Url(jwk.x as string),
    depuisBase64Url(jwk.y as string)
  )
  const publique = versBase64Url(publiqueBrute)
  const reponse = await rest('push_config?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ id: 1, cle_publique: publique, cle_privee: jwk })
  })
  if (!reponse.ok) {
    throw new Error(`Clés push non enregistrées (SQL notifications_push.sql exécuté ?) : ${await reponse.text()}`)
  }
  // Deux appels simultanés : on relit pour utiliser la paire réellement conservée
  const finales = await chargerCles()
  if (!finales) throw new Error('Clés push introuvables après création')
  return finales
}

// Jeton d'identification du serveur (JWT ES256, RFC 8292)
async function jetonVapid(endpoint: string, cles: ClesVapid): Promise<string> {
  const audience = new URL(endpoint).origin
  const entete = versBase64Url(encodeur.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const contenu = versBase64Url(
    encodeur.encode(
      JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACT_VAPID })
    )
  )
  const cle = await crypto.subtle.importKey('jwk', cles.privee, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cle, encodeur.encode(`${entete}.${contenu}`))
  )
  return `${entete}.${contenu}.${versBase64Url(signature)}`
}

// ---------- Chiffrement du message (aes128gcm, RFC 8291) ----------

async function hkdf(sel: Uint8Array, secret: Uint8Array, info: Uint8Array, octets: number): Promise<Uint8Array> {
  const cle = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sel, info }, cle, octets * 8)
  )
}

// Paramètres facultatifs : valeurs imposées (uniquement pour les tests avec l'exemple officiel du RFC)
export async function chiffrerMessage(
  abonnement: { p256dh: string; auth: string },
  message: Uint8Array,
  imposes?: { sel?: Uint8Array; paireServeur?: CryptoKeyPair }
): Promise<Uint8Array> {
  const clePublTelephone = depuisBase64Url(abonnement.p256dh)
  const secretAuth = depuisBase64Url(abonnement.auth)

  const paireServeur =
    imposes?.paireServeur ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']))
  const publiqueServeur = new Uint8Array(await crypto.subtle.exportKey('raw', paireServeur.publicKey))
  const publiqueTelephone = await crypto.subtle.importKey(
    'raw',
    clePublTelephone,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )
  const secretPartage = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: publiqueTelephone }, paireServeur.privateKey, 256)
  )

  const sel = imposes?.sel ?? crypto.getRandomValues(new Uint8Array(16))
  const infoCle = assembler(encodeur.encode('WebPush: info\0'), clePublTelephone, publiqueServeur)
  const materiel = await hkdf(secretAuth, secretPartage, infoCle, 32)
  const cleContenu = await hkdf(sel, materiel, encodeur.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(sel, materiel, encodeur.encode('Content-Encoding: nonce\0'), 12)

  // Un seul bloc : message + octet de fin 0x02
  const clair = assembler(message, new Uint8Array([2]))
  const cleAes = await crypto.subtle.importKey('raw', cleContenu, 'AES-GCM', false, ['encrypt'])
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cleAes, clair))

  const tailleBloc = new Uint8Array(4)
  new DataView(tailleBloc.buffer).setUint32(0, 4096, false)
  return assembler(sel, tailleBloc, new Uint8Array([publiqueServeur.length]), publiqueServeur, chiffre)
}

// ---------- Envoi ----------

type Abonnement = { id: string; endpoint: string; p256dh: string; auth: string }
type Message = { titre: string; corps: string; url?: string; tag?: string }

async function envoyerA(abonnement: Abonnement, message: Message, cles: ClesVapid, urgence: string) {
  const corps = await chiffrerMessage(abonnement, encodeur.encode(JSON.stringify(message)))
  const jeton = await jetonVapid(abonnement.endpoint, cles)
  const reponse = await fetch(abonnement.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jeton}, k=${cles.publique}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '14400', // le message attend jusqu'à 4 h si le téléphone est éteint
      Urgency: urgence
    },
    body: corps
  })
  return reponse.status
}

async function envoyerAUtilisateurs(userIds: string[], message: Message, urgence = 'high') {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (ids.length === 0) return { envoyes: 0, expires: 0, echecs: 0 }
  const liste = ids.map((i) => `"${i.replace(/"/g, '')}"`).join(',')
  const abonnements: Abonnement[] = await lire(
    `push_abonnements?user_id=in.(${encodeURIComponent(liste)})&select=id,endpoint,p256dh,auth`
  )
  if (abonnements.length === 0) return { envoyes: 0, expires: 0, echecs: 0 }

  const cles = await obtenirCles()
  let envoyes = 0
  let expires = 0
  let echecs = 0
  await Promise.all(
    abonnements.map(async (a) => {
      try {
        const statut = await envoyerA(a, message, cles, urgence)
        if (statut >= 200 && statut < 300) {
          envoyes++
        } else if (statut === 404 || statut === 410) {
          expires++
          await rest(`push_abonnements?id=eq.${encodeURIComponent(a.id)}`, { method: 'DELETE' })
        } else {
          echecs++
          console.error('Push refusé :', statut, a.endpoint.slice(0, 60))
        }
      } catch (e) {
        echecs++
        console.error('Push impossible :', e)
      }
    })
  )
  return { envoyes, expires, echecs }
}

async function livreursDisponibles(): Promise<string[]> {
  const lignes = await lire('profils?role=eq.livreur&or=(disponible.is.null,disponible.eq.true)&select=id')
  return lignes.map((l) => String(l.id))
}

// Personne connectée à partir de son jeton (appel navigateur)
async function utilisateurDuJeton(autorisation: string): Promise<string | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: autorisation }
    })
    if (!r.ok) return null
    const u = await r.json()
    return typeof u?.id === 'string' ? u.id : null
  } catch (_e) {
    return null
  }
}

function nettoyerMessage(brut: any): Message {
  const texte = (v: unknown, max: number) => String(v ?? '').slice(0, max)
  const url = typeof brut?.url === 'string' && brut.url.startsWith('/') ? brut.url : '/'
  return {
    titre: texte(brut?.titre, 80) || '2C Delivery',
    corps: texte(brut?.corps, 240),
    url,
    ...(brut?.tag ? { tag: texte(brut.tag, 60) } : {})
  }
}

export async function traiter(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (SERVICE_KEY === '') return reponseJson({ error: 'Configuration serveur incomplète' }, 500)

  const autorisation = req.headers.get('Authorization') ?? ''
  if (!autorisation.startsWith('Bearer ')) return reponseJson({ error: 'Non autorisé' }, 401)

  try {
    const corps = await req.json().catch(() => ({}))
    const action = corps?.action

    if (action === 'cle') {
      const utilisateur = await utilisateurDuJeton(autorisation)
      if (!utilisateur) return reponseJson({ error: 'Connexion requise' }, 401)
      const cles = await obtenirCles()
      return reponseJson({ cle: cles.publique })
    }

    if (action === 'test') {
      const utilisateur = await utilisateurDuJeton(autorisation)
      if (!utilisateur) return reponseJson({ error: 'Connexion requise' }, 401)
      const resultat = await envoyerAUtilisateurs(
        [utilisateur],
        { titre: '2C Delivery', corps: 'Test réussi : vous recevrez ici vos nouvelles commandes.', url: '/', tag: 'test-push' },
        'normal'
      )
      return reponseJson({ success: true, ...resultat })
    }

    if (action === 'envoyer') {
      // Appel serveur uniquement
      if (autorisation !== `Bearer ${SERVICE_KEY}`) return reponseJson({ error: 'Non autorisé' }, 401)
      const destinataires: string[] = Array.isArray(corps.userIds) ? corps.userIds.map(String) : []
      if (corps.audience === 'livreurs') destinataires.push(...(await livreursDisponibles()))
      const resultat = await envoyerAUtilisateurs(destinataires, nettoyerMessage(corps))
      return reponseJson({ success: true, ...resultat })
    }

    return reponseJson({ error: 'Action inconnue' }, 400)
  } catch (erreur) {
    console.error('notifications-push :', erreur)
    return reponseJson({ error: (erreur as Error).message }, 500)
  }
}

Deno.serve(traiter)
