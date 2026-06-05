import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    css: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'TODO Platform',
        short_name: 'TODO',
        description: 'Multi-identity task manager',
        theme_color: '#07080f',
        background_color: '#07080f',
        display: 'standalone',
        start_url: '/app',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/docs/, /^\/openapi\.json/, /^\/redoc/],
        navigateFallbackAllowlist: [/^\/app/, /^\/share/],
        runtimeCaching: [
          {
            urlPattern: /^\/(projects|identities|activity|analytics|api-keys|workflow-rules|decisions|search)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
      },
    }),
    {
      name: 'spa-fallback',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const url = req.url || '/'
          const isAsset = url.startsWith('/@') || url.startsWith('/src') || url.startsWith('/node_modules') || /\.\w+$/.test(url.split('?')[0])
          const isProxied = ['/projects','/webhook','/integrations','/identities','/activity','/api-keys','/api/v1','/share/identity','/auth','/health','/docs','/openapi.json','/redoc','/search','/deliveries','/analytics','/workflow-rules','/assistant','/templates','/notifications','/decisions','/cicd','/ws','/goals','/saved-filters','/ical','/settings'].some(p => url.startsWith(p))
          if (!isAsset && !isProxied) req.url = '/'
          next()
        })
      }
    }
  ],
  server: {
    proxy: {
      '/projects': backendUrl,
      '/webhook': backendUrl,
      '/integrations': backendUrl,
      '/identities': backendUrl,
      '/activity': backendUrl,
      '/api-keys': backendUrl,
      '/api/v1': backendUrl,
      '/share/identity': backendUrl,
      '/auth': backendUrl,
      '/health': backendUrl,
      '/docs': backendUrl,
      '/openapi.json': backendUrl,
      '/redoc': backendUrl,
      '/search': backendUrl,
      '/deliveries': backendUrl,
      '/analytics': backendUrl,
      '/workflow-rules': backendUrl,
      '/assistant': backendUrl,
      '/templates': backendUrl,
      '/notifications': backendUrl,
      '/decisions': backendUrl,
      '/cicd': backendUrl,
      '/goals': backendUrl,
      '/saved-filters': backendUrl,
      '/ical': backendUrl,
      '/settings': backendUrl,
      '/ws': { target: backendUrl, ws: true },
    }
  }
})
