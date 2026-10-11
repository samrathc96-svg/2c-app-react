// Recharge le site tout seul quand une nouvelle version vient d'être installée.
//
// Sans cela, après chaque mise en ligne, le navigateur gardait l'ancienne
// version à la première visite (la nouvelle n'apparaissait qu'au rechargement
// suivant). Ici, dès que la nouvelle version prend le relais, la page se
// recharge : on évite de couper quelqu'un en train d'écrire (champ en cours de
// saisie) en attendant qu'il quitte le champ ou change d'onglet.
//
// À importer une seule fois (voir App.jsx).

let installe = false

export function rechargerSiMiseAJour() {
  if (installe) return
  installe = true
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  // Première installation du service worker : rien à recharger.
  const avaitUneVersion = Boolean(navigator.serviceWorker.controller)
  if (!avaitUneVersion) return

  let enAttente = false
  let dejaRecharge = false

  function recharger() {
    if (dejaRecharge) return
    dejaRecharge = true
    window.location.reload()
  }

  function quelquUnEcrit() {
    const actif = document.activeElement
    if (!actif) return false
    const balise = (actif.tagName || '').toLowerCase()
    return balise === 'input' || balise === 'textarea' || balise === 'select' || actif.isContentEditable === true
  }

  function essayer() {
    if (!enAttente || dejaRecharge) return
    if (document.visibilityState === 'hidden' || !quelquUnEcrit()) recharger()
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    enAttente = true
    essayer()
  })
  // Quand la personne quitte le champ ou l'onglet, on peut recharger sans rien perdre.
  document.addEventListener('focusout', () => setTimeout(essayer, 300))
  document.addEventListener('visibilitychange', essayer)
}
