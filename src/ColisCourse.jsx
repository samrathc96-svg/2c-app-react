import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { ChoixBox, annoncerCommandePrete, libelleBox, messageErreur, useBoxes } from './BoxLivraison'

// =========================================================
// Colis d'une course : étiquettes (livreur et admin), carte de détail,
// confirmation de libération et alertes de l'admin
// =========================================================
// Les données viennent de la fonction SQL courses_colis() :
//   { "<id course>": { colis: [{ fournisseur, prete, box, nb }], pretes, total } }

// Étiquettes d'une course dans une liste
export function PucesColis({ course, infos, admin }) {
  const puces = []
  if (course.relancee_le && !course.livreur_id) {
    puces.push({ cle: 'relancee', classe: 'relancee', texte: '🔁 Relancée · conditionnement non adapté' })
  }
  const colis = infos && Array.isArray(infos.colis) ? infos.colis : []
  const total = infos ? Number(infos.total || 0) : 0
  const pretes = colis.filter((c) => c.prete)
  if (total > 0) {
    pretes.forEach((c) => {
      const taille = libelleBox(c.box, c.nb)
      puces.push({
        cle: `p-${c.fournisseur}`,
        classe: '',
        texte: `📦 ${taille ? taille + ' · ' : ''}${c.fournisseur}`
      })
    })
    if (pretes.length < total) {
      if (admin) {
        colis
          .filter((c) => !c.prete)
          .forEach((c) => puces.push({ cle: `a-${c.fournisseur}`, classe: 'attente', texte: `⏳ ${c.fournisseur} prépare` }))
      } else if (pretes.length > 0) {
        puces.push({ cle: 'partiel', classe: 'partiel', texte: `Colis ${pretes.length}/${total} prêt` })
      }
    } else {
      puces.push({ cle: 'prete', classe: 'prete', texte: total > 1 ? 'Tous prêts' : 'Prête' })
    }
  }
  if (puces.length === 0) return null
  return (
    <span className="puces-colis">
      {puces.map((p) => (
        <span key={p.cle} className={`puce-colis ${p.classe}`}>
          {p.texte}
        </span>
      ))}
    </span>
  )
}

// Carte « Colis à récupérer » dans le détail d'une course (livreur)
export function CarteColisLivreur({ course, infos }) {
  const colis = infos && Array.isArray(infos.colis) ? infos.colis : []
  if (colis.length === 0) return null
  const total = Number(infos.total || colis.length)
  const pretes = colis.filter((c) => c.prete).length
  return (
    <div className="carte-colis">
      <h4>{course.livreur_id ? 'Colis à récupérer' : 'Commande à récupérer'}</h4>
      <ul>
        {colis.map((c) => (
          <li key={c.fournisseur}>
            <span className="carte-colis-nom">Chez {c.fournisseur}</span>
            <span className="puces-colis">
              {c.prete ? (
                <>
                  {c.box && <span className="puce-colis">📦 {libelleBox(c.box, c.nb)}</span>}
                  <span className="puce-colis prete">Prêt</span>
                </>
              ) : (
                <span className="puce-colis attente">En préparation</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {pretes < total && (
        <p className="note-box">
          {pretes === 0
            ? 'Rien n\'est encore prêt.'
            : 'Les autres colis seront bientôt prêts : tu seras prévenu par notification.'}
        </p>
      )}
      {course.relancee_le && !course.livreur_id && (
        <p className="note-box">Course relancée : un autre livreur n'a pas pu prendre ces colis (trop volumineux pour lui).</p>
      )}
    </div>
  )
}

// Fenêtre du bas de l'écran
export function FeuilleBas({ titre, ouverte, onFermer, children }) {
  if (!ouverte) return null
  return (
    <div className="voile-feuille" role="dialog" aria-modal="true" aria-label={titre} onClick={onFermer}>
      <div className="feuille-bas" onClick={(e) => e.stopPropagation()}>
        <h4>{titre}</h4>
        {children}
      </div>
    </div>
  )
}

// Confirmation « colis trop volumineux »
export function FeuilleLiberation({ ouverte, enCours, onConfirmer, onAnnuler }) {
  return (
    <FeuilleBas titre="Libérer cette course ?" ouverte={ouverte} onFermer={enCours ? undefined : onAnnuler}>
      <p>
        Le colis ne rentre pas dans ton véhicule. La course sera proposée aux autres livreurs et tu ne pourras pas la
        reprendre.
      </p>
      <button className="valider" disabled={enCours} onClick={onConfirmer}>
        {enCours ? 'Libération…' : 'Oui, libérer la course'}
      </button>
      <button className="bouton-secondaire bouton-feuille" disabled={enCours} onClick={onAnnuler}>
        Annuler
      </button>
    </FeuilleBas>
  )
}

function heure(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })
}

// Alertes du tableau de bord admin : commandes non prêtes depuis 20 min,
// courses libérées plusieurs fois, historique des libérations.
export function AlertesBoxAdmin({ courses, colis, notifier, recharger }) {
  const boxes = useBoxes()
  const [maintenant, setMaintenant] = useState(Date.now())
  const [liberations, setLiberations] = useState([])
  const [cible, setCible] = useState(null) // { commande_id, fournisseur, numero }
  const [choix, setChoix] = useState({ box: null, nb: 1 })
  const [enCours, setEnCours] = useState(false)

  async function chargerLiberations() {
    const { data, error } = await supabase.rpc('admin_liberations')
    if (!error && Array.isArray(data)) setLiberations(data)
  }

  useEffect(() => {
    chargerLiberations()
    const horloge = setInterval(() => setMaintenant(Date.now()), 30000)
    const releve = setInterval(chargerLiberations, 60000)
    return () => {
      clearInterval(horloge)
      clearInterval(releve)
    }
  }, [])

  // Colis non prêts depuis au moins 20 minutes (et moins de 24 h)
  const retards = []
  courses.forEach((course) => {
    if (course.statut !== 'À livrer' || !course.created_at) return
    const infos = colis[course.id]
    if (!infos || !Array.isArray(infos.colis)) return
    const minutes = (maintenant - new Date(course.created_at).getTime()) / 60000
    if (minutes < 20 || minutes > 24 * 60) return
    infos.colis
      .filter((c) => !c.prete)
      .forEach((c) =>
        retards.push({ course, fournisseur: c.fournisseur, minutes: Math.floor(minutes) })
      )
  })

  // Courses libérées au moins deux fois et toujours sans livreur
  const multiLiberees = courses.filter(
    (c) => Number(c.nb_liberations || 0) >= 2 && !c.livreur_id && c.statut === 'À livrer'
  )

  function ouvrir(course, fournisseur) {
    setChoix({ box: null, nb: 1 })
    setCible({ commande_id: String(course.commande_id), fournisseur, adresse: course.adresse })
  }

  async function marquerPrete() {
    if (!cible || !choix.box) return
    setEnCours(true)
    try {
      const { error } = await supabase.rpc('admin_marquer_prete', {
        p_commande: cible.commande_id,
        p_fournisseur: cible.fournisseur,
        p_box: choix.box,
        p_nb: choix.nb
      })
      if (error) {
        console.error('Erreur admin « prête » :', error)
        notifier(messageErreur(error, "La commande n'a pas pu être marquée prête."))
        return
      }
      annoncerCommandePrete(cible.commande_id, cible.fournisseur)
      notifier(`Commande marquée prête à la place de ${cible.fournisseur}.`, 'info')
      setCible(null)
      if (recharger) recharger()
    } finally {
      setEnCours(false)
    }
  }

  if (retards.length === 0 && multiLiberees.length === 0 && liberations.length === 0) return null

  return (
    <div className="alertes-box">
      {retards.map((r) => (
        <div key={`${r.course.id}-${r.fournisseur}`} className="alerte-box">
          <strong>⚠ Commande non prête depuis {r.minutes} min</strong>
          <div>
            {r.fournisseur} · {r.course.adresse}
          </div>
          <button className="bouton-petit" onClick={() => ouvrir(r.course, r.fournisseur)}>
            Marquer prête à leur place…
          </button>
        </div>
      ))}

      {multiLiberees.map((c) => {
        const infos = colis[c.id]
        const tailles = infos && infos.colis ? infos.colis.map((x) => libelleBox(x.box, x.nb)).filter(Boolean).join(' + ') : ''
        return (
          <div key={c.id} className="alerte-box">
            <strong>⚠ Course libérée {c.nb_liberations} fois</strong>
            <div>
              {tailles ? `${tailles} · ` : ''}
              {c.adresse}
            </div>
            <small>Aucun livreur ne peut la prendre pour l'instant : il faut peut-être une autre solution.</small>
          </div>
        )
      })}

      {liberations.length > 0 && (
        <details className="historique-liberations">
          <summary>Historique des libérations ({liberations.length})</summary>
          <ul>
            {liberations.map((l, i) => (
              <li key={`${l.course_id}-${i}`}>
                <span>
                  {l.livreur} · {l.adresse || ''}
                </span>
                <small>
                  {heure(l.cree_le)} · {l.motif === 'trop_volumineux' ? 'trop volumineux' : l.motif}
                </small>
              </li>
            ))}
          </ul>
        </details>
      )}

      <FeuilleBas
        titre={cible ? `Marquer « prête » à la place de ${cible.fournisseur}` : ''}
        ouverte={Boolean(cible)}
        onFermer={enCours ? undefined : () => setCible(null)}
      >
        <p>À faire après les avoir appelés. Choisis la taille de la box.</p>
        <ChoixBox
          boxes={boxes}
          box={choix.box}
          nb={choix.nb}
          desactive={enCours}
          onBox={(box) => setChoix((a) => ({ ...a, box }))}
          onNb={(nb) => setChoix((a) => ({ ...a, nb }))}
        />
        <button className="valider" disabled={enCours || !choix.box} onClick={marquerPrete}>
          {enCours ? 'Enregistrement…' : 'Valider : commande prête'}
        </button>
        <button className="bouton-secondaire bouton-feuille" disabled={enCours} onClick={() => setCible(null)}>
          Annuler
        </button>
      </FeuilleBas>
    </div>
  )
}
