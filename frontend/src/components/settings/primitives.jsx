import { AlertCircle, CheckCircle2 } from 'lucide-react'
import s from './primitives.module.css'

/** Layout primitives shared by the Settings page cards (ADR-0012 CSS modules). */

export function StatusBadge({ ok, label }) {
  return (
    <span className={ok ? `${s.statusBadge} ${s.statusBadgeOk}` : s.statusBadge}>
      {ok ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
      {label}
    </span>
  )
}

export function SectionTitle({ icon, title }) {
  return (
    <div className={s.sectionTitle}>
      {icon}
      <h3 className={s.sectionTitleText}>{title}</h3>
    </div>
  )
}

export function InfoRow({ label, children }) {
  return (
    <div className={s.infoRow}>
      <span className={s.infoRowLabel}>{label}</span>
      <span className={s.infoRowValue}>{children}</span>
    </div>
  )
}

export function ControlRow({ label, hint, children }) {
  return (
    <div className={s.controlRow}>
      <div className={s.controlRowText}>
        <span className={s.infoRowLabel}>{label}</span>
        {hint && <span className={s.controlRowHint}>{hint}</span>}
      </div>
      <div className={s.controlRowControl}>{children}</div>
    </div>
  )
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className={s.segmented}>
      {options.map(opt => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={active ? `${s.segmentedBtn} ${s.segmentedBtnActive}` : s.segmentedBtn}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
