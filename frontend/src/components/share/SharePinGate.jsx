import { useState } from 'react'
import useBreakpoint from './useBreakpoint'
import { FONT, BG, DIM, HI } from '../OverviewViews'

const PARA_R = (px = 14) => `polygon(0 0, 100% 0, calc(100% - ${px}px) 100%, 0 100%)`

export default function SharePinGate({ identity, token, onVerified }) {
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const color = identity?.color || '#00f0ff'

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (pin.length < 4) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/share/identity/${token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json()
        onVerified(data)
      } else {
        const err = await res.json().catch(() => ({}))
        setError(err.detail || 'Invalid PIN')
        setPin('')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: BG, fontFamily: FONT,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: HI,
    }}>
      {/* Aurora background */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        overflow: 'hidden', pointerEvents: 'none',
      }}>
        <div style={{
          position: 'absolute', width: 300, height: 300,
          top: '20%', left: '30%',
          background: `radial-gradient(circle, ${color}0c 0%, transparent 70%)`,
          animation: 'auroraFloat1 14s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', width: 250, height: 250,
          bottom: '20%', right: '25%',
          background: `radial-gradient(circle, ${color}08 0%, transparent 70%)`,
          animation: 'auroraFloat2 17s ease-in-out infinite',
        }} />
      </div>

      <form onSubmit={handleSubmit} style={{
        position: 'relative',
        background: 'rgba(255,255,255,0.02)',
        borderTop: `1px solid ${color}33`,
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        padding: isMobile ? '32px 20px' : '40px 48px',
        clipPath: isMobile ? 'none' : PARA_R(20),
        width: '100%', maxWidth: 380,
        animation: 'shareReveal 0.5s ease-out forwards',
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
          background: color,
        }} />

        {/* Identity avatar */}
        <div style={{
          display: 'flex', justifyContent: 'center', marginBottom: 24,
        }}>
          <div style={{
            width: 56, height: 56,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, fontWeight: 900, color,
            background: `${color}14`, border: `2px solid ${color}33`,
            borderRadius: '50%',
            boxShadow: `0 0 24px ${color}18`,
          }}>
            {identity?.avatar || (identity?.name || '?')[0].toUpperCase()}
          </div>
        </div>

        <div style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.2em',
          textTransform: 'uppercase', color: DIM, textAlign: 'center',
          marginBottom: 6,
        }}>
          PROTECTED SHARE
        </div>
        <div style={{
          fontSize: 16, fontWeight: 800, color: HI, textAlign: 'center',
          marginBottom: 24,
        }}>
          {identity?.name || 'Private'}
        </div>

        <div style={{
          fontSize: 11, color: DIM, textAlign: 'center', marginBottom: 16,
        }}>
          Enter the PIN to view this page
        </div>

        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder="Enter PIN"
          autoFocus
          style={{
            width: '100%', padding: '12px 16px',
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${error ? '#ff2d55' : 'rgba(255,255,255,0.1)'}`,
            color: HI, fontSize: 18, fontWeight: 700,
            letterSpacing: '0.3em', textAlign: 'center',
            outline: 'none', fontFamily: FONT,
            transition: 'border-color 0.2s',
            boxSizing: 'border-box',
          }}
        />

        {error && (
          <div style={{
            fontSize: 11, color: '#ff2d55', textAlign: 'center',
            marginTop: 8, fontWeight: 600,
          }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={pin.length < 4 || loading} style={{
          width: '100%', marginTop: 16, padding: '10px 0',
          background: pin.length >= 4 ? color : 'rgba(255,255,255,0.06)',
          color: pin.length >= 4 ? '#000' : DIM,
          border: 'none', cursor: pin.length >= 4 ? 'pointer' : 'default',
          fontSize: 11, fontWeight: 800, letterSpacing: '0.14em',
          textTransform: 'uppercase', fontFamily: FONT,
          transition: 'background 0.2s, color 0.2s',
          opacity: loading ? 0.6 : 1,
        }}>
          {loading ? 'VERIFYING...' : 'UNLOCK'}
        </button>
      </form>
    </div>
  )
}
