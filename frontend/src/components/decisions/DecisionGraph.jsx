import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Anchor, ArrowRight, Gavel, GitMerge, TriangleAlert } from 'lucide-react'
import { buildDecisionGraph, decisionLinkPath } from '../../utils/decisionGraph'
import { DECISION_STATUS_COLORS as STATUS_COLORS } from '../../constants/theme'
import s from './DecisionGraph.module.css'

// One row per relation, and the legend reads from the same table the canvas draws from —
// a legend maintained beside the renderer is the drifted duplicate ADR-0087 is about.
export const GRAPH_RELATIONS = [
  { rel: 'supersedes', icon: <GitMerge size={11} />, cls: 'supersedes', arrow: true },
  { rel: 'requires', icon: <Anchor size={11} />, cls: 'requires', arrow: true },
  // No arrowhead: the claim is symmetric. The row is still stored one way (ADR-0127),
  // and drawing that direction would say something the data does not.
  { rel: 'conflicts_with', icon: <TriangleAlert size={11} />, cls: 'conflicts', arrow: false },
  { rel: 'governs', icon: <Gavel size={11} />, cls: 'governs', arrow: true },
]

const CLS_BY_REL = Object.fromEntries(GRAPH_RELATIONS.map(r => [r.rel, r.cls]))
const ARROW_BY_REL = Object.fromEntries(GRAPH_RELATIONS.map(r => [r.rel, r.arrow]))

/**
 * The decision graph (ADR-0128): what rests on what, what contradicts what, what it decides.
 *
 * Layout comes from `utils/decisionGraph` and is deterministic — the same input draws the
 * same picture every time, which a force simulation cannot promise and which matters here
 * because position *is* the answer: a column is how far a decision stands above its
 * premises, and the lower band is the work.
 *
 * Selecting a node dims everything it does not touch. That is the whole interaction: the
 * questions this view answers are local to one record, and a graph that highlights nothing
 * makes the reader trace lines by eye.
 */
export default function DecisionGraph({
  decisions, includeUnconnected, onToggleUnconnected, selectedId, onSelect, projectMap = {},
}) {
  const { t } = useTranslation()
  const graph = useMemo(
    () => buildDecisionGraph(decisions, { includeUnconnected }),
    [decisions, includeUnconnected],
  )

  // Which ids the selection touches. Computed from the links actually drawn, so a
  // relation pointing off-screen cannot light up a node that is not there.
  const touched = useMemo(() => {
    if (!selectedId) return null
    const ids = new Set([selectedId])
    for (const link of graph.links) {
      if (link.from === selectedId) ids.add(link.to)
      if (link.to === selectedId) ids.add(link.from)
    }
    return ids
  }, [graph.links, selectedId])

  const isMuted = (id) => !!touched && !touched.has(id)

  return (
    <div className={s.root}>
      <div className={s.legend}>
        {GRAPH_RELATIONS.map(r => (
          <span key={r.rel} className={s.legendItem}>
            <i className={`${s.swatch} ${s[r.cls]}`} />
            {r.icon}
            {t(`decisions.graph.${r.rel}`)}
          </span>
        ))}
        {/* Counted, never silently dropped: "99 of these have no relations" is the most
            useful thing this page can say about a hundred records. */}
        <button type="button" className={s.unconnected} onClick={onToggleUnconnected}>
          {includeUnconnected
            ? t('decisions.graph.hideUnconnected')
            : t('decisions.graph.showUnconnected', { count: graph.unconnected })}
        </button>
      </div>

      {graph.nodes.length === 0 ? (
        <div className="kt-empty kt-decision-empty">
          <div>{t('decisions.graph.empty')}</div>
          <div className={s.emptyHint}>{t('decisions.graph.emptyHint')}</div>
        </div>
      ) : (
        <div className={s.scroll}>
          <div className={s.canvas} style={{ width: graph.width, height: graph.height }}>
            <svg className={s.links} viewBox={`0 0 ${graph.width} ${graph.height}`} aria-hidden="true">
              <defs>
                <marker id="kt-dg-arrow" viewBox="0 0 8 8" refX="7" refY="4"
                  markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
                </marker>
              </defs>
              {graph.links.map(link => (
                <path
                  key={`${link.rel}-${link.from}-${link.to}`}
                  className={[
                    s.link,
                    s[CLS_BY_REL[link.rel]],
                    (isMuted(link.from) || isMuted(link.to)) ? s.linkMuted : '',
                  ].filter(Boolean).join(' ')}
                  d={decisionLinkPath(link.source, link.target)}
                  markerEnd={ARROW_BY_REL[link.rel] ? 'url(#kt-dg-arrow)' : undefined}
                />
              ))}
            </svg>

            {graph.nodes.map(node => {
              const style = node.kind === 'decision'
                ? (STATUS_COLORS[node.status] || STATUS_COLORS.proposed)
                : null
              return (
                <button
                  key={node.id}
                  type="button"
                  className={[
                    s.node,
                    node.kind === 'work' ? s.work : s.decision,
                    node.id === selectedId ? s.selected : '',
                    isMuted(node.id) ? s.muted : '',
                  ].filter(Boolean).join(' ')}
                  style={{
                    left: node.x, top: node.y, width: node.w, height: node.h,
                    ...(style ? { '--node-color': style.color } : {}),
                  }}
                  onClick={() => onSelect(node.kind === 'decision' ? node.id : null)}
                  title={node.name}
                >
                  <span className={s.nodeName}>{node.name}</span>
                  <span className={s.nodeMeta}>
                    {node.kind === 'decision'
                      ? `${projectMap[node.decision.project_id] || ''} · ${t(`decisions.${node.status}`)}`
                      : node.type}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {graph.nodes.length > 0 && (
        <div className={s.axis}>
          <ArrowRight size={10} />
          {t('decisions.graph.axisHint')}
        </div>
      )}
    </div>
  )
}
