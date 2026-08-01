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
        name: 'Shard',
        short_name: 'Shard',
        description: 'Multi-identity task manager',
        theme_color: '#07080f',
        background_color: '#07080f',
        display: 'standalone',
        start_url: '/',
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
        navigateFallbackAllowlist: [/^\//, /^\/share/],
        runtimeCaching: [
          {
            // Workbox matches RegExp patterns against the full URL, so a
            // path-anchored regex like /^\/api\//  never matches — use a
            // matchCallback on the pathname instead.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
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
          const isProxied = ['/api','/webhook','/share/identity','/share/project','/ical','/ws','/health','/docs','/openapi.json','/redoc'].some(p => url.startsWith(p))
          if (!isAsset && !isProxied) req.url = '/'
          next()
        })
      }
    }
  ],
  build: {
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router'],
          query: ['@tanstack/react-query'],
          i18n: ['i18next', 'react-i18next'],
        },
      },
    },
  },
  server: {
    // Hosts allowed to reach the dev server. Needed when exposing it through a
    // Cloudflare tunnel for live preview — Vite otherwise blocks the tunnel's
    // *.trycloudflare.com Host header. Extend via VITE_ALLOWED_HOSTS (comma-list).
    allowedHosts: [
      '.trycloudflare.com',
      'localhost',
      ...(process.env.VITE_ALLOWED_HOSTS?.split(',').map(h => h.trim()).filter(Boolean) || []),
    ],
    // Internal API is under /api (ADR-0036); the rest are external contracts that
    // keep root paths. Share data is proxied granularly (/share/identity, /share/project)
    // so the SPA share *pages* (/share/:token, /share/p/:token) still fall through.
    proxy: {
      '/api': backendUrl,
      '/webhook': backendUrl,
      '/share/identity': backendUrl,
      '/share/project': backendUrl,
      '/ical': backendUrl,
      '/health': backendUrl,
      '/docs': backendUrl,
      '/openapi.json': backendUrl,
      '/redoc': backendUrl,
      '/ws': { target: backendUrl, ws: true },
    }
  }
})
