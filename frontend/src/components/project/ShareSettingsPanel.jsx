import { useState } from 'react'
import { CalendarClock, Eye, Lock } from 'lucide-react'
import s from './ShareSettingsPanel.module.css'

/** Share-link PIN + expiry + view-count panel under the project header. */
export default function ShareSettingsPanel({
  project, expiryInput, setExpiryInput, shareViews, onSetExpiry, isPending,
  onSetPin, onClearPin, pinPending,
}) {
  const [pin, setPin] = useState('')

  const submitPin = () => {
    if (pin.length < 4) return
    onSetPin(pin)
    setPin('')
  }

  return (
    <div className={s.panel}>
      <div className={s.title}>
        Share Link Settings
      </div>
      <div className={s.desc}>
        Protect the public share link with a PIN, time-box it, and see how many times it has been viewed.
      </div>

      {/* PIN. A project is a shareable node and always accepted a PIN through the
          node API; until ADR-0072 the share page ignored it, and there was no
          control here to set or clear one. */}
      <div className={s.controls}>
        <label className={s.expiryLabel}>
          <Lock size={13} /> PIN
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter') submitPin() }}
            placeholder="4-6 digits"
            aria-label="Share PIN"
            className="kt-input"
            style={{ width: 110 }}
          />
        </label>
        <button
          onClick={submitPin}
          disabled={pin.length < 4 || pinPending}
          className={s.setBtn}
        >
          Set PIN
        </button>
        {project.share_pin_set && (
          <>
            <span className={s.expiresAt}>PIN protection active</span>
            <button onClick={onClearPin} disabled={pinPending} className={s.setBtn}>
              Remove
            </button>
          </>
        )}
      </div>

      <div className={s.controls}>
        <label className={s.expiryLabel}>
          <CalendarClock size={13} /> Expires
          <input
            type="datetime-local"
            value={expiryInput}
            onChange={e => setExpiryInput(e.target.value)}
            className="kt-input"
            style={{ width: 'auto' }}
          />
        </label>
        <button
          onClick={() => onSetExpiry(expiryInput ? new Date(expiryInput).toISOString() : null)}
          disabled={isPending}
          className={s.setBtn}
        >
          {expiryInput ? 'Set' : 'Clear'}
        </button>
        {project.share_expires_at && (
          <span className={s.expiresAt}>
            Expires {new Date(project.share_expires_at).toLocaleString()}
          </span>
        )}
        <span className={s.views}>
          <Eye size={13} /> {shareViews === null ? '—' : shareViews} views
        </span>
      </div>
    </div>
  )
}
