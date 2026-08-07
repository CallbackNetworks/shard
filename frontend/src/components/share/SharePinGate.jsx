import { useState } from 'react'
import useBreakpoint from './useBreakpoint'

// One verify door for every shareable node, whichever page the visitor is on
// (ADR-0070, ADR-0071). It resolves the token and dispatches on the node's type, so a
// project unlocks here exactly like an identity does — the scope-to-prefix map this
// replaced silently fell back to the identity path for anything it did not list.
const VERIFY_URL = (token) => `/share/node/${token}/verify`

export default function SharePinGate({ identity, token, onVerified }) {
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
      const res = await fetch(VERIFY_URL(token), {
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
