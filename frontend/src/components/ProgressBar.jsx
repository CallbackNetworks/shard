import { STATUS_COLOR } from '../constants/theme'

export default function ProgressBar({ value, height = 6 }) {
  const pct = Math.min(100, Math.max(0, value ?? 0))
  const color = pct === 100 ? STATUS_COLOR.done : pct > 50 ? STATUS_COLOR.in_progress : '#f59e0b'
  return (
    <div className="kt-progress-track" style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 0, height, overflow: 'hidden' }}>
      <div className="kt-progress-fill" style={{
        width: `${pct}%`, height: '100%',
        background: color,
        transition: 'width 0.4s ease', borderRadius: 0,
        opacity: pct === 0 ? 0 : 1,
      }} />
    </div>
  )
}
