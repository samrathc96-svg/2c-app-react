import { supabase } from './supabaseClient'

// =========================================================
// Notifications push (téléphone verrouillé, comme un SMS)
// =========================================================
// Le navigateur s'abonne auprès de son service de notification (Apple,
// Google...) ; l'abonnement est enregistré dans Supabase (fonction SQL
// push_enregistrer). Le serveur (fonction notifications-push) envoie ensuite
// les alertes. Sur iPhone, cela ne marche qu'une fois le site ajouté à
// l'écran d'accueil (règle d'Apple).

const CLE_LOCALE = 'push2C'

function estIphoneOuIpad() {
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function estInstalleSurEcranAccueil() {
  try {
    return navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches
  } catch (e) {
    return false
  }
}

// Vrai si cet appareil a activé les notifications (sert à éviter les doublons dans la page)
export function pushActifLocalement() {
  try {
    return window.localStorage.getItem(CLE_LOCALE) === 'oui'
  } catch (e) {
    return false
  }
}

function memoriser(actif) {
  try {
    window.localStorage.setItem(CLE_LOCALE, actif ? 'oui' : 'non')
  } catch (e) {
    // stockage indisponible - on ignore
  }
}

function enOctets(base64Url) {
  const base = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const binaire = atob(base + '='.repeat((4 - (base.length % 4)) % 4))
  const octets = new Uint8Array(binaire.length)
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i)
  return octets
}

async function trouverEnregistrement() {
  if (!('serviceWorker' in navigator)) return null
  const existant = await navigator.serviceWorker.getRegistration()
  if (existant) return existant
  // Le service worker s'installe au chargement de la page : on lui laisse quelques secondes
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), 4000))
  ])
}

// État à afficher : 'iphone-installer' | 'non-supporte' | 'refuse' | 'inactif' | 'active'
export async function etatNotifications() {
  if (estIphoneOuIpad() && !estInstalleSurEcranAccueil()) return 'iphone-installer'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    return 'non-supporte'
  }
  if (Notification.permission === 'denied') return 'refuse'
  try {
    const enregistrement = await trouverEnregistrement()
    const abonnement = enregistrement ? await enregistrement.pushManager.getSubscription() : null
    if (!abonnement) {
      memoriser(false)
      return 'inactif'
    }
    const { data, error } = await supabase.rpc('push_mon_etat', { p_endpoint: abonnement.endpoint })
    if (error) return 'active' // pas de réponse du serveur : on garde l'état local
    memoriser(Boolean(data))
    return data ? 'active' : 'inactif'
  } catch (e) {
    return 'inactif'
  }
}

// À appeler depuis un clic (les navigateurs l'exigent pour demander l'autorisation)
export async function activerNotifications() {
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return { ok: false, message: 'Notifications refusées. Vous pouvez les autoriser dans les réglages du téléphone.' }
    }
    const enregistrement = await trouverEnregistrement()
    if (!enregistrement) {
      return { ok: false, message: "Le site n'est pas encore prêt pour les notifications : rechargez la page et réessayez." }
    }
    const { data, error } = await supabase.functions.invoke('notifications-push', { body: { action: 'cle' } })
    if (error || !data || !data.cle) {
      console.error('Clé push indisponible :', error)
      return { ok: false, message: "Les notifications ne sont pas encore disponibles côté serveur." }
    }
    let abonnement = await enregistrement.pushManager.getSubscription()
    if (!abonnement) {
      abonnement = await enregistrement.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: enOctets(data.cle)
      })
    }
    const cles = abonnement.toJSON().keys || {}
    const { error: erreurSql } = await supabase.rpc('push_enregistrer', {
      p_endpoint: abonnement.endpoint,
      p_p256dh: cles.p256dh,
      p_auth: cles.auth,
      p_appareil: navigator.userAgent
    })
    if (erreurSql) {
      console.error("Enregistrement de l'abonnement :", erreurSql)
      return { ok: false, message: "L'activation a échoué (base de données). Réessayez plus tard." }
    }
    memoriser(true)
    return { ok: true, message: 'Notifications activées sur cet appareil.' }
  } catch (e) {
    console.error('Activation des notifications :', e)
    return { ok: false, message: "L'activation a échoué. Vérifiez la connexion et réessayez." }
  }
}

export async function desactiverNotifications() {
  try {
    const enregistrement = await trouverEnregistrement()
    const abonnement = enregistrement ? await enregistrement.pushManager.getSubscription() : null
    if (abonnement) {
      await supabase.rpc('push_supprimer', { p_endpoint: abonnement.endpoint })
      await abonnement.unsubscribe()
    }
    memoriser(false)
    return { ok: true, message: 'Notifications désactivées sur cet appareil.' }
  } catch (e) {
    console.error('Désactivation des notifications :', e)
    return { ok: false, message: 'La désactivation a échoué, réessayez.' }
  }
}

// Envoie une notification d'essai à tous les appareils de la personne connectée
export async function envoyerNotificationTest() {
  const { data, error } = await supabase.functions.invoke('notifications-push', { body: { action: 'test' } })
  if (error || !data) return { ok: false, message: "L'envoi du test a échoué." }
  if (!data.envoyes) return { ok: false, message: "Aucun appareil n'a reçu le test : désactivez puis réactivez les notifications." }
  return { ok: true, message: 'Test envoyé : la notification arrive dans quelques secondes.' }
}

// À appeler à la déconnexion : retire CET appareil des notifications de la
// personne qui part. Sans cela, l'appareil resterait abonné à son compte et
// continuerait à recevoir ses alertes (commande à préparer, course à
// récupérer...) même une fois déconnecté.
// À appeler AVANT la fermeture de session (la fonction push_supprimer exige
// d'être connecté) ; push_oublier_appareil sert de filet de sécurité.
export async function oublierCetAppareil() {
  try {
    if (!('serviceWorker' in navigator)) return
    const enregistrement = await trouverEnregistrement()
    const abonnement = enregistrement ? await enregistrement.pushManager.getSubscription() : null
    if (abonnement) {
      try {
        await supabase.rpc('push_supprimer', { p_endpoint: abonnement.endpoint })
      } catch (e) {
        // pas connecté / réseau : on tente le filet de sécurité ci-dessous
      }
      try {
        await supabase.rpc('push_oublier_appareil', { p_endpoint: abonnement.endpoint })
      } catch (e) {
        // fonction SQL pas encore installée : sans gravité
      }
      await abonnement.unsubscribe()
    }
  } catch (e) {
    console.error("Retrait de l'appareil des notifications :", e)
  } finally {
    memoriser(false)
  }
}
