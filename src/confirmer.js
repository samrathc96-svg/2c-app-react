// Fenêtre de confirmation du site (remplace window.confirm).
//
// Les fenêtres natives du navigateur sont parfois bloquées (navigateur intégré
// de l'application, option « ne plus afficher de fenêtres », certaines
// applications installées) : le clic sur « Supprimer » ne faisait alors rien.
// Ici la confirmation est dessinée par le site, aux couleurs de 2C Delivery.
//
// Utilisation : if (!(await confirmer('Supprimer ce produit ?'))) return
// Options : { oui: 'Supprimer', non: 'Annuler', danger: true }

export function confirmer(message, options = {}) {
  const { oui = 'Confirmer', non = 'Annuler', danger = true } = options

  return new Promise((resolve) => {
    const voile = document.createElement('div')
    voile.className = 'confirmation-voile'
    voile.setAttribute('role', 'presentation')

    const boite = document.createElement('div')
    boite.className = 'confirmation-boite'
    boite.setAttribute('role', 'alertdialog')
    boite.setAttribute('aria-modal', 'true')
    boite.setAttribute('aria-label', message)

    const texte = document.createElement('p')
    texte.className = 'confirmation-message'
    texte.textContent = message

    const actions = document.createElement('div')
    actions.className = 'confirmation-actions'

    const boutonNon = document.createElement('button')
    boutonNon.type = 'button'
    boutonNon.className = 'confirmation-non'
    boutonNon.textContent = non

    const boutonOui = document.createElement('button')
    boutonOui.type = 'button'
    boutonOui.className = danger ? 'confirmation-oui confirmation-danger' : 'confirmation-oui'
    boutonOui.textContent = oui

    actions.append(boutonNon, boutonOui)
    boite.append(texte, actions)
    voile.append(boite)

    function fermer(reponse) {
      document.removeEventListener('keydown', surTouche, true)
      voile.remove()
      resolve(reponse)
    }

    function surTouche(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        fermer(false)
      }
    }

    boutonNon.addEventListener('click', () => fermer(false))
    boutonOui.addEventListener('click', () => fermer(true))
    // Un clic à côté de la fenêtre = annuler (jamais confirmer par accident).
    voile.addEventListener('click', (e) => {
      if (e.target === voile) fermer(false)
    })
    document.addEventListener('keydown', surTouche, true)

    document.body.append(voile)
    // Le focus démarre sur « Annuler » : un Entrée distrait ne supprime rien.
    boutonNon.focus()
  })
}
