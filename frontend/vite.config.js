import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/projects': backendUrl,
      '/webhook': backendUrl,
      '/integrations': backendUrl,
      '/identities': backendUrl,
      '/activity': backendUrl,
      '/api-keys': backendUrl,
      '/api/v1': backendUrl,
      '/health': backendUrl,
      '/docs': backendUrl,
      '/openapi.json': backendUrl,
      '/redoc': backendUrl,
    }
  }
})
