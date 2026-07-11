import { useCountUp } from '../OverviewViews'
import { STATUS_COLOR } from '../../constants/theme'

function StatCard({ label, value, sub, color, delay = 0 }) {
  const animated = useCountUp(value)
  const done = animated === value && value > 0

  return (
    <div className="kt-share-stat" style={{ '--share-accent': color, animationDelay: `${delay}s` }}>
      <div className="kt-share-stat-label">
        {label}
      </div>
      <div className="kt-share-stat-value" style={{ animation: done ? 'statPulse 0.4s ease-out' : 'none' }}>
        {animated}
        {label === 'PROGRESS' && <span>%</span>}
      </div>
      {sub && (
        <div className="kt-share-stat-sub">
          {sub}
        </div>
      )}
    </div>
  )
}

function ProgressRing({ pct, color, size = 48, stroke = 4 }) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const animated = useCountUp(pct)
  const offset = circ - (animated / 100) * circ
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="rgba(var(--kt-ink-rgb), 0.06)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.05s linear' }} />
    </svg>
  )
}

export default function ShareStats({ summary, color, bp }) {
  return (
    <div className={`kt-share-stats is-${bp}`}>
      <StatCard label="PROJECTS" value={summary.total_projects} color={color} delay={0.15} />
      <StatCard label="TASKS" value={summary.total_tasks}
        sub={`${summary.done_tasks} completed`} color={STATUS_COLOR.done} delay={0.2} />
      <StatCard label="PROGRESS" value={Math.round(summary.overall_progress)} color={color} delay={0.25} />
      <StatCard label="OVERDUE" value={summary.overdue_tasks}
        color={summary.overdue_tasks > 0 ? STATUS_COLOR.failed : 'rgba(var(--kt-ink-rgb), 0.28)'} delay={0.3} />
    </div>
  )
}

export { ProgressRing }
