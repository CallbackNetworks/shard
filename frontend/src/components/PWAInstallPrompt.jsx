import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, X } from 'lucide-react'

const DISMISSED_KEY = 'pwa-install-dismissed'

export default function PWAInstallPrompt() {
  const { t } = useTranslation()
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY)) return

    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setVisible(false)
    }
    setDeferredPrompt(null)
  }, [deferredPrompt])

  const handleDismiss = useCallback(() => {
    setVisible(false)
    localStorage.setItem(DISMISSED_KEY, '1')
  }, [])

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      background: '#1e1e2e',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 12,
      padding: '10px 16px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      animation: 'fadeUpIn 0.3s ease forwards',
      maxWidth: 'calc(100vw - 32px)',
    }}>
      <Download size={16} style={{ color: '#818cf8', flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: '#e2e8f0', whiteSpace: 'nowrap' }}>
        {t('pwa.installPrompt', 'Install TODO Platform for quick access')}
      </span>
      <button
        onClick={handleInstall}
        style={{
          background: '#818cf8',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '6px 14px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {t('pwa.install', 'Install')}
      </button>
      <button
        onClick={handleDismiss}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'rgba(255,255,255,0.3)',
          padding: 2,
          flexShrink: 0,
          display: 'flex',
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}
