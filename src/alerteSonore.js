// =========================================================
// Sonnerie d'alerte (fournisseur, livreur) — iPhone, Android, ordinateur
// =========================================================
// Petite sonnerie brève (deux notes) fabriquée dans le navigateur : aucun
// fichier audio à héberger. Elle est jouée comme un petit fichier audio
// (élément <audio>), que les téléphones acceptent mieux que Web Audio.
// L'API Web Audio ne sert que de secours.
//
// Règles des téléphones, en particulier Safari sur iPhone :
//  * aucun son sans geste de la personne : le déblocage doit se faire pendant
//    un vrai toucher (événements "touchend" ou "click", pas "pointerdown") ;
//  * un élément audio déjà « lu » pendant un geste peut ensuite être relancé
//    tout seul : on joue donc la sonnerie une fois pendant le geste (sa
//    première milliseconde est silencieuse) puis on l'arrête aussitôt ;
//  * la lecture muette ne débloque rien sur iPhone : on ne l'utilise pas ;
//  * après une mise en veille ou un retour sur l'application, le déblocage
//    peut être perdu : l'écouteur reste donc actif et se réarme au toucher.

const CLE_ALERTE = 'alerteSonore2C'
let contexte = null
let lecteur = null
let audioDebloque = false
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
    donnees[i] = Math.max(-1, Math.min(1, valeur * 0.8)) * 32767
  }
  const octets = new Uint8Array(44 + donnees.length * 2)
  const vue = new DataView(octets.buffer)
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
  return octets
}

// Adresse « data: » (plus fiable que blob: sur Safari iPhone)
function enAdresseData(octets) {
  let texte = ''
  const paquet = 0x8000
  for (let i = 0; i < octets.length; i += paquet) {
    texte += String.fromCharCode.apply(null, octets.subarray(i, i + paquet))
  }
  return 'data:audio/wav;base64,' + btoa(texte)
}

// Sur iPhone/iPad, un élément <audio> fait apparaître le lecteur de musique du
// téléphone (écran verrouillé, centre de contrôle) : on n'y utilise que Web Audio.
function estIphoneOuIpad() {
  try {
    const ua = navigator.userAgent || ''
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  } catch (e) {
    return false
  }
}

function obtenirLecteur() {
  if (lecteur) return lecteur
  if (estIphoneOuIpad()) return null
  try {
    lecteur = new Audio()
    lecteur.preload = 'auto'
    lecteur.setAttribute('playsinline', '')
    lecteur.setAttribute('webkit-playsinline', '')
    lecteur.src = enAdresseData(fabriquerWav())
    lecteur.load()
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
  gain.gain.exponentialRampToValueAtTime(0.4, c.currentTime + debut + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + debut + duree)
  oscillateur.start(c.currentTime + debut)
  oscillateur.stop(c.currentTime + debut + duree + 0.02)
}

function contexteEnMarche() {
  return Boolean(contexte && contexte.state === 'running')
}

function jouerAvecWebAudio() {
  try {
    const c = obtenirContexte()
    if (!c) return false
    if (c.state !== 'running') c.resume()
    if (c.state !== 'running') return false
    note(c, 880, 0, 0.28)
    note(c, 1175, 0.22, 0.4)
    return true
  } catch (e) {
    return false
  }
}

// --- Déblocage pendant un geste de la personne ------------------------
export function deverrouillerAudio() {
  try {
    const a = obtenirLecteur()
    if (a && !audioDebloque) {
      const numero = sonDemande
      const promesse = a.play()
      const fin = () => {
        audioDebloque = true
        // Une vraie sonnerie a été demandée entre-temps : on ne la coupe pas.
        if (sonDemande !== numero) return
        a.pause()
        a.currentTime = 0
      }
      if (promesse && promesse.then) promesse.then(fin, () => {})
      else fin()
    }
  } catch (e) {
    // audio indisponible - on ignore silencieusement
  }
  try {
    const c = obtenirContexte()
    if (c) {
      if (c.state !== 'running') c.resume()
      // courte lecture silencieuse : c'est elle qui débloque Web Audio sur iPhone
      const source = c.createBufferSource()
      source.buffer = c.createBuffer(1, 1, 22050)
      source.connect(c.destination)
      source.start(0)
    }
  } catch (e) {
    // audio indisponible - on ignore silencieusement
  }
}

if (typeof window !== 'undefined') {
  // "touchend" et "click" seulement : sur iPhone, "pointerdown" et
  // "touchstart" ne comptent pas comme un geste. L'écouteur reste actif
  // pour se réarmer après une mise en veille.
  const auToucher = () => {
    if (!audioDebloque || (contexte && contexte.state !== 'running')) deverrouillerAudio()
  }
  ;['touchend', 'click', 'keydown'].forEach((nom) => window.addEventListener(nom, auToucher, true))
}

// État pour l'affichage : « pret » ou « attente » (un toucher est nécessaire)
export function etatSon() {
  return audioDebloque || contexteEnMarche() ? 'pret' : 'attente'
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
  // Android : petite vibration en plus (non pris en charge sur iPhone)
  try {
    if (navigator.vibrate) navigator.vibrate([180, 80, 180])
  } catch (e) {
    // vibration indisponible - on ignore
  }
  const a = obtenirLecteur()
  if (a) {
    try {
      sonDemande += 1
      a.currentTime = 0
      const promesse = a.play()
      if (promesse && promesse.then) {
        return promesse.then(
          () => {
            audioDebloque = true
            return true
          },
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
