import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'

const ToastContext = createContext(null)

let _addToast = null
export function setGlobalToastFn(fn) { _addToast = fn }
export function globalAddToast(msg, type = 'error') { _addToast?.(msg, type) }

let _nextId = 0

// One colour per meaning. These are the semantic values from constants/theme.js
// (DARK.success/danger/warning/info); a toast that cannot be told apart from the
// opposite outcome at a glance is not feedback.
const TOAST_COLORS = {
  success: { bg: '#34d399', border: '#10b981' },
  error:   { bg: '#fb7185', border: '#f43f5e' },
  warning: { bg: '#f59e0b', border: '#d97706' },
  info:    { bg: '#60a5fa', border: '#3b82f6' },
}

// Every toast background above is a bright, saturated colour, so the readable
// foreground is a fixed dark ink in BOTH themes. It must not follow --kt-bg:
// that resolves to white in light mode and leaves white-on-#34d399 (~1.9:1).
const TOAST_INK = '#0f1115'

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timersRef = useRef({})

  const addToast = useCallback((message, type = 'error') => {
    const id = ++_nextId
    setToasts(prev => {
      const next = [...prev, { id, message, type }]
      return next.length > 5 ? next.slice(-5) : next
    })
    timersRef.current[id] = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
      delete timersRef.current[id]
    }, 4000)
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id])
      delete timersRef.current[id]
    }
  }, [])

  useEffect(() => {
    setGlobalToastFn(addToast)
    return () => {
      setGlobalToastFn(null)
      Object.values(timersRef.current).forEach(clearTimeout)
      timersRef.current = {}
    }
  }, [addToast])

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {toasts.length > 0 && (
        <div className="kt-toast-stack" role="status" aria-live="polite" style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          pointerEvents: 'none',
        }}>
          {toasts.map(toast => {
            const colors = TOAST_COLORS[toast.type] || TOAST_COLORS.info
            return (
              <div
                key={toast.id}
                className="kt-toast"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 16px', borderRadius: 8,
                  background: colors.bg, color: TOAST_INK,
                  borderLeft: `4px solid ${colors.border}`,
                  fontSize: 13, fontWeight: 500,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                  pointerEvents: 'auto', maxWidth: 360,
                  animation: 'toastImpact 0.24s cubic-bezier(.2,.8,.2,1)',
                }}
              >
                <span style={{ flex: 1 }}>{toast.message}</span>
                <button
                  onClick={() => removeToast(toast.id)}
                  aria-label="Dismiss"
                  style={{
                    background: 'none', border: 'none', color: TOAST_INK,
                    cursor: 'pointer', padding: 0, fontSize: 16, lineHeight: 1,
                    opacity: 0.7,
                  }}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
