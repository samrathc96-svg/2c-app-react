import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { confirmer } from './confirmer'

// =========================================================
// Candidature « Devenir livreur » / « Devenir partenaire »
// =========================================================
// Formulaire public : rien n'est créé dans la base. La candidature part par
// email à 2C (contact@2cdelivery.ch) via la fonction « envoyer-candidature ».
// Si 2C accepte, elle envoie au candidat son lien d'inscription personnel
// (2cdelivery.ch/?livreur ou 2cdelivery.ch/?fournisseur).

const MOYENS_LIVRAISON = ['Vélo cargo', 'Scooter', 'Moto', 'Petit utilitaire', 'Autre']
// Les livraisons suivent les horaires de chantier : 7h à 19h pour l'instant.
const DISPONIBILITES = ['Toute la journée (7h–19h)', 'Matin (7h–13h)', 'Après-midi (13h–19h)', 'À définir ensemble']

const TYPES = {
  livreur: {
    titre: 'Devenir livreur',
    intro:
      "Tu livres des petits consommables aux artisans et aux chantiers de Genève, sur les horaires de chantier (7h–19h). " +
      "Présente-toi : on te répond par email, et si ta candidature est retenue, on t'envoie ton lien d'inscription.",
    icone: 'bi-bicycle'
  },
  partenaire: {
    titre: 'Devenir partenaire',
    intro:
      "Vous êtes un fournisseur et vous voulez vendre vos produits aux artisans via 2C Delivery ? " +
      "Présentez-vous : nous vous répondons par email, et si nous travaillons ensemble, nous vous envoyons votre lien d'inscription.",
    icone: 'bi-shop'
  }
}

const VIDE = {
  nom: '', email: '', telephone: '', ville: '', message: '',
  moyen: '', disponibilites: '', conditions: false,
  societe: '', adresse: '', activite: '', siteWeb: ''
}

function emailValide(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())
}

export default function Candidature({ type, onFermer }) {
  const config = TYPES[type] || TYPES.livreur
  const estLivreur = type === 'livreur'
  const [champs, setChamps] = useState(VIDE)
  const [piege, setPiege] = useState('') // champ invisible : seuls les robots le remplissent
  const [envoi, setEnvoi] = useState('repos') // repos | envoi | ok
  const [erreur, setErreur] = useState('')
  const ouvertA = useRef(Date.now())

  useEffect(() => {
    function surTouche(e) {
      if (e.key === 'Escape') onFermer()
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [onFermer])

  function changer(nom, valeur) {
    setChamps((avant) => ({ ...avant, [nom]: valeur }))
  }

  function verifier() {
    if (!champs.nom.trim()) return estLivreur ? 'Indique ton prénom et ton nom.' : 'Indiquez votre nom.'
    if (!estLivreur && !champs.societe.trim()) return 'Indiquez le nom de votre société.'
    if (!emailValide(champs.email)) return estLivreur ? "Cette adresse email n'est pas valide." : "Cette adresse email n'est pas valide."
    if (champs.telephone.replace(/\D/g, '').length < 8) return estLivreur ? 'Indique un numéro de téléphone valide.' : 'Indiquez un numéro de téléphone valide.'
    if (estLivreur) {
      if (!champs.ville.trim()) return 'Indique ta ville ou ta commune.'
      if (!champs.moyen) return 'Choisis ton moyen de livraison.'
      if (!champs.disponibilites) return 'Choisis tes disponibilités (horaires de chantier, 7h–19h).'
      if (!champs.conditions) return "Confirme que tu remplis les conditions (pièce d'identité valide, casier judiciaire vierge)."
    } else {
      if (!champs.adresse.trim()) return 'Indiquez l\'adresse de votre point de retrait.'
      if (!champs.activite.trim()) return 'Indiquez le type de produits que vous proposez.'
    }
    return ''
  }

  async function envoyer() {
    const probleme = verifier()
    if (probleme) {
      setErreur(probleme)
      return
    }
    setErreur('')
    if (!(await confirmer(
      type === 'livreur' ? 'Envoyer ta candidature de livreur à 2C Delivery ?' : 'Envoyer votre candidature de partenaire à 2C Delivery ?',
      { oui: 'Envoyer', danger: false }
    ))) return
    setEnvoi('envoi')
    const { data, error } = await supabase.functions.invoke('envoyer-candidature', {
      body: { type, ...champs, piege, duree_ms: Date.now() - ouvertA.current }
    })
    if (error || !data || !data.success) {
      console.error("Erreur d'envoi de la candidature :", error || data)
      setEnvoi('repos')
      setErreur("L'envoi n'a pas abouti. Réessaie dans un instant ou écris-nous à contact@2cdelivery.ch.")
      return
    }
    setEnvoi('ok')
  }

  return (
    <div className="overlay-auth" onClick={onFermer}>
      <div className="panneau-candidature" role="dialog" aria-modal="true" aria-label={config.titre} onClick={(e) => e.stopPropagation()}>
        <button className="fermer-auth" onClick={onFermer} aria-label="Fermer">✕</button>

        {envoi === 'ok' ? (
          <div className="candidature-merci">
            <i className="bi bi-check-circle"></i>
            <h3>Candidature envoyée</h3>
            <p>
              {estLivreur
                ? `Merci${champs.nom.trim() ? ` ${champs.nom.trim().split(' ')[0]}` : ''} ! Nous avons bien reçu ta demande, un accusé de réception vient d'arriver sur ${champs.email.trim()}. Nous revenons vers toi par email dans les prochains jours.`
                : `Merci${champs.nom.trim() ? ` ${champs.nom.trim().split(' ')[0]}` : ''} ! Nous avons bien reçu votre demande, un accusé de réception vient d'arriver sur ${champs.email.trim()}. Nous revenons vers vous par email dans les prochains jours.`}
            </p>
            <p className="candidature-note">
              {estLivreur
                ? "Si ta candidature est retenue, tu recevras ton lien d'inscription personnel."
                : "Si nous travaillons ensemble, vous recevrez votre lien d'inscription personnel."}
            </p>
            <button className="valider" onClick={onFermer}>Fermer</button>
          </div>
        ) : (
          <div className="candidature-formulaire">
            <div className="candidature-entete">
              <i className={`bi ${config.icone}`}></i>
              <h3>{config.titre}</h3>
            </div>
            <p className="candidature-intro">{config.intro}</p>

            {!estLivreur && (
              <input type="text" placeholder="Nom de votre société" maxLength={120} value={champs.societe} onChange={(e) => changer('societe', e.target.value)} />
            )}
            <input type="text" placeholder={estLivreur ? 'Prénom et nom' : 'Votre nom'} maxLength={120} value={champs.nom} onChange={(e) => changer('nom', e.target.value)} autoComplete="name" />
            <div className="candidature-ligne">
              <input type="email" placeholder="Email" maxLength={160} value={champs.email} onChange={(e) => changer('email', e.target.value)} autoComplete="email" />
              <input type="tel" placeholder="Téléphone" maxLength={30} value={champs.telephone} onChange={(e) => changer('telephone', e.target.value)} autoComplete="tel" />
            </div>

            {estLivreur ? (
              <>
                <input type="text" placeholder="Ville ou commune" maxLength={80} value={champs.ville} onChange={(e) => changer('ville', e.target.value)} />
                <div className="candidature-ligne">
                  <select value={champs.moyen} onChange={(e) => changer('moyen', e.target.value)}>
                    <option value="">Moyen de livraison</option>
                    {MOYENS_LIVRAISON.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select value={champs.disponibilites} onChange={(e) => changer('disponibilites', e.target.value)}>
                    <option value="">Disponibilités (7h–19h)</option>
                    {DISPONIBILITES.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <label className="candidature-case">
                  <input type="checkbox" checked={champs.conditions} onChange={(e) => changer('conditions', e.target.checked)} />
                  <span>Je dispose d'une pièce d'identité valide et d'un casier judiciaire vierge.</span>
                </label>
              </>
            ) : (
              <>
                <input type="text" placeholder="Adresse du point de retrait" maxLength={160} value={champs.adresse} onChange={(e) => changer('adresse', e.target.value)} />
                <input type="text" placeholder="Produits proposés (ex. visserie, ventilation…)" maxLength={160} value={champs.activite} onChange={(e) => changer('activite', e.target.value)} />
                <input type="text" placeholder="Site web (facultatif)" maxLength={160} value={champs.siteWeb} onChange={(e) => changer('siteWeb', e.target.value)} />
              </>
            )}

            <textarea
              placeholder={estLivreur ? 'Un mot sur toi (facultatif)' : 'Un mot sur votre activité (facultatif)'}
              maxLength={1000}
              rows={3}
              value={champs.message}
              onChange={(e) => changer('message', e.target.value)}
            />

            {/* Champ piège : invisible pour les personnes, rempli par les robots */}
            <input
              className="candidature-piege"
              type="text"
              name="site_internet"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={piege}
              onChange={(e) => setPiege(e.target.value)}
            />

            {erreur && <p className="candidature-erreur">{erreur}</p>}
            <button className="valider" disabled={envoi === 'envoi'} onClick={envoyer}>
              {envoi === 'envoi' ? 'Envoi...' : 'Envoyer ma candidature'}
            </button>
            <p className="candidature-note">
              Tes informations servent uniquement à traiter ta candidature. Aucun compte n'est créé à cette étape.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
