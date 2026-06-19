import { DIM, useCountUp } from '../OverviewViews'

const PARA_R = (px = 14) => `polygon(0 0, 100% 0, calc(100% - ${px}px) 100%, 0 100%)`

function StatCard({ label, value, sub, color, delay = 0 }) {
  const animated = useCountUp(value)
  const done = animated === value && value > 0

  return (
    <div style={{
      background: 'rgba(255,255,255,0.018)',
      borderTop: `1px solid ${color}33`,
      borderBottom: '1px solid rgba(255,255,255,0.03)',
      padding: '18px 20px',
      clipPath: PARA_R(12),
      position: 'relative',
      overflow: 'hidden',
      opacity: 0,
      animation: `shareReveal 0.5s ease-out ${delay}s forwards`,
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: color,
      }} />
      <div style={{
        fontSize: 9, fontWeight: 800, letterSpacing: '0.16em',
        textTransform: 'uppercase', color: DIM, marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 28, fontWeight: 900, color,
        letterSpacing: '-0.04em', lineHeight: 1,
        animation: done ? 'statPulse 0.4s ease-out' : 'none',
      }}>
        {animated}
        {label === 'PROGRESS' && <span style={{ fontSize: 14, fontWeight: 500, color: DIM }}>%</span>}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 4 }}>
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
        stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.05s linear' }} />
    </svg>
  )
}

export default function ShareStats({ summary, color, bp }) {
  const cols = bp === 'mobile' ? '1fr 1fr' : bp === 'tablet' ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)'

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: cols, gap: 8,
      marginBottom: 28,
    }}>
      <StatCard label="PROJECTS" value={summary.total_projects} color={color} delay={0.15} />
      <StatCard label="TASKS" value={summary.total_tasks}
        sub={`${summary.done_tasks} completed`} color="#22c55e" delay={0.2} />
      <StatCard label="PROGRESS" value={Math.round(summary.overall_progress)} color={color} delay={0.25} />
      <StatCard label="OVERDUE" value={summary.overdue_tasks}
        color={summary.overdue_tasks > 0 ? '#f87171' : DIM} delay={0.3} />
    </div>
  )
}

export { ProgressRing }
