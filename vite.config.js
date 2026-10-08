import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Notifications push : le fichier public/push-sw.js affiche les alertes
      // (écran verrouillé, site fermé) dans le service worker généré.
      workbox: {
        importScripts: ['push-sw.js'],
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '2C Delivery',
        short_name: '2C',
        description: 'Commandez chez des fournisseurs de plusieurs métiers et faites-vous livrer',
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        background_color: '#E8E3D8',
        theme_color: '#FF6A13',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})