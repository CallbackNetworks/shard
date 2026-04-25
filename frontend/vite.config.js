import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'spa-fallback',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const url = req.url || '/'
          const isAsset = url.startsWith('/@') || url.startsWith('/src') || url.startsWith('/node_modules') || /\.\w+$/.test(url.split('?')[0])
          const isProxied = ['/projects','/webhook','/integrations','/identities','/activity','/api-keys','/api/v1','/share/identity','/auth','/health','/docs','/openapi.json','/redoc','/search','/deliveries','/analytics','/workflow-rules','/assistant','/templates','/ws'].some(p => url.startsWith(p))
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
      '/ws': { target: backendUrl, ws: true },
    }
  }
})
