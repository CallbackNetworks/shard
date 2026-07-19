/** Lightweight in-SVG tooltip; flips horizontally near the right edge. */
export default function SvgTooltip({ x, y, text, svgWidth }) {
  if (!text) return null
  const lines = text.split('\n')
  const lineH = 14
  const padX = 8, padY = 6
  const charW = 6.5
  const maxLen = Math.max(...lines.map(l => l.length))
  const boxW = maxLen * charW + padX * 2
  const boxH = lines.length * lineH + padY * 2
  // Flip horizontally if too close to right edge
  const adjustedX = (x + boxW + 8 > svgWidth) ? x - boxW - 8 : x + 8
  const adjustedY = Math.max(2, y - boxH / 2)

  return (
    <g>
      <rect x={adjustedX} y={adjustedY} width={boxW} height={boxH} rx={4}
        fill="rgba(0,0,0,0.85)" stroke="rgba(var(--kt-ink-rgb), 0.15)" strokeWidth={0.5} />
      {lines.map((line, i) => (
        <text key={i} x={adjustedX + padX} y={adjustedY + padY + (i + 1) * lineH - 3}
          fontSize={11} fill="#fff" fontFamily="system-ui">{line}</text>
      ))}
    </g>
  )
}
