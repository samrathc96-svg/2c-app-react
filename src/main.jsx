import { StrictMode } from 'react'
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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
