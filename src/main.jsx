import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'

// Monitoring d'erreurs (Sentry) : ne s'active que si une clé DSN est
// fournie, donc rien ne casse tant que le compte Sentry n'est pas créé.
// Une fois le compte créé, ajoute VITE_SENTRY_DSN dans les variables
// d'environnement Vercel (Project Settings → Environment Variables) avec
// la clé DSN donnée par Sentry, puis redéploie.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN })
}

// Filet de sécurité : si un écran plante, on affiche un message et un bouton
// au lieu d'une page blanche (avant, la personne restait bloquée sans rien voir).
class EcranDeSecours extends Component {
  constructor(props) {
    super(props)
    this.state = { erreur: false }
  }

  static getDerivedStateFromError() {
    return { erreur: true }
  }

  componentDidCatch(erreur) {
    console.error("Erreur d'affichage :", erreur)
    if (import.meta.env.VITE_SENTRY_DSN) Sentry.captureException(erreur)
  }

  render() {
    if (!this.state.erreur) return this.props.children
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          padding: '24px',
          textAlign: 'center',
          background: '#E8E3D8',
          color: '#2B2B2B',
          fontFamily: 'system-ui, sans-serif'
        }}
      >
        <h2 style={{ margin: 0 }}>Oups, un problème est survenu</h2>
        <p style={{ margin: 0, maxWidth: '320px' }}>
          Rien n'est perdu : recharge la page pour continuer.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: '#FF6A13',
            color: '#fff',
            border: 'none',
            borderRadius: '12px',
            padding: '14px 24px',
            fontSize: '16px',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          Recharger la page
        </button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <EcranDeSecours>
      <App />
    </EcranDeSecours>
  </StrictMode>,
)
