import { useEffect, useState } from 'react'
import {
  activerNotifications,
  desactiverNotifications,
  envoyerNotificationTest,
  etatNotifications
} from './notificationsPush'

// Bloc « Recevoir les alertes sur ce téléphone » (fournisseur, livreur).
// Explique aussi la marche à suivre sur iPhone (ajout à l'écran d'accueil).
export function ActivationNotifications({ notifier, sujet }) {
  const [etat, setEtat] = useState(null)
  const [occupe, setOccupe] = useState(false)

  async function actualiser() {
    setEtat(await etatNotifications())
  }

  useEffect(() => {
    actualiser()
  }, [])

  async function lancer(action) {
    setOccupe(true)
    try {
      const resultat = await action()
      notifier(resultat.message, resultat.ok ? 'info' : 'erreur')
      await actualiser()
    } finally {
      setOccupe(false)
    }
  }

  if (etat === null) return null

  return (
    <div className={`bloc-notifications bloc-notifications-${etat}`}>
      {etat === 'active' && (
        <>
          <p className="notifs-titre">
            <i className="bi bi-bell-fill"></i> Notifications activées sur cet appareil
          </p>
          <p className="notifs-texte">Vous êtes prévenu {sujet}, même téléphone verrouillé ou site fermé.</p>
          <div className="notifs-actions">
            <button className="bouton-secondaire" disabled={occupe} onClick={() => lancer(envoyerNotificationTest)}>
              <i className="bi bi-send"></i> Envoyer un test
            </button>
            <button className="bouton-secondaire" disabled={occupe} onClick={() => lancer(desactiverNotifications)}>
              Désactiver
            </button>
          </div>
        </>
      )}

      {etat === 'inactif' && (
        <>
          <p className="notifs-titre">
            <i className="bi bi-bell"></i> Recevoir une notification sur ce téléphone
          </p>
          <p className="notifs-texte">Comme un SMS : vous êtes prévenu {sujet}, même téléphone verrouillé ou site fermé.</p>
          <div className="notifs-actions">
            <button className="valider" disabled={occupe} onClick={() => lancer(activerNotifications)}>
              Activer les notifications
            </button>
          </div>
        </>
      )}

      {etat === 'iphone-installer' && (
        <>
          <p className="notifs-titre">
            <i className="bi bi-phone"></i> Notifications sur iPhone
          </p>
          <p className="notifs-texte">Apple l'exige : ajoutez d'abord 2C Delivery à l'écran d'accueil.</p>
          <ol className="notifs-etapes">
            <li>Dans Safari, touchez le bouton <strong>Partager</strong> (le carré avec une flèche).</li>
            <li>Choisissez <strong>« Sur l'écran d'accueil »</strong>, puis <strong>Ajouter</strong>.</li>
            <li>Ouvrez <strong>2C</strong> depuis l'icône de l'écran d'accueil, reconnectez-vous et revenez ici pour activer les notifications.</li>
          </ol>
        </>
      )}

      {etat === 'refuse' && (
        <>
          <p className="notifs-titre">
            <i className="bi bi-bell-slash"></i> Notifications bloquées
          </p>
          <p className="notifs-texte">
            Autorisez les notifications de 2C Delivery dans les réglages du téléphone ou du navigateur, puis rechargez la page.
          </p>
        </>
      )}

      {etat === 'non-supporte' && (
        <>
          <p className="notifs-titre">
            <i className="bi bi-bell-slash"></i> Notifications indisponibles
          </p>
          <p className="notifs-texte">
            Ce navigateur ne gère pas les notifications. Utilisez Chrome (Android), Safari depuis l'écran d'accueil (iPhone) ou un navigateur récent sur ordinateur.
          </p>
        </>
      )}
    </div>
  )
}
