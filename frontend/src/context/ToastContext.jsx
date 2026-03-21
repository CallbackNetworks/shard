import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'

const ToastContext = createContext(null)

let _addToast = null
export function setGlobalToastFn(fn) { _addToast = fn }
export function globalAddToast(msg, type = 'error') { _addToast?.(msg, type) }

let _nextId = 0

const TOAST_COLORS = {
  error:   { bg: '#ef4444', border: '#dc2626' },
  success: { bg: '#22c55e', border: '#16a34a' },
  warning: { bg: '#f59e0b', border: '#d97706' },
}

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
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          display: 'flex', flexDirection: 'column', gap: 8,
          pointerEvents: 'none',
        }}>
          {toasts.map(toast => {
            const colors = TOAST_COLORS[toast.type] || TOAST_COLORS.error
            return (
              <div
                key={toast.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 16px', borderRadius: 8,
                  background: colors.bg, color: '#fff',
                  fontSize: 13, fontWeight: 500,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                  pointerEvents: 'auto', maxWidth: 360,
                  animation: 'toast-in 0.2s ease-out',
                }}
              >
                <span style={{ flex: 1 }}>{toast.message}</span>
                <button
                  onClick={() => removeToast(toast.id)}
                  style={{
                    background: 'none', border: 'none', color: '#fff',
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
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
