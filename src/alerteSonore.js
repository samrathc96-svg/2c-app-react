// =========================================================
// Sonnerie d'alerte (fournisseur, livreur)
// =========================================================
// Petite sonnerie brève (deux notes) générée dans le navigateur : aucun
// fichier audio à héberger. Les navigateurs (surtout sur mobile) n'autorisent
// le son qu'après un premier geste de la personne (toucher, clic) : un
// écouteur discret "déverrouille" donc l'audio dès le premier contact avec
// la page. Sans ce geste, l'alerte reste visuelle (bandeau) sans erreur.

const CLE_ALERTE = 'alerteSonore2C'
let contexte = null

function obtenirContexte() {
  const ContexteAudio = window.AudioContext || window.webkitAudioContext
  if (!ContexteAudio) return null
  if (!contexte) contexte = new ContexteAudio()
  return contexte
}

export function deverrouillerAudio() {
  try {
    const c = obtenirContexte()
    if (c && c.state === 'suspended') c.resume()
  } catch (e) {
    // audio indisponible - on ignore silencieusement
  }
}

if (typeof window !== 'undefined') {
  const ouvrir = () => {
    deverrouillerAudio()
    ;['pointerdown', 'touchend', 'click', 'keydown'].forEach((nom) => window.removeEventListener(nom, ouvrir, true))
  }
  ;['pointerdown', 'touchend', 'click', 'keydown'].forEach((nom) => window.addEventListener(nom, ouvrir, true))
}

// Préférence de la personne (par appareil). Activée par défaut.
export function alerteSonoreActivee() {
  try {
    return window.localStorage.getItem(CLE_ALERTE) !== 'non'
  } catch (e) {
    return true
  }
}

export function definirAlerteSonore(active) {
  try {
    window.localStorage.setItem(CLE_ALERTE, active ? 'oui' : 'non')
  } catch (e) {
    // stockage indisponible - on ignore silencieusement
  }
}

function note(c, frequence, debut, duree) {
  const oscillateur = c.createOscillator()
  const gain = c.createGain()
  oscillateur.connect(gain)
  gain.connect(c.destination)
  oscillateur.type = 'sine'
  oscillateur.frequency.setValueAtTime(frequence, c.currentTime + debut)
  gain.gain.setValueAtTime(0.0001, c.currentTime + debut)
  gain.gain.exponentialRampToValueAtTime(0.35, c.currentTime + debut + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + debut + duree)
  oscillateur.start(c.currentTime + debut)
  oscillateur.stop(c.currentTime + debut + duree + 0.02)
}

// Sonnerie brève « ding-dong » (environ une demi-seconde).
export function jouerSonnerie() {
  try {
    const c = obtenirContexte()
    if (!c) return false
    if (c.state === 'suspended') c.resume()
    note(c, 880, 0, 0.28)
    note(c, 1175, 0.22, 0.4)
    return true
  } catch (e) {
    return false
  }
}
