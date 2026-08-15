import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { BACKEND_PATHS, claimedByBackend } from './backendPaths.js'

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
          if (!isAsset && !claimedByBackend(url)) req.url = '/'
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
    // Derived from BACKEND_PATHS so the proxy and the SPA fallback above cannot drift
    // apart. Vite treats a key beginning with `^` as a regular expression; a bare string
    // key is a plain prefix, which is what let `/api` swallow `/api-keys`.
    proxy: Object.fromEntries(
      BACKEND_PATHS.map(p => [
        `^${p.replace(/[.]/g, '\\.')}(?:[/?]|$)`,
        // /ws upgrades; everything else, /mcp included, is the backend. It used to
        // need its own target while the MCP server was a separate container (ADR-0080).
        p === '/ws' ? { target: backendUrl, ws: true } : backendUrl,
      ]),
    )
  }
})
