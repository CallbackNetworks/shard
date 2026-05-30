import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { SHADOW_LG, INSET_SHADOW, DARK } from '../constants/theme'

const FONT = "'SpotifyMixUI', 'Helvetica Neue', helvetica, arial, sans-serif"

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
      background: DARK.bgAlt,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: FONT,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Aurora orbs */}
      <div style={{
        position: 'absolute', width: 700, height: 700, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(30,215,96,0.1) 0%, transparent 65%)',
        top: '-220px', left: '-160px',
        animation: 'auroraFloat1 14s ease-in-out infinite',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', width: 580, height: 580, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(30,215,96,0.06) 0%, transparent 65%)',
        bottom: '-180px', right: '-120px',
        animation: 'auroraFloat2 17s ease-in-out infinite',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', width: 440, height: 440, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(34,211,238,0.06) 0%, transparent 65%)',
        top: '50%', left: '50%',
        animation: 'auroraFloat3 20s ease-in-out infinite',
        pointerEvents: 'none',
      }} />

      {/* Subtle grid overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)
        `,
        backgroundSize: '48px 48px',
      }} />

      {/* Form panel */}
      <div style={{
        width: '90vw', maxWidth: 340, position: 'relative', zIndex: 1,
        background: DARK.surface,
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: '40px 36px',
        boxShadow: SHADOW_LG,
        backdropFilter: 'blur(20px)',
        animation: 'fadeUpIn 0.45s ease forwards',
      }}>
        {/* Brand */}
        <div style={{ marginBottom: 36, textAlign: 'center' }}>
          <div style={{
            width: 42, height: 42, borderRadius: '50%', margin: '0 auto 16px',
            background: DARK.success,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, fontWeight: 900, color: '#000',
            boxShadow: '0 0 24px rgba(30,215,96,0.4)',
          }}>T</div>
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: '0.22em',
            color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase',
          }}>
            TODO Platform
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
                border: 'none',
                boxShadow: error
                  ? 'rgb(18,18,18) 0px 1px 0px, rgb(243,114,127) 0px 0px 0px 1px inset'
                  : INSET_SHADOW,
                borderRadius: 9999,
                outline: 'none',
                padding: '12px 16px',
                fontSize: 13,
                color: DARK.text,
                fontFamily: FONT,
                boxSizing: 'border-box',
                letterSpacing: '0.1em',
                transition: 'border-color 0.2s, background 0.2s',
              }}
            />
          </div>

          {error && (
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
              color: DARK.danger, marginBottom: 12, textAlign: 'center',
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
              background: password && !loading ? DARK.success : 'rgba(255,255,255,0.06)',
              border: 'none',
              borderRadius: 9999,
              color: password && !loading ? '#000' : 'rgba(255,255,255,0.2)',
              padding: '12px 0',
              fontSize: 11, fontWeight: 800, letterSpacing: '0.22em',
              textTransform: 'uppercase', cursor: password && !loading ? 'pointer' : 'default',
              fontFamily: FONT,
              transition: 'all 0.2s',
              boxShadow: password && !loading ? 'rgba(0,0,0,0.3) 0px 4px 8px' : 'none',
            }}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{
                  width: 12, height: 12,
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
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
