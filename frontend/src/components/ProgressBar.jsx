export default function ProgressBar({ value, height = 8 }) {
  const pct = Math.min(100, Math.max(0, value ?? 0))
  const color = pct === 100 ? '#10b981' : pct > 50 ? '#4f46e5' : '#f59e0b'
  return (
    <div style={{ background: '#e5e7eb', borderRadius: 999, height, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s ease', borderRadius: 999 }} />
    </div>
  )
}
