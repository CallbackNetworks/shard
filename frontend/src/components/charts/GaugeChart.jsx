export default function GaugeChart({ value = 0, max = 100, size = 120, color = '#ef4444', label }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0
  const radius = (size - 16) / 2
  const circumference = Math.PI * radius
  const arcLen = pct * circumference
  const cx = size / 2
  const cy = size / 2 + 8

  const displayPct = Math.round(pct * 100)
  const gradientId = `gauge-${Math.random().toString(36).slice(2, 8)}`

  return (
    <svg width={size} height={size * 0.7} viewBox={`0 0 ${size} ${size * 0.7}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={color + '66'} />
          <stop offset="100%" stopColor={color} />
        </linearGradient>
      </defs>

      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={8} strokeLinecap="round"
      />

      {pct > 0 && (
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none" stroke={`url(#${gradientId})`} strokeWidth={8} strokeLinecap="round"
          strokeDasharray={`${arcLen} ${circumference}`}
        />
      )}

      <text x={cx} y={cy - 8} textAnchor="middle" dominantBaseline="middle"
        fontSize={size * 0.2} fontWeight={800} fill="#fff" fontFamily="system-ui">
        {displayPct}%
      </text>

      {label && (
        <text x={cx} y={cy + 8} textAnchor="middle" dominantBaseline="middle"
          fontSize={9} fill="rgba(255,255,255,0.35)" fontFamily="system-ui">
          {label}
        </text>
      )}
    </svg>
  )
}
