import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

// =========================================================
// Logo du fournisseur
// =========================================================
// * LogoFournisseurImage : affiche le logo (ou l'icône de boutique si le
//   fournisseur n'en a pas, ou si l'image ne se charge pas).
// * CarteLogoFournisseur : bloc de l'espace fournisseur pour envoyer,
//   remplacer ou retirer son logo.

const TYPES_ACCEPTES = ['image/png', 'image/jpeg', 'image/webp']
const TAILLE_MAX = 2 * 1024 * 1024

export function LogoFournisseurImage({ url, nom, classe }) {
  const [casse, setCasse] = useState(false)
  useEffect(() => {
    setCasse(false)
  }, [url])
  if (!url || casse) return <i className="bi bi-shop"></i>
  return <img className={classe} src={url} alt={`Logo ${nom || ''}`.trim()} loading="lazy" onError={() => setCasse(true)} />
}

export function CarteLogoFournisseur({ compte, notifier, onChange }) {
  const [logo, setLogo] = useState(compte.logo_url || null)
  const [envoi, setEnvoi] = useState(false)
  const champ = useRef(null)

  async function enregistrer(url) {
    const { error } = await supabase.rpc('fournisseur_enregistrer_logo', { p_url: url })
    if (error) throw error
    setLogo(url)
    if (onChange) onChange()
  }

  async function envoyer(fichier) {
    if (!fichier) return
    if (!TYPES_ACCEPTES.includes(fichier.type)) {
      notifier('Choisissez une image PNG, JPG ou WebP.')
      return
    }
    if (fichier.size > TAILLE_MAX) {
      notifier('Image trop lourde (2 Mo maximum).')
      return
    }
    setEnvoi(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const uid = sessionData && sessionData.session ? sessionData.session.user.id : compte.user_id
      const extension = fichier.type === 'image/png' ? 'png' : fichier.type === 'image/webp' ? 'webp' : 'jpg'
      const chemin = `fournisseurs/${uid}/logo-${Date.now()}.${extension}`
      const { error } = await supabase.storage.from('produits').upload(chemin, fichier, { contentType: fichier.type })
      if (error) throw error
      const { data } = supabase.storage.from('produits').getPublicUrl(chemin)
      await enregistrer(data.publicUrl)
      notifier('Logo enregistré : il apparaît sur le site.', 'info')
    } catch (e) {
      console.error("Erreur d'envoi du logo :", e)
      notifier("L'envoi du logo a échoué, réessayez.")
    }
    setEnvoi(false)
    if (champ.current) champ.current.value = ''
  }

  async function retirer() {
    setEnvoi(true)
    try {
      await enregistrer(null)
      notifier('Logo retiré.', 'info')
    } catch (e) {
      console.error('Erreur de retrait du logo :', e)
      notifier('Le logo n\'a pas pu être retiré.')
    }
    setEnvoi(false)
  }

  return (
    <div className="carte-auth carte-logo-fournisseur">
      <h3>Votre logo</h3>
      <div className="contenu-logo-fournisseur">
        <div className="apercu-logo-fournisseur">
          <LogoFournisseurImage url={logo} nom={compte.nom_fournisseur} />
        </div>
        <div className="texte-logo-fournisseur">
          <p className="souligne">
            {logo
              ? 'Voici le logo affiché à côté de votre nom sur le site.'
              : 'Ajoutez le logo de votre enseigne : il apparaîtra à côté de votre nom dans le catalogue.'}
          </p>
          <p className="souligne">
            PNG, JPG ou WebP, 2 Mo maximum. Idéalement sur fond blanc ou transparent. N'envoyez que votre propre logo.
          </p>
        </div>
      </div>
      <input
        ref={champ}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => envoyer(e.target.files && e.target.files[0])}
      />
      <div className="actions-fournisseur">
        <button className="valider" disabled={envoi} onClick={() => champ.current && champ.current.click()}>
          <i className="bi bi-image"></i> {envoi ? 'Envoi…' : logo ? 'Changer le logo' : 'Ajouter mon logo'}
        </button>
        {logo && (
          <button className="bouton-secondaire" disabled={envoi} onClick={retirer}>
            Retirer le logo
          </button>
        )}
      </div>
    </div>
  )
}
