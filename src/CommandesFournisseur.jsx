import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'

// =========================================================
// Commandes reçues par un fournisseur (onglet "Commandes")
// =========================================================
// Le fournisseur voit les commandes qui contiennent SES produits (et
// uniquement ses lignes) : n° de commande, client / entreprise, chantier,
// adresse de livraison, produits à préparer. Il peut imprimer le bon et
// marquer la commande "préparée". Il ne voit ni le téléphone ni l'email du
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
  if (livraison === 'Annulée') return { cle: 'annulee', libelle: 'Annulée', aPreparer: false }
  if (livraison === 'Livrée') return { cle: 'livree', libelle: 'Livrée', aPreparer: false }
  if (livraison === 'En cours') return { cle: 'recuperee', libelle: 'Récupérée par le livreur', aPreparer: false }
  if (commande.prepare_le) return { cle: 'preparee', libelle: 'Préparée', aPreparer: false }
  return { cle: 'a_preparer', libelle: 'À préparer', aPreparer: true }
}

// Ouvre la fenêtre d'impression avec le bon de commande (sans quitter le site)
export function imprimerBon(commande, nomFournisseur) {
  const lignes = (commande.lignes || [])
    .map(
      (l) => `<tr>
        <td>${echapperHtml(l.reference || '')}</td>
        <td>${echapperHtml(l.nom)}</td>
        <td class="c">${echapperHtml(l.quantite)}</td>
        <td class="d">${chf(l.prix)}</td>
        <td class="d">${chf(Number(l.quantite) * Number(l.prix))}</td>
      </tr>`
    )
    .join('')
  const info = (libelle, valeur) =>
    valeur
      ? `<tr><th>${libelle}</th><td>${echapperHtml(valeur)}</td></tr>`
      : ''
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Bon de commande ${echapperHtml(commande.numero_suivi)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#1E1B17;margin:24px;font-size:14px}
  h1{font-size:22px;margin:0 0 2px} .sous{color:#79705F;margin:0 0 18px}
  table{border-collapse:collapse;width:100%;margin-bottom:18px}
  .infos th{text-align:left;width:150px;color:#79705F;font-weight:normal;padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top}
  .infos td{padding:6px 8px;border-bottom:1px solid #ddd}
  .produits th{background:#F6F3EC;text-align:left;font-size:12px;text-transform:uppercase;padding:8px}
  .produits td{padding:8px;border-bottom:1px solid #ddd}
  .c{text-align:center} .d{text-align:right;white-space:nowrap}
  .total td{font-weight:bold;border-bottom:none}
  .pied{color:#79705F;font-size:12px;margin-top:24px}
  .case{display:inline-block;width:14px;height:14px;border:1.5px solid #1E1B17;margin-right:6px;vertical-align:middle}
</style></head><body>
<h1>Bon de commande – ${echapperHtml(commande.numero_suivi)}</h1>
<p class="sous">2C Delivery pour ${echapperHtml(nomFournisseur)} · passée le ${echapperHtml(formaterDate(commande.created_at))}</p>
<table class="infos">
  ${info('Client', commande.nom_client)}
  ${info('Entreprise', commande.entreprise)}
  ${info('Chantier', commande.chantier)}
  ${info('Commandé par', commande.technicien)}
  ${info('Livraison à', commande.adresse)}
</table>
<table class="produits">
  <tr><th>Réf.</th><th>Produit</th><th class="c">Qté</th><th class="d">Prix</th><th class="d">Total</th></tr>
  ${lignes}
  <tr class="total"><td colspan="4" class="d">Total de vos produits</td><td class="d">${chf(totalCommande(commande))}</td></tr>
</table>
<p><span class="case"></span>Commande préparée et étiquetée avec le n° ${echapperHtml(commande.numero_suivi)}</p>
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
  }, [])

  async function marquer(commande, prepare) {
    setEnCours(commande.id)
    try {
      const { error } = await supabase.rpc('fournisseur_marquer_prepare', {
        p_commande: commande.id,
        p_prepare: prepare
      })
      if (error) {
        console.error('Erreur de mise à jour de la commande :', error)
        notifier("La commande n'a pas pu être mise à jour.")
        return
      }
      notifier(prepare ? 'Commande marquée comme préparée.' : 'Commande remise « à préparer ».')
      await charger()
      if (onChangement) onChangement()
    } finally {
      setEnCours(null)
    }
  }

  const compteurs = useMemo(() => {
    const c = { a_preparer: 0, preparees: 0, toutes: commandes.length }
    commandes.forEach((cmd) => {
      const etape = etapeCommande(cmd)
      if (etape.aPreparer) c.a_preparer += 1
      else if (etape.cle === 'preparee') c.preparees += 1
    })
    return c
  }, [commandes])

  const visibles = commandes.filter((cmd) => {
    if (filtre === 'toutes') return true
    const etape = etapeCommande(cmd)
    if (filtre === 'a_preparer') return etape.aPreparer
    return etape.cle === 'preparee'
  })

  return (
    <div className="commandes-fournisseur">
      <div className="choix-role">
        <button className={filtre === 'a_preparer' ? 'actif' : ''} onClick={() => setFiltre('a_preparer')}>
          À préparer ({compteurs.a_preparer})
        </button>
        <button className={filtre === 'preparees' ? 'actif' : ''} onClick={() => setFiltre('preparees')}>
          Préparées ({compteurs.preparees})
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
            const peutMarquer = etape.cle === 'a_preparer' || etape.cle === 'preparee'
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

                <div className="actions-fournisseur">
                  {peutMarquer && (
                    <button
                      className={etape.cle === 'a_preparer' ? 'valider' : 'bouton-secondaire'}
                      disabled={enCours === cmd.id}
                      onClick={() => marquer(cmd, etape.cle === 'a_preparer')}
                    >
                      {etape.cle === 'a_preparer' ? (
                        <>
                          <i className="bi bi-check2-circle"></i> Marquer comme préparée
                        </>
                      ) : (
                        <>
                          <i className="bi bi-arrow-counterclockwise"></i> Remettre « à préparer »
                        </>
                      )}
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
