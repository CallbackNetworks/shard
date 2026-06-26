export default function ProgressBar({ value, height = 6 }) {
  const pct = Math.min(100, Math.max(0, value ?? 0))
  const color = pct === 100 ? '#00ff41' : pct > 50 ? '#00f0ff' : '#ffb800'
  return (
    <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 999, height, overflow: 'hidden' }}>
      <div style={{
        width: `${pct}%`, height: '100%',
        background: color,
        transition: 'width 0.4s ease', borderRadius: 999,
        opacity: pct === 0 ? 0 : 1,
      }} />
    </div>
  )
}
