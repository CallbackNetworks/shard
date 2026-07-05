import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query'
import { ToastProvider, globalAddToast } from './context/ToastContext'
import ErrorBoundary from './components/ErrorBoundary'
import { applyUiPrefs } from './utils/uiPrefs'
import App from './App'

applyUiPrefs()

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, gcTime: 5 * 60_000 } },
  mutationCache: new MutationCache({
    onError: (error) => {
      const msg = error.response?.data?.detail || error.message || 'Something went wrong'
      globalAddToast(msg, 'error')
    },
  }),
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
