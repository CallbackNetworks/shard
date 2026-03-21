import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

const FONT = '-apple-system, BlinkMacSystemFont, "Inter", monospace'

export default function Login() {
  const { login } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(false)
    setLoading(true)
    try {
      await login(password)
      // After login, go to where they were trying to reach or home
      const next = new URLSearchParams(window.location.search).get('next') || '/app'
      window.location.href = next
    } catch {
      setError(true)
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0c',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: FONT,
    }}>
      <div style={{ width: 320 }}>
        {/* Title */}
        <div style={{ marginBottom: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.24em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', marginBottom: 8 }}>
            TODO Platform
          </div>
          <div style={{ width: 40, height: 1, background: 'rgba(255,255,255,0.08)', margin: '0 auto' }} />
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(false) }}
              placeholder="Password"
              autoFocus
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${error ? '#ff5533' : 'rgba(255,255,255,0.1)'}`,
                outline: 'none',
                padding: '12px 14px',
                fontSize: 13,
                color: '#e8e8f0',
                fontFamily: FONT,
                boxSizing: 'border-box',
                letterSpacing: '0.04em',
                transition: 'border-color 0.15s',
              }}
            />
          </div>

          {error && (
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
              color: '#ff5533', marginBottom: 12, textAlign: 'center',
            }}>
              INCORRECT PASSWORD
            </div>
          )}

          <button
            type="submit"
            disabled={!password || loading}
            style={{
              width: '100%',
              background: password && !loading ? 'rgba(124,124,255,0.12)' : 'transparent',
              border: '1px solid rgba(124,124,255,0.3)',
              color: password && !loading ? '#7c7cff' : 'rgba(124,124,255,0.3)',
              padding: '11px 0',
              fontSize: 10, fontWeight: 800, letterSpacing: '0.2em',
              textTransform: 'uppercase', cursor: password && !loading ? 'pointer' : 'default',
              fontFamily: FONT,
              transition: 'all 0.15s',
            }}
          >
            {loading ? 'VERIFYING…' : 'ENTER'}
          </button>
        </form>
      </div>
    </div>
  )
}
