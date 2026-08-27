import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { buildEgoNetwork } from '../../utils/egoNetwork'
import { STATUS_COLOR } from '../../constants/theme'
import s from './EgoNetwork.module.css'

// One node's neighbourhood, drawn. The relations panel lists edges one per row,
// which answers "what is attached" but never "what is this a *part of*" — two hops
// out is where a list stops being a shape. Clicking a neighbour re-centres, so the
// graph is walked rather than read.
//
// Colours come from the type registry, so a node here is the same colour it is
// everywhere else; the status ring is the ADR-0088 family, never the type's hue.

const DEFAULT_COLOR = 'var(--kt-hit, #facc15)'

const LABEL_MAX = 20

export default function EgoNetwork({ slice, centerId, typeByKey, edgeTypeByKey, onRecenter, height = 420 }) {
  const { t } = useTranslation()
  const graph = useMemo(() => buildEgoNetwork(slice, centerId), [slice, centerId])

  if (!centerId || graph.nodes.length === 0) {
    return <div className={s.empty}>{t('egoNetwork.empty')}</div>
  }
  if (graph.nodes.length === 1) {
    return <div className={s.empty}>{t('egoNetwork.isolated')}</div>
  }

  const colorOf = (node) => typeByKey?.get(node.type)?.color || DEFAULT_COLOR
  const labelOf = (node) => node.title || t('nodeExplorer.untitled')

  return (
    <div className={s.wrap}>
      {/* Drawn at its natural aspect and scrolled sideways when it is wider than the
          panel: scaling a wide neighbourhood to fit shrinks every label past reading. */}
      <svg
        viewBox={graph.viewBox}
        style={{ height, width: Math.round((graph.width / graph.height) * height) }}
        className={s.svg}
        role="img"
        aria-label={t('egoNetwork.title')}
      >
        {graph.links.map(l => {
          const containment = edgeTypeByKey?.get(l.relType)?.is_containment
          return (
            <g key={l.id}>
              <line
                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                stroke="var(--kt-line, #3a3a3a)"
                strokeWidth={containment ? 1.6 : 1}
                strokeDasharray={containment ? undefined : '3 3'}
              />
              {l.hop === 1 && (
                <text
                  className={s.relLabel}
                  x={l.x1 + (l.x2 - l.x1) * 0.55}
                  y={l.y1 + (l.y2 - l.y1) * 0.55}
                  textAnchor="middle"
                >
                  {edgeTypeByKey?.get(l.relType)?.label || l.relType}
                </text>
              )}
            </g>
          )
        })}

        {graph.nodes.map(n => {
          const color = colorOf(n)
          const isCenter = n.depth === 0
          return (
            <g
              key={n.id}
              className={s.node}
              transform={`translate(${n.x}, ${n.y})`}
              onClick={() => !isCenter && onRecenter?.(n.id)}
              role={isCenter ? undefined : 'button'}
              tabIndex={isCenter ? undefined : 0}
              onKeyDown={e => { if (!isCenter && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRecenter?.(n.id) } }}
              aria-label={labelOf(n)}
            >
              <title>{`${typeByKey?.get(n.type)?.label || n.type}: ${labelOf(n)}`}</title>
              <circle
                r={n.r}
                fill={color}
                fillOpacity={isCenter ? 0.35 : 0.18}
                stroke={n.status ? (STATUS_COLOR[n.status] || color) : color}
                strokeWidth={isCenter ? 2.5 : 1.4}
              />
              <text className={isCenter ? s.centerLabel : s.nodeLabel} y={n.r + 13} textAnchor="middle">
                {labelOf(n).length > LABEL_MAX ? `${labelOf(n).slice(0, LABEL_MAX)}…` : labelOf(n)}
              </text>
            </g>
          )
        })}
      </svg>
      {graph.truncated && <p className={s.note}>{t('egoNetwork.truncated')}</p>}
    </div>
  )
}
