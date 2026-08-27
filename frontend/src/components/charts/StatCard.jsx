import s from './StatCard.module.css'

/**
 * Headline stat tile. Default variant is the Analytics kt-card look
 * (icon + 28px value + optional sub line); `compact` keeps the smaller
 * bordered tile used by the identity hub.
 */
export default function StatCard({ icon, label, value, sub, color, delay = 0, compact = false }) {
  if (compact) {
    return (
      <div className={s.compactCard} style={{ animationDelay: `${delay}s` }}>
        <div className={s.compactLabel}>{label}</div>
        <div className={s.compactValue} style={{ color: color || 'var(--kt-ink)' }}>{value}</div>
      </div>
    )
  }
  return (
    <div className={`kt-card ${s.card}`} style={{ animationDelay: `${delay}s` }}>
      <div className={s.labelRow}>
        {icon}{label}
      </div>
      <div className={s.value} style={{ color: color || 'var(--kt-ink)' }}>{value}</div>
      {sub && <div className={s.sub}>{sub}</div>}
    </div>
  )
}
