// =========================================================
// Sonnerie d'alerte (fournisseur, livreur)
// =========================================================
// Petite sonnerie brève (deux notes) générée dans le navigateur : aucun
// fichier audio à héberger. Elle est jouée comme un petit fichier audio
// (élément <audio>), ce que les téléphones acceptent beaucoup mieux que
// l'API Web Audio (sur iPhone, Web Audio est coupé par le bouton silencieux
// et souvent bloqué). Web Audio ne sert que de secours.
// Les navigateurs n'autorisent le son qu'après un premier geste de la
// personne (toucher, clic) : un écouteur discret « déverrouille » donc
// l'audio dès le premier contact avec la page.

const CLE_ALERTE = 'alerteSonore2C'
let contexte = null
let lecteur = null
let urlSon = null
let sonDemande = 0 // numéro de la dernière vraie sonnerie demandée

// --- Fabrication du son (fichier WAV créé en mémoire) -----------------
function fabriquerWav() {
  const frequenceEchantillon = 22050
  const duree = 0.75
  const total = Math.floor(frequenceEchantillon * duree)
  const donnees = new Int16Array(total)
  const notes = [
    { f: 880, debut: 0, duree: 0.3 },
    { f: 1175, debut: 0.22, duree: 0.5 }
  ]
  for (let i = 0; i < total; i++) {
    const t = i / frequenceEchantillon
    let valeur = 0
    notes.forEach((n) => {
      const local = t - n.debut
      if (local >= 0 && local < n.duree) {
        const attaque = Math.min(1, local / 0.012)
        const decroissance = Math.exp(-5 * (local / n.duree))
        valeur += Math.sin(2 * Math.PI * n.f * local) * attaque * decroissance
      }
    })
    donnees[i] = Math.max(-1, Math.min(1, valeur * 0.7)) * 32767
  }
  const tampon = new ArrayBuffer(44 + donnees.length * 2)
  const vue = new DataView(tampon)
  const ecrire = (position, texte) => {
    for (let i = 0; i < texte.length; i++) vue.setUint8(position + i, texte.charCodeAt(i))
  }
  ecrire(0, 'RIFF')
  vue.setUint32(4, 36 + donnees.length * 2, true)
  ecrire(8, 'WAVE')
  ecrire(12, 'fmt ')
  vue.setUint32(16, 16, true)
  vue.setUint16(20, 1, true)
  vue.setUint16(22, 1, true)
  vue.setUint32(24, frequenceEchantillon, true)
  vue.setUint32(28, frequenceEchantillon * 2, true)
  vue.setUint16(32, 2, true)
  vue.setUint16(34, 16, true)
  ecrire(36, 'data')
  vue.setUint32(40, donnees.length * 2, true)
  for (let i = 0; i < donnees.length; i++) vue.setInt16(44 + i * 2, donnees[i], true)
  return new Blob([tampon], { type: 'audio/wav' })
}

function obtenirLecteur() {
  if (lecteur) return lecteur
  try {
    urlSon = URL.createObjectURL(fabriquerWav())
    lecteur = new Audio(urlSon)
    lecteur.preload = 'auto'
    lecteur.setAttribute('playsinline', '')
  } catch (e) {
    lecteur = null
  }
  return lecteur
}

// --- Secours : Web Audio ---------------------------------------------
function obtenirContexte() {
  const ContexteAudio = window.AudioContext || window.webkitAudioContext
  if (!ContexteAudio) return null
  if (!contexte) contexte = new ContexteAudio()
  return contexte
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

function jouerAvecWebAudio() {
  try {
    const c = obtenirContexte()
    if (!c) return false
    if (c.state !== 'running') c.resume()
    note(c, 880, 0, 0.28)
    note(c, 1175, 0.22, 0.4)
    return true
  } catch (e) {
    return false
  }
}

// --- Déverrouillage au premier geste ----------------------------------
export function deverrouillerAudio() {
  try {
    const a = obtenirLecteur()
    if (a) {
      // Lecture muette dans le geste de la personne : le téléphone autorise
      // ensuite la sonnerie à se déclencher toute seule.
      const numero = sonDemande
      a.muted = true
      const promesse = a.play()
      const fin = () => {
        // Une vraie sonnerie a été demandée entre-temps : on ne la coupe pas.
        if (sonDemande !== numero) return
        a.pause()
        a.currentTime = 0
        a.muted = false
      }
      if (promesse && promesse.then) promesse.then(fin, () => { a.muted = false })
      else fin()
    }
  } catch (e) {
    // audio indisponible - on ignore silencieusement
  }
  try {
    const c = obtenirContexte()
    if (c && c.state !== 'running') c.resume()
  } catch (e) {
    // audio indisponible - on ignore silencieusement
  }
}

if (typeof window !== 'undefined') {
  const evenements = ['pointerdown', 'touchend', 'click', 'keydown']
  const ouvrir = () => {
    deverrouillerAudio()
    evenements.forEach((nom) => window.removeEventListener(nom, ouvrir, true))
  }
  evenements.forEach((nom) => window.addEventListener(nom, ouvrir, true))
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

// Sonnerie brève « ding-dong » (environ une demi-seconde).
// Renvoie une promesse : true si le son a démarré, false s'il est bloqué.
export function jouerSonnerie() {
  const a = obtenirLecteur()
  if (a) {
    try {
      sonDemande += 1
      a.muted = false
      a.currentTime = 0
      const promesse = a.play()
      if (promesse && promesse.then) {
        return promesse.then(
          () => true,
          () => jouerAvecWebAudio()
        )
      }
      return Promise.resolve(true)
    } catch (e) {
      // on tente le secours
    }
  }
  return Promise.resolve(jouerAvecWebAudio())
}
