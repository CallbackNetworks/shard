import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import {
  GitFork, Plus, Trash2, Edit2, Download, Check, XCircle, Bot, User,
  ArrowUpRight, GitMerge, Link2,
} from 'lucide-react'
import {
  getDecisions, getProjects, createDecision, updateDecision, deleteDecision,
  exportDecision, supersedeDecision, unsupersedeDecision,
} from '../api/client'
import { qk } from '../api/queryKeys'
import MarkdownEditor from '../components/MarkdownEditor'
import MarkdownPreview from '../components/MarkdownPreview'
import { BRAND, DARK, DECISION_STATUS_COLORS as STATUS_COLORS } from '../constants/theme'
import { buildDecisionLineages, deriveDecisionRoom } from '../utils/decisionRoom'
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

const RETIRED = new Set(['deprecated', 'superseded'])

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

function DecisionCard({
  decision, projectName, onAccept, onDeprecate, onEdit, onDelete, onExport,
  onSupersede, onUnsupersede, isMobile,
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const status = decision.decision_status || 'proposed'
  const statusStyle = STATUS_COLORS[status] || STATUS_COLORS.proposed
  const supersedes = decision.supersedes || []
  const supersededBy = decision.superseded_by || []
  const governs = decision.governs || []

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
              <span className={s.source}>
                {decision.source === 'ai' ? <Bot size={10} /> : <User size={10} />}
                {t(`decisions.source.${decision.source}`)}
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

        <div className={`${s.actions} ${isMobile ? s.actionsMobile : ''}`}>
          {status === 'proposed' && (
            <>
              <button onClick={() => onAccept(decision)} className="kt-btn kt-btn-accept" style={{ padding: '4px 10px' }}>
                <Check size={11} /> {t('decisions.accept')}
              </button>
              <button onClick={() => onDeprecate(decision)} className="kt-btn kt-btn-danger" style={{ padding: '4px 10px' }}>
                <XCircle size={11} /> {t('decisions.reject')}
              </button>
            </>
          )}
          {!RETIRED.has(status) && (
            <button onClick={() => onSupersede(decision)} className="kt-icon-btn" title={t('decisions.supersede')}>
              <GitMerge size={13} />
            </button>
          )}
          <Link to={`/n/${decision.id}`} className="kt-icon-btn" title={t('decisions.openNode')}>
            <ArrowUpRight size={13} />
          </Link>
          <button onClick={() => onExport(decision)} className="kt-icon-btn" title={t('decisions.export')}>
            <Download size={13} />
          </button>
          <button onClick={() => onEdit(decision)} className="kt-icon-btn">
            <Edit2 size={13} />
          </button>
          <button onClick={() => onDelete(decision)} className="kt-icon-btn" style={{ color: DARK.danger }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {(supersedes.length > 0 || supersededBy.length > 0) && (
        <div className={s.relations}>
          {supersedes.map(n => (
            <button key={n.id} type="button" className={s.relation}
              onClick={() => onUnsupersede(decision, n)} title={t('decisions.unsupersede')}>
              <GitMerge size={10} /> {t('decisions.supersedesName', { name: n.title })}
            </button>
          ))}
          {supersededBy.map(n => (
            <Link key={n.id} to={`/n/${n.id}`} className={s.relation}>
              <GitMerge size={10} /> {t('decisions.supersededByName', { name: n.title })}
            </Link>
          ))}
        </div>
      )}

      {governs.length > 0 && (
        <div className={s.governs}>
          <div className={s.governsHead}>{t('decisions.governs', { count: governs.length })}</div>
          {governs.map(n => (
            <Link key={n.id} to={`/n/${n.id}`} className={s.governsItem}>
              <Link2 size={10} />
              <span>{n.title}</span>
              <span className={s.governsType}>{n.type}</span>
            </Link>
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

export default function Decisions() {
  const { t } = useTranslation()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [supersedeTarget, setSupersedeTarget] = useState(null)
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

  const handleAccept = (d) => editDecision.mutate({ id: d.id, data: { decision_status: 'accepted' } })

  // Rejecting records the outcome; it does not erase the record. A decision that was
  // considered and turned down is still something that was decided (ADR-0118).
  const handleDeprecate = (d) => editDecision.mutate({ id: d.id, data: { decision_status: 'deprecated' } })

  const handleEdit = (d) => setEditTarget(d)

  const handleDelete = (d) => {
    if (window.confirm(t('issue.deleteConfirm', { title: d.name }))) {
      removeDecision.mutate({ id: d.id })
    }
  }

  const handleUnsupersede = (d, replaced) => {
    if (window.confirm(t('decisions.unsupersedeConfirm', { name: replaced.title }))) {
      unsupersede.mutate({ id: d.id, supersededId: replaced.id })
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
    onAccept: handleAccept,
    onDeprecate: handleDeprecate,
    onEdit: handleEdit,
    onDelete: handleDelete,
    onExport: handleExport,
    onSupersede: setSupersedeTarget,
    onUnsupersede: handleUnsupersede,
    isMobile,
  }

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
              <b>{lineages.length}</b>
            </div>
            {lineages.length === 0 ? (
              <div className="kt-empty kt-decision-empty">{t('decisions.noOutcomes')}</div>
            ) : (
              <div className={s.lineages}>
                {lineages.map((lineage, i) => (
                  <div key={lineage.id} className={s.lineage}
                    style={{ animation: 'fadeUpIn 0.35s ease forwards', animationDelay: `${i * 0.04}s`, opacity: 0 }}>
                    {lineage.chain.map(({ decision, depth }) => (
                      <div key={decision.id} className={s.chainRow} data-depth={depth} style={{ '--depth': depth }}>
                        {depth > 0 && (
                          <div className={s.replacedBy}>{t('decisions.replacedByAbove')}</div>
                        )}
                        <DecisionCard
                          decision={decision}
                          projectName={projectMap[decision.project_id] || ''}
                          {...cardProps}
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
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
    </div>
  )
}
