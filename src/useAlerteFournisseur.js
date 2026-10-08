import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import { etapeCommande } from './CommandesFournisseur'
import { alerteSonoreActivee, jouerSonnerie } from './alerteSonore'
import { pushActifLocalement } from './notificationsPush'

// Alerte du fournisseur : tant que son site est ouvert (n'importe quelle
// page), on vérifie régulièrement s'il y a une nouvelle commande à préparer.
// Nouvelle commande = sonnerie brève + bandeau (le téléphone verrouillé est prévenu
// par les notifications push, voir ActivationNotifications). Le fournisseur n'a pas accès direct aux
// commandes : on interroge donc sa fonction sécurisée à intervalle régulier.
// L'événement 'commandes-fournisseur-maj' prévient l'espace fournisseur
// (pastille et liste) qu'il faut se rafraîchir.
const INTERVALLE_MS = 20000

export function useAlerteFournisseur(compte, notifier) {
  const notifierRef = useRef(notifier)
  notifierRef.current = notifier
  const valide = Boolean(compte && compte.statut === 'valide')

  useEffect(() => {
    if (!valide) return undefined
    let arrete = false
    let connus = null // ids déjà vus ; null tant que la première lecture n'est pas faite

    async function verifier() {
      if (arrete || document.visibilityState === 'hidden') return
      const { data, error } = await supabase.rpc('fournisseur_mes_commandes')
      if (arrete || error || !Array.isArray(data)) return
      const aPreparer = data.filter((c) => etapeCommande(c).aPreparer)
      const ids = new Set(aPreparer.map((c) => String(c.id)))
      if (connus === null) {
        connus = ids
        return
      }
      const nouvelles = aPreparer.filter((c) => !connus.has(String(c.id)))
      const changement = nouvelles.length > 0 || ids.size !== connus.size
      connus = ids
      if (changement) window.dispatchEvent(new Event('commandes-fournisseur-maj'))
      if (nouvelles.length === 0) return

      const texte = nouvelles.length === 1
        ? `Nouvelle commande à préparer : ${nouvelles[0].numero_suivi}`
        : `${nouvelles.length} nouvelles commandes à préparer`
      let sonOk = true
      // Notifications push actives sur cet appareil : c'est la notification du
      // téléphone qui sonne, inutile de doubler avec la sonnerie de la page.
      const pushActif = pushActifLocalement()
      if (!pushActif && alerteSonoreActivee()) sonOk = await jouerSonnerie()
      if (notifierRef.current) {
        notifierRef.current(
          sonOk ? texte : `${texte} (son bloqué : touchez l'écran une fois pour l'activer)`,
          'info'
        )
      }
    }

    verifier()
    const minuterie = setInterval(verifier, INTERVALLE_MS)
    const auRetour = () => {
      if (document.visibilityState === 'visible') verifier()
    }
    document.addEventListener('visibilitychange', auRetour)
    window.addEventListener('focus', auRetour)
    return () => {
      arrete = true
      clearInterval(minuterie)
      document.removeEventListener('visibilitychange', auRetour)
      window.removeEventListener('focus', auRetour)
    }
  }, [valide, compte && compte.nom_fournisseur])
}
