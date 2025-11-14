import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'AudioViz Controller',
        short_name: 'AudioViz',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b1020',
        theme_color: '#0b1020',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ],
  server: {
    proxy: {
      '^/(status|devices|config|stream)': {
        target: 'http://localhost:5071', // or https://localhost:7071
        changeOrigin: true,
        secure: false
      }
    }
  }
})
