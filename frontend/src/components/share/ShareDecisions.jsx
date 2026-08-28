import { useState } from 'react'
import { GitFork, GitMerge, Link2 } from 'lucide-react'
import { DECISION_STATUS_COLORS as STATUS_COLORS } from '../../constants/theme'
import { buildDecisionLineages } from '../../utils/decisionRoom'
import s from './ShareDecisions.module.css'

const RETIRED = new Set(['deprecated', 'superseded'])
const EXCERPT = 320

/** The share payload states decisions per project; a visitor reads them as one list. */
function flatten(projects) {
  const out = []
  for (const p of projects) {
    for (const d of p.decisions || []) out.push({ ...d, project_id: p.id, project_name: p.name })
  }
  return out
}

function DecisionCard({ decision }) {
  const [open, setOpen] = useState(false)
  const status = decision.decision_status || 'proposed'
  const style = STATUS_COLORS[status] || STATUS_COLORS.proposed
  const body = decision.description || ''
  const long = body.length > EXCERPT

  return (
    <div className={`${s.card} ${RETIRED.has(status) ? s.retired : ''}`}>
      <div className={s.titleRow} onClick={() => setOpen(v => !v)}>
        <GitFork size={13} style={{ color: style.color, flexShrink: 0 }} />
        <span className={`${s.name} ${RETIRED.has(status) ? s.struck : ''}`}>{decision.name}</span>
        <span className={s.chip} style={{ background: style.bg, color: style.color }}>{status}</span>
      </div>

      {body && (
        <div className={s.body}>
          {open || !long ? body : `${body.slice(0, EXCERPT)}…`}
        </div>
      )}

      {(decision.supersedes?.length > 0 || decision.superseded_by?.length > 0 || decision.governs?.length > 0) && (
        <div className={s.relations}>
          {decision.supersedes?.map(n => (
            <span key={`s${n.id}`} className={s.relation}><GitMerge size={10} /> replaces {n.title}</span>
          ))}
          {decision.superseded_by?.map(n => (
            <span key={`b${n.id}`} className={s.relation}><GitMerge size={10} /> replaced by {n.title}</span>
          ))}
          {decision.governs?.map(n => (
            <span key={`g${n.id}`} className={s.relation}><Link2 size={10} /> {n.title}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ShareDecisions({ projects = [] }) {
  const decisions = flatten(projects)
  if (decisions.length === 0) return null

  // Grouped by project only when there is more than one, same rule the dashboard uses
  // for its own headings (ADR-0094): a single group is a heading that says nothing.
  const multi = new Set(decisions.map(d => d.project_id)).size > 1
  const groups = multi
    ? Object.entries(
      decisions.reduce((acc, d) => {
        (acc[d.project_name] ||= []).push(d)
        return acc
      }, {})
    )
    : [[null, decisions]]

  return (
    <div className={s.wrap}>
      <div className={s.head}>
        <span className={s.title}>Decisions</span>
        <span className={s.count}>{decisions.length}</span>
      </div>
      <div className={s.blurb}>Why the work is shaped the way it is, newest first.</div>

      {groups.map(([name, items]) => (
        <div key={name || '_all'} className={s.group}>
          {name && <div className={s.groupLabel}>{name}</div>}
          {/* One lineage builder for both the owner's page and this one, so a chain is
              drawn the same way on each (ADR-0118). */}
          {buildDecisionLineages(items).map(lineage => (
            <div key={lineage.id} className={s.group}>
              {lineage.chain.map(({ decision, depth }) => (
                <div key={decision.id} className={s.row} data-depth={depth} style={{ '--depth': depth }}>
                  {depth > 0 && <div className={s.replacedBy}>replaced by the decision above</div>}
                  <DecisionCard decision={decision} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
