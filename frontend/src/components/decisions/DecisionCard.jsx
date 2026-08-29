import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import {
  Anchor, ArrowDown, ArrowUp, Bot, Check, Download, Edit2, GitFork, GitMerge,
  Gavel, Link2, RotateCcw, Trash2, TriangleAlert, User, X, XCircle,
} from 'lucide-react'
import MarkdownPreview from '../MarkdownPreview'
import OverflowMenu from '../shared/OverflowMenu'
import { BRAND, DECISION_STATUS_COLORS as STATUS_COLORS } from '../../constants/theme'
import s from './DecisionCard.module.css'

// `superseded` is not in this table on purpose: that status is a consequence of the
// supersession edge (ADR-0118), so it is changed by withdrawing the edge, never by a
// button that would leave the edge saying the opposite.
const STATUS_ACTIONS = {
  proposed: [
    { key: 'accept', to: 'accepted', icon: <Check size={11} />, cls: 'kt-btn-accept' },
    { key: 'reject', to: 'deprecated', icon: <XCircle size={11} />, cls: 'kt-btn-danger' },
  ],
  accepted: [
    { key: 'deprecate', to: 'deprecated', icon: <XCircle size={11} />, cls: 'kt-btn-danger' },
  ],
  deprecated: [
    { key: 'reopen', to: 'proposed', icon: <RotateCcw size={11} />, cls: '' },
  ],
  superseded: [],
}

const RETIRED = new Set(['deprecated', 'superseded'])

/**
 * One decision record, with the actions that change it and the relations it has.
 *
 * Two things were wrong with the row this replaces. Only `proposed` had any status
 * control at all, so an accepted decision could not be deprecated and a rejected one
 * could not be reconsidered — the record was writable exactly once. And the five
 * controls that were always there were unlabelled `--kt-faint` glyphs, so the card
 * read as having two actions when it had seven. Status changes and the two relation
 * writes now carry a word each; the rest is behind one `⋯` (see `OverflowMenu`).
 *
 * `chainIds` is the set of decisions drawn in the same lineage rail. A relation
 * pointing inside it is already stated by the rail, so the chip is dropped — the same
 * fact said by an indent, a caption and a chip is three statements of one edge.
 */
export default function DecisionCard({
  decision, projectName, chainIds,
  onStatus, onEdit, onDelete, onExport, onSupersede, onUnsupersede, onGovern, onUngovern,
  onLink, onUnlink,
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const status = decision.decision_status || 'proposed'
  const statusStyle = STATUS_COLORS[status] || STATUS_COLORS.proposed
  const inChain = (id) => !!chainIds?.has(id)
  const supersedes = (decision.supersedes || []).filter(n => !inChain(n.id))
  const supersededBy = (decision.superseded_by || []).filter(n => !inChain(n.id))
  const governs = decision.governs || []
  // ADR-0127. `requires` is directed and drawn from both ends; `conflicts_with` is
  // symmetric and arrives already merged from the server, so the card never has to know
  // which end holds the row.
  const requires = decision.requires || []
  const requiredBy = decision.required_by || []
  const conflicts = decision.conflicts_with || []

  return (
    <div className={`kt-card kt-decision-card ${s.card} is-${status}`} style={{
      borderStyle: status === 'proposed' ? 'dashed' : 'solid',
      borderColor: status === 'proposed' ? BRAND : undefined,
    }}>
      <div className={s.head}>
        <GitFork size={14} style={{ color: statusStyle.color, marginTop: 2, flexShrink: 0 }} />
        <div className={s.body} onClick={() => setExpanded(v => !v)}>
          <div className={s.titleRow}>
            <span className={`kt-card-title ${RETIRED.has(status) ? s.retired : ''}`}>
              {decision.name}
            </span>
            <span className="kt-badge" style={{ background: statusStyle.bg, color: statusStyle.color }}>
              {t(`decisions.${status}`)}
            </span>
            {decision.source && (
              // `source` is free-form: `ai` and `manual` have a translation, and
              // production also holds `assistant` and `frontend`, which rendered as the
              // literal key `decisions.source.assistant` on the card. Whatever wrote the
              // record is a better label than the name of a missing string.
              <span className={s.source}>
                {decision.source === 'ai' ? <Bot size={10} /> : <User size={10} />}
                {t(`decisions.source.${decision.source}`, { defaultValue: decision.source })}
              </span>
            )}
          </div>
          <div className={s.meta}>
            {projectName}
            {decision.description && !expanded && (
              <span className={s.excerpt}>
                {decision.description.slice(0, 80)}{decision.description.length > 80 ? '...' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className={s.actions}>
        {(STATUS_ACTIONS[status] || []).map(action => (
          <button
            key={action.key}
            onClick={() => onStatus(decision, action.to)}
            className={`kt-btn ${action.cls} ${s.statusBtn}`}
          >
            {action.icon} {t(`decisions.${action.key}`)}
          </button>
        ))}

        {/* The two relation writes. They are the only way an edge is ever created from
            this page, and `governs` had no control at all — its client helpers existed
            with zero callers, so a decision could be linked to work by nothing. */}
        {!RETIRED.has(status) && (
          <button onClick={() => onSupersede(decision)} className={`kt-btn ${s.relBtn}`} title={t('decisions.supersede')}>
            <GitMerge size={11} /> {t('decisions.supersedeAction')}
          </button>
        )}
        <button onClick={() => onGovern(decision)} className={`kt-btn ${s.relBtn}`} title={t('decisions.governHint')}>
          <Gavel size={11} /> {t('decisions.governAction')}
        </button>

        <OverflowMenu
          items={[
            // Behind the `⋯` rather than beside `REPLACES…`/`GOVERNS…` on purpose: ADR-0122
            // weighted this row by how often the act happens, and four labelled relation
            // buttons is the wall of controls it took out. The graph view (ADR-0128) is
            // where connecting is the primary act, and there they are first-class.
            { key: 'requires', onClick: () => onLink?.(decision, 'requires'), icon: <Anchor size={12} />, label: t('decisions.requiresAction') },
            { key: 'conflicts', onClick: () => onLink?.(decision, 'conflicts_with'), icon: <TriangleAlert size={12} />, label: t('decisions.conflictsAction') },
            { key: 'node', href: `/n/${decision.id}`, icon: <Link2 size={12} />, label: t('decisions.openNode') },
            { key: 'export', onClick: () => onExport(decision), icon: <Download size={12} />, label: t('decisions.export') },
            { key: 'edit', onClick: () => onEdit(decision), icon: <Edit2 size={12} />, label: t('edit') },
            { key: 'delete', onClick: () => onDelete(decision), icon: <Trash2 size={12} />, label: t('delete'), danger: true },
          ]}
        />
      </div>

      {(supersedes.length > 0 || supersededBy.length > 0 || requires.length > 0
        || requiredBy.length > 0 || conflicts.length > 0) && (
        <div className={s.relations}>
          {/* Direction is carried by the glyph and the weight, not by a hue: this page
              already spends its colours on decision status (ADR-0088). */}
          {supersedes.map(n => (
            <button key={n.id} type="button" className={`${s.relation} ${s.replaces}`}
              onClick={() => onUnsupersede(decision, n)} title={t('decisions.unsupersede')}>
              <ArrowUp size={10} /> {t('decisions.supersedesName', { name: n.title })}
              <X size={9} className={s.relationDrop} />
            </button>
          ))}
          {supersededBy.map(n => (
            <Link key={n.id} to={`/n/${n.id}`} className={`${s.relation} ${s.replacedBy}`}>
              <ArrowDown size={10} /> {t('decisions.supersededByName', { name: n.title })}
            </Link>
          ))}
          {/* A premise this record rests on: removable here, because this end owns the
              edge. The reverse (`required_by`) is somebody else's edge, so it links and
              does not offer to cut it — the same asymmetry `supersedes` already draws. */}
          {requires.map(n => (
            <button key={`req-${n.id}`} type="button" className={`${s.relation} ${s.requires}`}
              onClick={() => onUnlink?.(decision, n, 'requires')} title={t('decisions.unrequire')}>
              <Anchor size={10} /> {t('decisions.requiresName', { name: n.title })}
              <X size={9} className={s.relationDrop} />
            </button>
          ))}
          {requiredBy.map(n => (
            <Link key={`reqby-${n.id}`} to={`/n/${n.id}`} className={`${s.relation} ${s.requiredBy}`}>
              <Anchor size={10} /> {t('decisions.requiredByName', { name: n.title })}
            </Link>
          ))}
          {/* Symmetric, so either end may cut it and the chip looks the same on both. */}
          {conflicts.map(n => (
            <button key={`cf-${n.id}`} type="button" className={`${s.relation} ${s.conflicts}`}
              onClick={() => onUnlink?.(decision, n, 'conflicts_with')} title={t('decisions.unconflict')}>
              <TriangleAlert size={10} /> {t('decisions.conflictsName', { name: n.title })}
              <X size={9} className={s.relationDrop} />
            </button>
          ))}
        </div>
      )}

      {governs.length > 0 && (
        <div className={s.governs}>
          <div className={s.governsHead}>{t('decisions.governs', { count: governs.length })}</div>
          {governs.map(n => (
            <div key={n.id} className={s.governsItem}>
              <Link2 size={10} />
              <Link to={`/n/${n.id}`} className={s.governsLink}>{n.title}</Link>
              <span className={s.governsType}>{n.type}</span>
              <button type="button" className={s.governsDrop}
                aria-label={t('decisions.ungovern', { name: n.title })}
                title={t('decisions.ungovern', { name: n.title })}
                onClick={() => onUngovern(decision, n)}>
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {expanded && decision.description && (
        <div className="kt-decision-preview">
          <MarkdownPreview content={decision.description} />
        </div>
      )}
    </div>
  )
}
