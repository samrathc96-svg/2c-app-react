// Notifications push 2C Delivery (chargé par le service worker de l'application).
// Affiche l'alerte (écran verrouillé, site fermé) et ouvre le bon écran au toucher.

self.addEventListener('push', (event) => {
  let donnees = {}
  try {
    donnees = event.data ? event.data.json() : {}
  } catch (e) {
    donnees = { titre: '2C Delivery', corps: event.data ? event.data.text() : '' }
  }
  const titre = donnees.titre || '2C Delivery'
  const options = {
    body: donnees.corps || '',
    icon: '/pwa-192x192.png',
    tag: donnees.tag || undefined,
    renotify: Boolean(donnees.tag),
    vibrate: [200, 100, 200],
    data: { url: donnees.url || '/' }
  }
  event.waitUntil(self.registration.showNotification(titre, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Uniquement des pages du site : tout lien extérieur est remplacé par l'accueil
  let cible = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin)
  if (cible.origin !== self.location.origin) cible = new URL('/', self.location.origin)
  const adresse = cible.href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenetres) => {
      for (const fenetre of fenetres) {
        if (new URL(fenetre.url).origin === self.location.origin && 'focus' in fenetre) {
          // Fenêtre déjà ouverte : on la met au premier plan sur le bon écran
          return fenetre.focus().then(() => ('navigate' in fenetre ? fenetre.navigate(adresse) : undefined))
        }
      }
      return self.clients.openWindow(adresse)
    })
  )
})
