import { useState } from 'react'
import useBreakpoint from './useBreakpoint'

// Every PIN-protected share verifies at the one generic door (ADR-0039, ADR-0070);
// projects have no PIN gate.
const VERIFY_PREFIX = { node: '/share/node' }

export default function SharePinGate({ identity, token, scope = 'node', onVerified }) {
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const color = identity?.color || '#facc15'

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (pin.length < 4) return
    setLoading(true)
    setError('')
    try {
      const prefix = VERIFY_PREFIX[scope] || VERIFY_PREFIX.node
      const res = await fetch(`${prefix}/${token}/verify`, {
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
    <div className="kt-share-page kt-share-center" style={{ '--share-accent': color }}>
      <form onSubmit={handleSubmit} className={isMobile ? 'kt-share-pin is-mobile' : 'kt-share-pin'}>

        {/* Identity avatar */}
        <div className="kt-share-pin-avatar-wrap">
          <div className="kt-share-avatar">
            {identity?.avatar || (identity?.name || '?')[0].toUpperCase()}
          </div>
        </div>

        <div className="kt-share-pin-kicker">
          PROTECTED SHARE
        </div>
        <div className="kt-share-pin-name">
          {identity?.name || 'Private'}
        </div>

        <div className="kt-share-pin-hint">
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
          className={error ? 'kt-share-pin-input is-error' : 'kt-share-pin-input'}
        />

        {error && (
          <div className="kt-share-pin-error">
            {error}
          </div>
        )}

        <button type="submit" disabled={pin.length < 4 || loading} className="kt-share-pin-submit">
          {loading ? 'VERIFYING...' : 'UNLOCK'}
        </button>
      </form>
    </div>
  )
}
