import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// =========================================================
// Les 5 box fournies par 2C (XS, S, M, L, XL)
// =========================================================
// Composants et fonctions communs à l'espace fournisseur (« Commande prête »),
// à l'espace livreur (affichage des colis) et à l'admin (marquer prête à la
// place d'un fournisseur). Les dimensions viennent de la table boxes_livraison
// (modifiable dans Supabase) ; la liste ci-dessous ne sert que de repli si la
// table n'est pas encore installée.

export const BOX_PAR_DEFAUT = [
  { code: 'XS', rang: 1, longueur_cm: 12, largeur_cm: 9, hauteur_cm: 7 },
  { code: 'S', rang: 2, longueur_cm: 17.5, largeur_cm: 13.5, hauteur_cm: 10.5 },
  { code: 'M', rang: 3, longueur_cm: 23, largeur_cm: 18, hauteur_cm: 14 },
  { code: 'L', rang: 4, longueur_cm: 31, largeur_cm: 24, hauteur_cm: 18 },
  { code: 'XL', rang: 5, longueur_cm: 39, largeur_cm: 30, hauteur_cm: 23 }
]

export const NB_COLIS_MAX = 20

function virgule(n) {
  return String(Number(n)).replace('.', ',')
}

export function formaterDimensions(box) {
  if (!box) return ''
  return `${virgule(box.longueur_cm)} × ${virgule(box.largeur_cm)} × ${virgule(box.hauteur_cm)} cm`
}

// « taille M » ou « 2 × M »
export function libelleBox(code, nb) {
  if (!code) return ''
  const n = Number(nb || 1)
  return n > 1 ? `${n} × ${code}` : `taille ${code}`
}

// Message à afficher pour une erreur renvoyée par la base : nos messages
// (raise exception) sont déjà en français ; le reste reçoit le texte par défaut.
export function messageErreur(erreur, parDefaut) {
  if (erreur && erreur.code === 'P0001' && erreur.message) return erreur.message
  return parDefaut
}

// Chargement des box (une fois par page)
let cacheBoxes = null
export function useBoxes() {
  const [boxes, setBoxes] = useState(cacheBoxes || BOX_PAR_DEFAUT)
  useEffect(() => {
    if (cacheBoxes) return undefined
    let actif = true
    supabase
      .from('boxes_livraison')
      .select('code, rang, longueur_cm, largeur_cm, hauteur_cm')
      .order('rang', { ascending: true })
      .then(({ data, error }) => {
        if (!actif || error || !Array.isArray(data) || data.length === 0) return
        cacheBoxes = data
        setBoxes(data)
      })
    return () => {
      actif = false
    }
  }, [])
  return boxes
}

// Alerte push « colis prêt » (livreurs ou livreur assigné). Facultative : si
// elle échoue, la commande est quand même prête et le balayage la renverra.
export async function annoncerCommandePrete(commandeId, fournisseur) {
  try {
    await supabase.functions.invoke('notifications-push', {
      body: { action: 'course_prete', commandeId: String(commandeId), ...(fournisseur ? { fournisseur } : {}) }
    })
  } catch (e) {
    console.warn('Alerte « commande prête » non envoyée :', e)
  }
}

function Pictogramme({ box, max }) {
  const echelle = 42 / (max || 39)
  const largeur = Math.max(10, Math.round(Number(box.longueur_cm) * echelle))
  const hauteur = Math.max(8, Math.round(Number(box.hauteur_cm) * echelle * 1.25))
  return <span className="picto-box" style={{ width: `${largeur}px`, height: `${hauteur}px` }} aria-hidden="true" />
}

// Grille des 5 tuiles + nombre de colis
export function ChoixBox({ boxes, box, nb, onBox, onNb, desactive }) {
  const plusGrande = Math.max(...boxes.map((b) => Number(b.longueur_cm)), 1)
  const choisie = boxes.find((b) => b.code === box)
  return (
    <div className="choix-box">
      <div className="grille-box" role="radiogroup" aria-label="Taille de la box">
        {boxes.map((b) => (
          <button
            key={b.code}
            type="button"
            role="radio"
            aria-checked={box === b.code}
            className={`tuile-box${box === b.code ? ' choisie' : ''}`}
            disabled={desactive}
            onClick={() => onBox(b.code)}
          >
            <Pictogramme box={b} max={plusGrande} />
            <strong>{b.code}</strong>
          </button>
        ))}
      </div>
      <div className="dimensions-box">
        {choisie ? (
          <>
            <strong>{choisie.code}</strong> : {formaterDimensions(choisie)}
          </>
        ) : (
          'Choisis la taille de la box utilisée.'
        )}
      </div>
      <div className="compteur-colis">
        <span>Nombre de colis</span>
        <span className="plus-moins">
          <button type="button" aria-label="Un colis de moins" disabled={desactive || nb <= 1} onClick={() => onNb(nb - 1)}>
            −
          </button>
          <output>{nb}</output>
          <button
            type="button"
            aria-label="Un colis de plus"
            disabled={desactive || nb >= NB_COLIS_MAX}
            onClick={() => onNb(nb + 1)}
          >
            +
          </button>
        </span>
      </div>
      <p className="note-box">
        Seuls les articles qui tiennent dans une box XL ({formaterDimensions(boxes.find((b) => b.code === 'XL') || BOX_PAR_DEFAUT[4])})
        sont pris en charge.
      </p>
    </div>
  )
}
