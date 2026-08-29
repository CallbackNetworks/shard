import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowUp, GitFork, Plus, X } from 'lucide-react'
import {
  getDecisions, getProjects, createDecision, updateDecision, deleteDecision,
  exportDecision, supersedeDecision, unsupersedeDecision,
  linkDecisionToWork, unlinkDecisionFromWork,
} from '../api/client'
import { qk } from '../api/queryKeys'
import MarkdownEditor from '../components/MarkdownEditor'
import DecisionCard from '../components/decisions/DecisionCard'
import GovernPicker from '../components/decisions/GovernPicker'
import { BRAND } from '../constants/theme'
import { buildDecisionLineages, deriveDecisionRoom, splitLineages } from '../utils/decisionRoom'
import useBreakpoint from '../hooks/useBreakpoint'
import FormModal from '../components/shared/FormModal'
import EmptyState from '../components/shared/EmptyState'
import { useInvalidatingMutation } from '../hooks/useCrudMutations'
import FormField from '../components/shared/FormField'
import s from './Decisions.module.css'

const TEMPLATE_DESC = `## Context\n\n\n## Decision\n\n\n## Consequences\n`

const DECISION_SNIPPETS = [
  { key: 'context', text: '## Context\n\n' },
  { key: 'decision', text: '## Decision\n\n' },
  { key: 'consequences', text: '## Consequences\n\n' },
  { key: 'tradeoffs', text: '## Tradeoffs\n\n- \n' },
  { key: 'followups', text: '## Follow-ups\n\n- [ ] \n' },
]

function DecisionForm({ projects, initial, onSave, onClose }) {
  const { t } = useTranslation()
  const [form, setForm] = useState(initial ? {
    name: initial.name,
    description: initial.description || '',
    project_id: initial.project_id,
    color: initial.color || BRAND,
  } : {
    name: '',
    description: TEMPLATE_DESC,
    project_id: projects[0]?.id || '',
    color: BRAND,
  })

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))
  const insertSnippet = (text) => {
    setForm(f => ({
      ...f,
      description: `${f.description || ''}${f.description?.endsWith('\n') ? '' : '\n\n'}${text}`,
    }))
  }

  return (
    <FormModal
      title={initial ? t('decisions.editTitle') : t('decisions.createTitle')}
      onClose={onClose}
      onSubmit={() => form.name.trim() && form.project_id && onSave(form)}
      submitLabel={initial ? t('save') : t('create')}
      submitDisabled={!form.name.trim() || !form.project_id}
      wide
    >
      <FormField label={t('decisions.projectLabel')} required>
        <select value={form.project_id} onChange={e => set('project_id', e.target.value)} className="kt-input">
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </FormField>

      <FormField label={t('decisions.nameLabel')} required>
        <input value={form.name} onChange={e => set('name', e.target.value)}
          placeholder={t('decisions.namePlaceholder')} className="kt-input" />
      </FormField>

      <FormField label={t('decisions.descriptionLabel')}>
        <div className="kt-decision-editor-tools">
          {DECISION_SNIPPETS.map(snippet => (
            <button key={snippet.key} type="button" onClick={() => insertSnippet(snippet.text)}>
              {t(`decisions.snippet.${snippet.key}`)}
            </button>
          ))}
        </div>
        <MarkdownEditor
          value={form.description}
          onChange={val => set('description', val)}
          placeholder={t('decisions.contextPlaceholder')}
          minHeight={260}
        />
      </FormField>
    </FormModal>
  )
}

/** Pick the record this decision replaces. Only decisions in the same project are
 *  offered, and never one already in this decision's own lineage. */
function SupersedePicker({ decision, candidates, onPick, onClose }) {
  const { t } = useTranslation()
  return (
    <FormModal
      title={t('decisions.supersedeTitle', { name: decision.name })}
      onClose={onClose}
      onSubmit={onClose}
      submitLabel={t('close')}
    >
      <div className="kt-page-subtitle" style={{ marginBottom: 10 }}>{t('decisions.supersedeHint')}</div>
      {candidates.length === 0 ? (
        <div className="kt-empty">{t('decisions.supersedeNone')}</div>
      ) : (
        <div className={s.supersedeList}>
          {candidates.map(c => (
            <button key={c.id} type="button" className={s.supersedeOption} onClick={() => onPick(c)}>
              <span>{c.name}</span>
              <em>{t(`decisions.${c.decision_status || 'proposed'}`)}</em>
            </button>
          ))}
        </div>
      )}
    </FormModal>
  )
}

export default function Decisions() {
  const { t } = useTranslation()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [supersedeTarget, setSupersedeTarget] = useState(null)
  const [governTarget, setGovernTarget] = useState(null)
  const [filterProject, setFilterProject] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const { data: decisions = [], isLoading } = useQuery({
    queryKey: qk.decisions(filterProject, filterStatus),
    queryFn: () => getDecisions({
      ...(filterProject ? { project_id: filterProject } : {}),
      ...(filterStatus ? { status: filterStatus } : {}),
    }),
  })

  const { data: projects = [] } = useQuery({
    queryKey: qk.projects(),
    queryFn: getProjects,
  })

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]))
  const decisionById = useMemo(() => new Map(decisions.map(d => [d.id, d])), [decisions])

  const room = deriveDecisionRoom(decisions)
  const pendingCount = room.counts.proposed
  // Lineages are built over *every* decision, then the ones that are purely a queue item
  // are dropped. Building them over the outcomes alone decapitated any chain whose newest
  // record was still proposed — the replaced decision showed up as its own head while its
  // own card said it had been replaced. A pending decision that heads a chain earns its
  // place here; a pending decision with no relations is only an action, and stays in the
  // queue rather than appearing twice on one screen.
  const lineages = buildDecisionLineages(decisions)
    .filter(l => l.chain.length > 1 || (l.head.decision_status || 'proposed') !== 'proposed')
  // A chain of one is a record, not a history. Kept apart so the chain count is the
  // number of chains: production has 103 decisions and one supersession, and a single
  // section listing both made the one real chain indistinguishable from the 102.
  const { chains, singles } = splitLineages(lineages)

  const createDecisionMut = useInvalidatingMutation({
    mutationFn: (form) => createDecision(form.project_id, {
      name: form.name,
      color: form.color || BRAND,
      description: form.description,
      decision_status: 'proposed',
      source: 'manual',
    }),
    invalidateKeys: [['decisions']],
    onSuccess: () => setShowForm(false),
  })

  const editDecision = useInvalidatingMutation({
    mutationFn: ({ id, data }) => updateDecision(id, data),
    invalidateKeys: [['decisions']],
    onSuccess: () => setEditTarget(null),
  })

  const removeDecision = useInvalidatingMutation({
    mutationFn: ({ id }) => deleteDecision(id),
    invalidateKeys: [['decisions']],
  })

  const supersede = useInvalidatingMutation({
    mutationFn: ({ id, supersededId }) => supersedeDecision(id, supersededId),
    invalidateKeys: [['decisions']],
    onSuccess: () => setSupersedeTarget(null),
  })

  const unsupersede = useInvalidatingMutation({
    mutationFn: ({ id, supersededId }) => unsupersedeDecision(id, supersededId),
    invalidateKeys: [['decisions']],
  })

  // `governs` writes go through the generic edge surface (ADR-0118); the two client
  // helpers for it existed from the start with no caller, which is why the relation
  // could be read on a card and created by nothing.
  const govern = useInvalidatingMutation({
    mutationFn: ({ id, nodeId }) => linkDecisionToWork(id, nodeId),
    invalidateKeys: [['decisions'], ['governing-decisions']],
  })

  const ungovern = useInvalidatingMutation({
    mutationFn: ({ id, nodeId }) => unlinkDecisionFromWork(id, nodeId),
    invalidateKeys: [['decisions'], ['governing-decisions']],
  })

  // Rejecting records the outcome; it does not erase the record. A decision that was
  // considered and turned down is still something that was decided (ADR-0118). Every
  // status is reachable from every other one except `superseded`, which the supersession
  // edge owns — the card offers no button that would contradict an edge.
  const handleStatus = (d, status) => editDecision.mutate({ id: d.id, data: { decision_status: status } })

  const handleEdit = (d) => setEditTarget(d)

  const handleDelete = (d) => {
    if (window.confirm(t('issue.deleteConfirm', { title: d.name }))) {
      removeDecision.mutate({ id: d.id })
    }
  }

  // `newer` replaced `older`; withdrawing is the same act whether it is asked for on the
  // chip of a card or on the rail that draws the same edge inside a chain.
  const handleUnsupersede = (newer, older) => {
    if (!newer || !older) return
    const name = older.title || older.name
    if (window.confirm(t('decisions.unsupersedeConfirm', { name }))) {
      unsupersede.mutate({ id: newer.id, supersededId: older.id })
    }
  }

  const handleUngovern = (d, node) => {
    if (window.confirm(t('decisions.ungovernConfirm', { name: node.title }))) {
      ungovern.mutate({ id: d.id, nodeId: node.id })
    }
  }

  const handleExport = async (d) => {
    try {
      const md = await exportDecision(d.id)
      const blob = new Blob([md], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `decision-${d.name.replace(/\s+/g, '-').toLowerCase()}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }

  // Offered as "what this replaces": same project, not itself, and not already in this
  // decision's own chain — superseding your own ancestor is the cycle the server refuses.
  const supersedeCandidates = supersedeTarget
    ? decisions.filter(d =>
      d.id !== supersedeTarget.id &&
      d.project_id === supersedeTarget.project_id &&
      !(supersedeTarget.supersedes || []).some(n => n.id === d.id) &&
      !(d.supersedes || []).some(n => n.id === supersedeTarget.id))
    : []

  const cardProps = {
    onStatus: handleStatus,
    onEdit: handleEdit,
    onDelete: handleDelete,
    onExport: handleExport,
    onSupersede: setSupersedeTarget,
    onUnsupersede: handleUnsupersede,
    onGovern: setGovernTarget,
    onUngovern: handleUngovern,
  }

  const renderLineage = (lineage, i) => (
    <div key={lineage.id} className={s.lineage}
      style={{ animation: 'fadeUpIn 0.35s ease forwards', animationDelay: `${i * 0.04}s`, opacity: 0 }}>
      {lineage.chain.map(({ decision, depth, parentId }) => (
        <div key={decision.id} className={s.chainRow} data-depth={depth} style={{ '--depth': depth }}>
          {depth > 0 && (
            // The connector *is* the supersession edge, so the control that withdraws it
            // sits on the connector. The card inside a chain drops the matching chip:
            // an indent, a caption and a chip were three renderings of one edge.
            <div className={s.chainLink}>
              <ArrowUp size={10} />
              <span>{t('decisions.replacedByAbove')}</span>
              <button type="button" className={s.chainLinkDrop}
                aria-label={t('decisions.unsupersede')} title={t('decisions.unsupersede')}
                onClick={() => handleUnsupersede(decisionById.get(parentId), decision)}>
                <X size={10} />
              </button>
            </div>
          )}
          <DecisionCard
            decision={decision}
            projectName={projectMap[decision.project_id] || ''}
            chainIds={lineage.chainIds}
            {...cardProps}
          />
        </div>
      ))}
    </div>
  )

  return (
    <div className="kt-page kt-decision-room-page">
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 className="kt-page-title">{t('decisions.title')}</h1>
            {pendingCount > 0 && (
              <span className="kt-badge kt-badge-accent" style={{ padding: '2px 8px' }}>
                {t('decisions.pendingReview', { count: pendingCount })}
              </span>
            )}
          </div>
          <div className="kt-page-subtitle">
            {t('decisions.subtitle')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowForm(true)} className="kt-btn kt-btn-primary">
            <Plus size={13} /> {t('decisions.new')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#4b5563', fontSize: 13 }}>{t('loading')}</div>
      ) : decisions.length === 0 ? (
        <EmptyState
          icon={<GitFork size={36} className="kt-empty-icon" />}
          message={t('decisions.empty')}
          hint={t('decisions.emptyHint')}
          action={(
            <button onClick={() => setShowForm(true)} className="kt-btn kt-btn-primary">
              {t('decisions.new')}
            </button>
          )}
        />
      ) : (
        <div className={isMobile ? 'kt-decision-room is-mobile' : 'kt-decision-room'}>
          <aside className="kt-decision-console">
            <div className="kt-decision-console-title">
              <GitFork size={13} />
              {t('decisions.room')}
            </div>

            <div className="kt-decision-scoreboard">
              <div><span>{room.counts.proposed}</span><b>{t('decisions.proposed')}</b></div>
              <div><span>{room.counts.accepted}</span><b>{t('decisions.accepted')}</b></div>
              <div><span>{room.counts.superseded + room.counts.deprecated}</span><b>{t('decisions.archived')}</b></div>
              <div><span>{room.counts.governing}</span><b>{t('decisions.governingCount')}</b></div>
            </div>

            <div className="kt-decision-filter-stack">
              <select value={filterProject} onChange={e => setFilterProject(e.target.value)} className="kt-input">
                <option value="">{t('decisions.allProjects')}</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="kt-input">
                <option value="">{t('decisions.allStatuses')}</option>
                <option value="proposed">{t('decisions.proposed')}</option>
                <option value="accepted">{t('decisions.accepted')}</option>
                <option value="deprecated">{t('decisions.deprecated')}</option>
                <option value="superseded">{t('decisions.superseded')}</option>
              </select>
            </div>
          </aside>

          <section className="kt-decision-queue">
            <div className="kt-decision-section-head">
              <span>{t('decisions.pendingQueue')}</span>
              <b>{room.queue.length}</b>
            </div>
            {room.queue.length === 0 ? (
              <div className="kt-empty kt-decision-empty">{t('decisions.noPendingQueue')}</div>
            ) : (
              <div className="kt-decision-stack">
                {room.queue.map((d, i) => (
                  <div key={d.id} style={{ animation: 'fadeUpIn 0.35s ease forwards', animationDelay: `${i * 0.06}s`, opacity: 0 }}>
                    <DecisionCard decision={d} projectName={projectMap[d.project_id] || ''} {...cardProps} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="kt-decision-outcomes">
            <div className="kt-decision-section-head">
              <span>{t('decisions.lineage')}</span>
              <b>{chains.length}</b>
            </div>
            {chains.length === 0 ? (
              <div className="kt-empty kt-decision-empty">{t('decisions.noChains')}</div>
            ) : (
              <div className={s.lineages}>{chains.map(renderLineage)}</div>
            )}

            <div className="kt-decision-section-head">
              <span>{t('decisions.standalone')}</span>
              <b>{singles.length}</b>
            </div>
            {singles.length === 0 ? (
              <div className="kt-empty kt-decision-empty">{t('decisions.noOutcomes')}</div>
            ) : (
              <div className={s.singles}>{singles.map(renderLineage)}</div>
            )}
          </section>
        </div>
      )}

      {(showForm || editTarget) && (
        <DecisionForm
          projects={projects}
          initial={editTarget}
          onSave={(form) => {
            if (editTarget) {
              editDecision.mutate({
                id: editTarget.id,
                data: { name: form.name, description: form.description, color: form.color },
              })
            } else {
              createDecisionMut.mutate(form)
            }
          }}
          onClose={() => { setShowForm(false); setEditTarget(null) }}
        />
      )}

      {supersedeTarget && (
        <SupersedePicker
          decision={supersedeTarget}
          candidates={supersedeCandidates}
          onPick={(c) => supersede.mutate({ id: supersedeTarget.id, supersededId: c.id })}
          onClose={() => setSupersedeTarget(null)}
        />
      )}

      {governTarget && (
        <GovernPicker
          decision={decisionById.get(governTarget.id) || governTarget}
          onPick={(node) => govern.mutate({ id: governTarget.id, nodeId: node.id })}
          onDrop={(node) => ungovern.mutate({ id: governTarget.id, nodeId: node.id })}
          onClose={() => setGovernTarget(null)}
        />
      )}
    </div>
  )
}
