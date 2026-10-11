import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import { ChoixBox, annoncerCommandePrete, libelleBox, messageErreur, useBoxes } from './BoxLivraison'
import { LOGO_2C_PNG } from './logo2cPdf'

// =========================================================
// Commandes reçues par un fournisseur (onglet "Commandes")
// =========================================================
// Le fournisseur voit les commandes qui contiennent SES produits (et
// uniquement ses lignes) : n° de commande, client / entreprise, chantier,
// adresse de livraison, produits à préparer. Il peut imprimer le bon et
// cliquer « Commande prête » en indiquant la box utilisée (XS à XL) et le
// nombre de colis : c'est ce clic qui rend la course visible des livreurs. Il ne voit ni le téléphone ni l'email du
// client. Toute la sécurité est dans les fonctions SQL.

function echapperHtml(texte) {
  return String(texte == null ? '' : texte)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function chf(n) {
  return `${(Math.round(Number(n || 0) * 100) / 100).toFixed(2)} CHF`
}

// Montant avec séparateur de milliers suisse : 1'234.50 (sans l'unité)
function montant(n) {
  const [entier, decimales] = (Math.round(Number(n || 0) * 100) / 100).toFixed(2).split('.')
  return `${entier.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${decimales}`
}

function formaterDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('fr-CH', { dateStyle: 'short', timeStyle: 'short' })
}

export function totalCommande(commande) {
  return (commande.lignes || []).reduce(
    (somme, l) => somme + Number(l.quantite || 0) * Number(l.prix || 0),
    0
  )
}

// Étape de la commande du point de vue du fournisseur
export function etapeCommande(commande) {
  const livraison = commande.livraison_statut
  if (livraison === 'Annulée' || commande.rembourse) return { cle: 'annulee', libelle: 'Annulée', aPreparer: false }
  if (livraison === 'Livrée') return { cle: 'livree', libelle: 'Livrée', aPreparer: false }
  if (livraison === 'En cours') return { cle: 'recuperee', libelle: 'Récupérée par le livreur', aPreparer: false }
  if (commande.prepare_le) return { cle: 'preparee', libelle: 'Prête', aPreparer: false }
  return { cle: 'a_preparer', libelle: 'À préparer', aPreparer: true }
}

// Ouvre la fenêtre d'impression avec le bon de commande (sans quitter le site)
export function imprimerBon(commande, nomFournisseur) {
  const lignes = (commande.lignes || []).map((l) => `<tr>
      <td class="ref">${echapperHtml(l.reference || '')}</td>
      <td>${echapperHtml(l.nom)}</td>
      <td class="d qte">${echapperHtml(l.quantite)}</td>
      <td class="d">${montant(l.prix)}</td>
      <td class="d fort">${montant(Number(l.quantite) * Number(l.prix))}</td>
      <td class="coche"><span class="case"></span></td>
    </tr>`).join('')
  const livraison = [
    commande.entreprise || commande.nom_client,
    commande.entreprise && commande.nom_client ? commande.nom_client : '',
    commande.chantier ? `Chantier : ${commande.chantier}` : '',
    commande.technicien ? `Commandé par : ${commande.technicien}` : '',
    commande.adresse
  ].filter(Boolean)
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Bon de commande ${echapperHtml(commande.numero_suivi)}</title>
<style>
  @page{size:A4;margin:16mm 18mm}
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#1E1B17;margin:0;font-size:13px;line-height:1.4}
  .entete{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:1px solid #E2DDD2;position:relative}
  .entete:after{content:'';position:absolute;left:0;bottom:-1px;width:28mm;height:3px;background:#FF6A13}
  .marque{display:flex;align-items:center;gap:12px}
  .marque img{width:50px;height:auto}
  .marque b{display:block;font-size:13px;letter-spacing:.2em}
  .marque b i{font-style:normal;color:#FF6A13}
  .marque span{display:block;font-size:10px;color:#79705F;margin-top:3px}
  .titre{text-align:right}
  .titre h1{margin:0;font-size:22px;letter-spacing:.14em}
  .titre p{margin:4px 0 0;color:#FF6A13;font-weight:bold;font-size:14px}
  .etiquette{font-size:9px;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;color:#79705F;margin:0 0 5px}
  .parties{display:flex;gap:28px;margin:22px 0 16px}
  .parties>div{flex:1}
  .parties strong{display:block;font-size:14px}
  .parties p{margin:0}
  .bandeau{display:flex;background:#F8F6F1;border-radius:6px;padding:11px 16px;margin-bottom:22px}
  .bandeau>div{flex:1}
  .bandeau b{font-size:13px}
  table{border-collapse:collapse;width:100%}
  .produits th{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#79705F;text-align:left;padding:0 6px 8px;border-bottom:1.5px solid #1E1B17}
  .produits td{padding:9px 6px;border-bottom:1px solid #E2DDD2;vertical-align:top}
  .d{text-align:right;white-space:nowrap} th.d{text-align:right}
  .ref{color:#79705F;font-size:11px;white-space:nowrap}
  .fort{font-weight:bold}
  .coche{width:34px;text-align:center} th.coche{text-align:center}
  .case{display:inline-block;width:14px;height:14px;border:1.5px solid #79705F;border-radius:2px}
  .total{display:flex;justify-content:flex-end;margin:14px 0 24px}
  .total div{background:#F8F6F1;border-radius:6px;padding:9px 16px;display:flex;gap:40px;align-items:baseline}
  .total span{font-weight:bold}
  .total b{font-size:17px;color:#FF6A13}
  .controle{border:1px solid #E2DDD2;border-radius:6px;padding:14px 16px;margin-bottom:22px}
  .controle p{margin:7px 0 0}
  .controle .case{margin-right:9px;vertical-align:-3px}
  .colis{display:inline-block;width:46px;border-bottom:1px solid #79705F;margin:0 4px}
  .pied{color:#79705F;font-size:11px;border-top:1px solid #E2DDD2;padding-top:10px}
</style></head><body>
<div class="entete">
  <div class="marque"><img src="${LOGO_2C_PNG}" alt="2C">
    <div><b><i>DELI</i>VERY</b><span>Du rayon au chantier, en un clic.</span></div></div>
  <div class="titre"><h1>BON DE COMMANDE</h1><p>N° ${echapperHtml(commande.numero_suivi)}</p></div>
</div>
<div class="parties">
  <div><p class="etiquette">Fournisseur</p><strong>${echapperHtml(nomFournisseur)}</strong></div>
  <div><p class="etiquette">Livraison</p>${livraison.map((l, i) => i === 0 ? `<strong>${echapperHtml(l)}</strong>` : `<p>${echapperHtml(l)}</p>`).join('')}</div>
</div>
<div class="bandeau">
  <div><p class="etiquette">Commande passée le</p><b>${echapperHtml(formaterDate(commande.created_at))}</b></div>
  <div><p class="etiquette">Enlèvement</p><b>Par un livreur 2C</b></div>
  <div><p class="etiquette">Total de vos produits</p><b>${montant(totalCommande(commande))} CHF</b></div>
</div>
<table class="produits">
  <tr><th>Réf.</th><th>Produit</th><th class="d">Qté</th><th class="d">Prix</th><th class="d">Total</th><th class="coche">Prêt</th></tr>
  ${lignes}
</table>
<div class="total"><div><span>Total de vos produits</span><b>${montant(totalCommande(commande))} CHF</b></div></div>
<div class="controle">
  <p class="etiquette">À remplir avant l'arrivée du livreur</p>
  <p><span class="case"></span>Commande préparée et étiquetée avec le n° <b>${echapperHtml(commande.numero_suivi)}</b></p>
  <p><span class="case"></span>Nombre de colis : <span class="colis"></span> &nbsp; Taille de la box : <span class="colis"></span></p>
</div>
<p class="pied">Un livreur 2C passera récupérer cette commande. Pour toute question : contact@2cdelivery.ch</p>
</body></html>`

  const cadre = document.createElement('iframe')
  cadre.setAttribute('aria-hidden', 'true')
  cadre.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(cadre)
  const doc = cadre.contentWindow.document
  doc.open()
  doc.write(html)
  doc.close()
  setTimeout(() => {
    try {
      cadre.contentWindow.focus()
      cadre.contentWindow.print()
    } finally {
      setTimeout(() => cadre.remove(), 60000)
    }
  }, 300)
}

export function CommandesFournisseur({ compte, notifier, onChangement }) {
  const [commandes, setCommandes] = useState([])
  const [chargement, setChargement] = useState(true)
  const [filtre, setFiltre] = useState('a_preparer')
  const [enCours, setEnCours] = useState(null)
  const boxes = useBoxes()
  // Choix en cours par commande : { [id]: { box, nb } } ; modification : id de la commande rouverte
  const [choix, setChoix] = useState({})
  const [modification, setModification] = useState(null)
  const [annulation, setAnnulation] = useState(null)

  async function charger() {
    const { data, error } = await supabase.rpc('fournisseur_mes_commandes')
    if (error) {
      console.error('Erreur de chargement des commandes du fournisseur :', error)
      notifier('Impossible de charger vos commandes.')
      setChargement(false)
      return
    }
    setCommandes(Array.isArray(data) ? data : [])
    setChargement(false)
  }

  useEffect(() => {
    charger()
    // Nouvelle commande détectée par l'alerte : la liste se met à jour toute seule.
    window.addEventListener('commandes-fournisseur-maj', charger)
    return () => window.removeEventListener('commandes-fournisseur-maj', charger)
  }, [])

  function choixDe(commande) {
    return choix[commande.id] || { box: commande.box || null, nb: Number(commande.nb_colis || 1) }
  }

  function changerChoix(commande, morceau) {
    setChoix((avant) => ({ ...avant, [commande.id]: { ...choixDe(commande), ...morceau } }))
  }

  // Clic sur « Commande prête » (ou « Enregistrer » en modification)
  async function declarerPrete(commande) {
    const { box, nb } = choixDe(commande)
    if (!box) {
      notifier('Choisis la taille de la box.')
      return
    }
    const dejaPrete = Boolean(commande.prepare_le)
    setEnCours(commande.id)
    try {
      const { error } = await supabase.rpc('fournisseur_marquer_prete', {
        p_commande: commande.id,
        p_box: box,
        p_nb: nb
      })
      if (error) {
        console.error('Erreur « commande prête » :', error)
        notifier(messageErreur(error, "La commande n'a pas pu être marquée prête."))
        return
      }
      setModification(null)
      notifier(dejaPrete ? 'Taille enregistrée.' : 'Commande prête : les livreurs sont prévenus.')
      if (!dejaPrete) annoncerCommandePrete(commande.id)
      await charger()
      if (onChangement) onChangement()
    } finally {
      setEnCours(null)
    }
  }

  // Annule le « prête » (possible tant qu'aucun livreur n'a pris la course)
  async function annulerPrete(commande) {
    setEnCours(commande.id)
    try {
      const { error } = await supabase.rpc('fournisseur_demarquer_prete', { p_commande: commande.id })
      if (error) {
        console.error('Erreur d\'annulation « prête » :', error)
        notifier(messageErreur(error, "L'annulation n'a pas pu être faite."))
        return
      }
      setAnnulation(null)
      setModification(null)
      setChoix((avant) => {
        const suite = { ...avant }
        delete suite[commande.id]
        return suite
      })
      notifier('Commande remise « à préparer ».')
      await charger()
      if (onChangement) onChangement()
    } finally {
      setEnCours(null)
    }
  }

  const compteurs = useMemo(() => {
    const c = { a_preparer: 0, preparees: 0, annulees: 0, toutes: commandes.length }
    commandes.forEach((cmd) => {
      const etape = etapeCommande(cmd)
      if (etape.aPreparer) c.a_preparer += 1
      else if (etape.cle === 'preparee') c.preparees += 1
      else if (etape.cle === 'annulee') c.annulees += 1
    })
    return c
  }, [commandes])

  const visibles = commandes.filter((cmd) => {
    if (filtre === 'toutes') return true
    const etape = etapeCommande(cmd)
    if (filtre === 'a_preparer') return etape.aPreparer
    if (filtre === 'annulees') return etape.cle === 'annulee'
    return etape.cle === 'preparee'
  })

  return (
    <div className="commandes-fournisseur">
      <div className="choix-role">
        <button className={filtre === 'a_preparer' ? 'actif' : ''} onClick={() => setFiltre('a_preparer')}>
          À préparer ({compteurs.a_preparer})
        </button>
        <button className={filtre === 'preparees' ? 'actif' : ''} onClick={() => setFiltre('preparees')}>
          Prêtes ({compteurs.preparees})
        </button>
        <button className={filtre === 'annulees' ? 'actif' : ''} onClick={() => setFiltre('annulees')}>
          Annulées ({compteurs.annulees})
        </button>
        <button className={filtre === 'toutes' ? 'actif' : ''} onClick={() => setFiltre('toutes')}>
          Toutes ({compteurs.toutes})
        </button>
      </div>

      {chargement ? (
        <p className="souligne">Chargement de vos commandes…</p>
      ) : visibles.length === 0 ? (
        <div className="bandeau-fournisseur bandeau-info">
          {filtre === 'a_preparer'
            ? 'Aucune commande à préparer pour le moment. Vous recevrez un email dès qu\'un client commande l\'un de vos produits.'
            : 'Aucune commande dans cette liste.'}
        </div>
      ) : (
        <ul className="liste-commandes-fournisseur">
          {visibles.map((cmd) => {
            const etape = etapeCommande(cmd)
            const choixCmd = choixDe(cmd)
            const modifiable = etape.cle === 'preparee' && !cmd.course_prise
            return (
              <li key={cmd.id} className="commande-fournisseur">
                <div className="entete-commande-fournisseur">
                  <div>
                    <strong>Commande {cmd.numero_suivi}</strong>
                    <small>{formaterDate(cmd.created_at)}</small>
                  </div>
                  <span className={`badge-statut-commande etape-${etape.cle}`}>{etape.libelle}</span>
                </div>

                <dl className="infos-commande-fournisseur">
                  <dt>Client</dt>
                  <dd>
                    {cmd.nom_client}
                    {cmd.entreprise ? ` — ${cmd.entreprise}` : ''}
                  </dd>
                  {cmd.chantier && (
                    <>
                      <dt>Chantier</dt>
                      <dd>{cmd.chantier}</dd>
                    </>
                  )}
                  {cmd.technicien && (
                    <>
                      <dt>Commandé par</dt>
                      <dd>{cmd.technicien}</dd>
                    </>
                  )}
                  <dt>Livraison à</dt>
                  <dd>{cmd.adresse}</dd>
                </dl>

                <table className="lignes-commande-fournisseur">
                  <thead>
                    <tr>
                      <th>Réf.</th>
                      <th>Produit</th>
                      <th>Qté</th>
                      <th>Prix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(cmd.lignes || []).map((l, i) => (
                      <tr key={i}>
                        <td>{l.reference || '—'}</td>
                        <td>{l.nom}</td>
                        <td className="qte">{l.quantite}</td>
                        <td className="prix">{chf(Number(l.quantite) * Number(l.prix))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="3">Total de vos produits</td>
                      <td className="prix">
                        <strong>{chf(totalCommande(cmd))}</strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>

                {etape.cle === 'annulee' && (
                  <p className="avertissement-annulation">
                    Cette commande a été annulée : inutile de la préparer.
                  </p>
                )}

                {etape.cle === 'a_preparer' && (
                  <div className="bloc-prete">
                    <p className="titre-choix-box">Dans quelle box as-tu rangé la commande ?</p>
                    <ChoixBox
                      boxes={boxes}
                      box={choixCmd.box}
                      nb={choixCmd.nb}
                      desactive={enCours === cmd.id}
                      onBox={(box) => changerChoix(cmd, { box })}
                      onNb={(nb) => changerChoix(cmd, { nb })}
                    />
                    <button
                      className="valider"
                      disabled={enCours === cmd.id || !choixCmd.box}
                      onClick={() => declarerPrete(cmd)}
                    >
                      <i className="bi bi-check2-circle"></i> Commande prête
                    </button>
                  </div>
                )}

                {etape.cle === 'preparee' && (
                  <div className="resume-prete">
                    <strong>
                      Prête{cmd.box ? ` · ${libelleBox(cmd.box, cmd.nb_colis)}` : ''}
                    </strong>
                    <small>
                      {cmd.prete_par_admin
                        ? 'Marquée prête par 2C. '
                        : ''}
                      {cmd.course_prise
                        ? 'Un livreur a pris la course : plus de modification possible.'
                        : 'Les livreurs sont prévenus. Tu peux corriger tant qu\'aucun livreur n\'a pris la course.'}
                    </small>
                  </div>
                )}

                {modifiable && modification === cmd.id && (
                  <div className="bloc-prete">
                    <ChoixBox
                      boxes={boxes}
                      box={choixCmd.box}
                      nb={choixCmd.nb}
                      desactive={enCours === cmd.id}
                      onBox={(box) => changerChoix(cmd, { box })}
                      onNb={(nb) => changerChoix(cmd, { nb })}
                    />
                    <div className="actions-fournisseur">
                      <button
                        className="valider"
                        disabled={enCours === cmd.id || !choixCmd.box}
                        onClick={() => declarerPrete(cmd)}
                      >
                        Enregistrer
                      </button>
                      <button className="bouton-secondaire" onClick={() => setModification(null)}>
                        Fermer
                      </button>
                    </div>
                  </div>
                )}

                {modifiable && annulation === cmd.id && (
                  <div className="bandeau-fournisseur bandeau-info">
                    La commande ne sera plus visible des livreurs jusqu'à ce que tu cliques à nouveau « Commande prête ».
                    <div className="actions-fournisseur">
                      <button className="bouton-secondaire" disabled={enCours === cmd.id} onClick={() => annulerPrete(cmd)}>
                        Oui, annuler « prête »
                      </button>
                      <button className="bouton-secondaire" onClick={() => setAnnulation(null)}>
                        Non, garder
                      </button>
                    </div>
                  </div>
                )}

                <div className="actions-fournisseur">
                  {modifiable && modification !== cmd.id && (
                    <button
                      className="bouton-secondaire"
                      disabled={enCours === cmd.id}
                      onClick={() => {
                        setAnnulation(null)
                        setChoix((avant) => ({ ...avant, [cmd.id]: { box: cmd.box || null, nb: Number(cmd.nb_colis || 1) } }))
                        setModification(cmd.id)
                      }}
                    >
                      <i className="bi bi-pencil"></i> {cmd.box ? 'Modifier la taille' : 'Indiquer la taille'}
                    </button>
                  )}
                  {modifiable && annulation !== cmd.id && (
                    <button
                      className="bouton-secondaire"
                      disabled={enCours === cmd.id}
                      onClick={() => {
                        setModification(null)
                        setAnnulation(cmd.id)
                      }}
                    >
                      <i className="bi bi-arrow-counterclockwise"></i> Remettre « à préparer »
                    </button>
                  )}
                  <button className="bouton-secondaire" onClick={() => imprimerBon(cmd, compte.nom_fournisseur)}>
                    <i className="bi bi-printer"></i> Imprimer le bon
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
