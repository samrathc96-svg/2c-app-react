// Logo 2C Delivery : « 2 » noir, « C » orange (les deux lettres se chevauchent),
// puis « Deli » orange et « very » noir en dessous. La taille se règle avec la
// variante : « entete » (barre du haut) ou « menu » (menu de gauche).
export default function Logo2C({ variante = 'entete' }) {
  return (
    <span className={`logo-2c logo-2c-${variante}`}>
      <span className="logo-2c-glyphes" aria-hidden="true">
        <span className="logo-2c-lettre">C</span>
        <span className="logo-2c-chiffre">2</span>
      </span>
      <span className="logo-2c-mot" aria-hidden="true">
        <span className="logo-2c-deli">Deli</span>
        <span className="logo-2c-very">very</span>
      </span>
    </span>
  )
}
