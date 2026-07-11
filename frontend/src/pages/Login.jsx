import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { BRAND, DARK, FONT } from '../constants/theme'

export default function Login() {
  const { t } = useTranslation()
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
      const next = new URLSearchParams(window.location.search).get('next') || '/'
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
      background: DARK.bgAlt,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: FONT.family,
      position: 'relative',
      overflow: 'hidden',
      padding: 24,
    }}>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)
        `,
        backgroundSize: '36px 36px',
        maskImage: 'linear-gradient(90deg, rgba(0,0,0,0.8), transparent 70%)',
        WebkitMaskImage: 'linear-gradient(90deg, rgba(0,0,0,0.8), transparent 70%)',
      }} />
      <div style={{
        position: 'absolute',
        top: 24,
        left: 24,
        right: 24,
        color: 'rgba(255,255,255,0.04)',
        fontFamily: FONT.display,
        fontSize: 'clamp(72px, 18vw, 220px)',
        lineHeight: 0.8,
        textTransform: 'uppercase',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}>
        SHARD
      </div>

      <div className="kt-panel kt-reveal" style={{
        width: 'min(92vw, 380px)', position: 'relative', zIndex: 1,
        background: DARK.surface,
        border: `1px solid ${DARK.border}`,
        padding: '34px 30px',
      }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{
            width: 38, height: 38, marginBottom: 18,
            background: BRAND,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 400, color: 'var(--kt-bg)',
            fontFamily: FONT.display,
            fontSynthesisWeight: 'none',
          }}>S</div>
          <div style={{
            fontSize: 46,
            lineHeight: 1,
            fontWeight: 400,
            color: '#f3f4f6',
            textTransform: 'uppercase',
            fontFamily: FONT.display,
            fontSynthesisWeight: 'none',
          }}>
            Shard
          </div>
          <div className="kt-label" style={{ marginTop: 8 }}>
            Access Gate
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(false) }}
              placeholder={t('login.password')}
              autoFocus
              style={{
                width: '100%',
                background: DARK.elevated,
                border: `1px solid ${error ? DARK.danger : DARK.border}`,
                boxShadow: error
                  ? `inset 4px 0 0 ${DARK.danger}`
                  : 'none',
                outline: 'none',
                padding: '13px 14px',
                fontSize: 13,
                color: DARK.text,
                fontFamily: FONT.family,
                boxSizing: 'border-box',
                letterSpacing: 0,
                transition: 'border-color 0.2s, background 0.2s',
              }}
            />
          </div>

          {error && (
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 0,
              color: DARK.danger, marginBottom: 12, textAlign: 'left',
              animation: 'fadeUpIn 0.2s ease',
            }}>
              {t('login.incorrectPassword').toUpperCase()}
            </div>
          )}

          <button
            type="submit"
            disabled={!password || loading}
            style={{
              width: '100%',
              background: password && !loading ? BRAND : 'rgba(255,255,255,0.06)',
              border: `1px solid ${password && !loading ? BRAND : DARK.border}`,
              color: password && !loading ? '#171717' : 'rgba(255,255,255,0.28)',
              padding: '12px 0',
              fontSize: 11, fontWeight: 800, letterSpacing: 0,
              textTransform: 'uppercase', cursor: password && !loading ? 'pointer' : 'default',
              fontFamily: FONT.family,
              transition: 'all 0.2s',
              boxShadow: 'none',
            }}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{
                  width: 12, height: 12,
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff',
                  animation: 'spin 0.7s linear infinite',
                  display: 'inline-block',
                }} />
                {t('login.verifying').toUpperCase()}
              </span>
            ) : t('login.enter').toUpperCase()}
          </button>
        </form>
      </div>
    </div>
  )
}
