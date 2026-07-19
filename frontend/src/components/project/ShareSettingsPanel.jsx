import { CalendarClock, Eye } from 'lucide-react'
import s from './ShareSettingsPanel.module.css'

/** Share-link expiry + view-count panel under the project header. */
export default function ShareSettingsPanel({ project, expiryInput, setExpiryInput, shareViews, onSetExpiry, isPending }) {
  return (
    <div className={s.panel}>
      <div className={s.title}>
        Share Link Settings
      </div>
      <div className={s.desc}>
        Time-box the public share link and see how many times it has been viewed.
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
