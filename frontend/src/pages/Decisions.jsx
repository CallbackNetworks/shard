import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowUp, GitFork, List, Network, Plus, Search, X } from 'lucide-react'
import {
  getDecisions, getProjects, getAncestry, getNodeTypes,
  createDecision, updateDecision, deleteDecision,
  exportDecision, supersedeDecision, unsupersedeDecision,
  linkDecisionToWork, unlinkDecisionFromWork,
  linkDecisionRelation, unlinkDecisionRelation,
} from '../api/client'
import { qk } from '../api/queryKeys'
import MarkdownEditor from '../components/MarkdownEditor'
import DecisionCard from '../components/decisions/DecisionCard'
import DecisionGraph from '../components/decisions/DecisionGraph'
import DecisionGroup from '../components/decisions/DecisionGroup'
import GovernPicker from '../components/decisions/GovernPicker'
import { BRAND } from '../constants/theme'
import {
  buildDecisionGroups, buildDecisionLineages, decisionMatches,
  deriveDecisionRoom, soloLineages, splitLineages,
} from '../utils/decisionRoom'
import useBreakpoint from '../hooks/useBreakpoint'
import FormModal from '../components/shared/FormModal'
import EmptyState from '../components/shared/EmptyState'
import { useInvalidatingMutation } from '../hooks/useCrudMutations'
import FormField from '../components/shared/FormField'
import s from './Decisions.module.css'

const TEMPLATE_DESC = `## Context\n\n\n## Decision\n\n\n## Consequences\n`

// How many records a section may hold before its groups start closed. Below it the page
// looks as it always did, only filed; above it the column is a list of containers you
// open one at a time. Production's outcomes column is 91 records under 16 trails, which
// is the state this number exists for.
const AUTO_EXPAND_LIMIT = 24

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

// One picker for every decision -> decision relation (ADR-0127). Three modals listing
// the same rows and differing only in their heading would be three places to fix when the
// list needs a search box — which it did the moment production held a hundred records.
const DECISION_LINK_RELATIONS = {
  supersedes: { title: 'decisions.supersedeTitle', hint: 'decisions.supersedeHint', none: 'decisions.supersedeNone' },
  requires: { title: 'decisions.requiresTitle', hint: 'decisions.requiresHint', none: 'decisions.linkNone' },
  conflicts_with: { title: 'decisions.conflictsTitle', hint: 'decisions.conflictsHint', none: 'decisions.linkNone' },
}

function DecisionLinkPicker({ decision, relType, candidates, projectMap, onPick, onClose }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const copy = DECISION_LINK_RELATIONS[relType]
  const shown = candidates.filter(c => decisionMatches(c, query, projectMap[c.project_id]))

  return (
    <FormModal
      title={t(copy.title, { name: decision.name })}
      onClose={onClose}
      onSubmit={onClose}
      submitLabel={t('close')}
    >
      <div className="kt-page-subtitle" style={{ marginBottom: 10 }}>{t(copy.hint)}</div>
      {candidates.length === 0 ? (
        <div className="kt-empty">{t(copy.none)}</div>
      ) : (
        <>
          <label className={s.search} style={{ marginBottom: 8 }}>
            <Search size={12} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('decisions.searchPlaceholder')}
              aria-label={t('decisions.searchPlaceholder')}
            />
          </label>
          <div className={s.supersedeList}>
            {shown.map(c => (
              <button key={c.id} type="button" className={s.supersedeOption} onClick={() => onPick(c)}>
                <span>{c.name}</span>
                {/* Which project a candidate is in matters here in a way it does not on a
                    card: `requires` and `conflicts_with` reach across projects, so two
                    similarly named records are told apart by where they live. */}
                <em>{projectMap[c.project_id] || t('decisions.unfiledGroup')} · {t(`decisions.${c.decision_status || 'proposed'}`)}</em>
              </button>
            ))}
            {shown.length === 0 && <div className="kt-empty">{t('decisions.linkNone')}</div>}
          </div>
        </>
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
  // `{ decision, relType }` — one bit of state for all three decision -> decision
  // relations, because they are one picker (ADR-0127).
  const [linkTarget, setLinkTarget] = useState(null)
  const [governTarget, setGovernTarget] = useState(null)
  const [filterProject, setFilterProject] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [query, setQuery] = useState('')
  // Which groups the reader has opened or closed, against the section's own default.
  // Keyed by `<section>:<group path>` because the same container heads a group in more
  // than one section and the two are not the same disclosure.
  const [groupOverrides, setGroupOverrides] = useState({})
  // 'list' | 'graph' (ADR-0128). The list is the default because it is the mode that
  // answers "what is here"; the graph answers "how does it hang together", which is only
  // a question once there are edges.
  const [mode, setMode] = useState('list')
  const [includeUnconnected, setIncludeUnconnected] = useState(false)
  const [graphSelection, setGraphSelection] = useState(null)

  const { data: allDecisions = [], isLoading } = useQuery({
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

  const { data: nodeTypes = [] } = useQuery({
    queryKey: qk.nodeTypes(),
    queryFn: getNodeTypes,
    staleTime: 300000,
  })
  const typeByKey = useMemo(() => new Map(nodeTypes.map(nt => [nt.key, nt])), [nodeTypes])

  const projectMap = useMemo(
    () => Object.fromEntries(projects.map(p => [p.id, p.name])),
    [projects],
  )

  // The text filter narrows the *set*, and everything below — the scoreboard, the
  // lineages, the groups — is derived from it. A count beside a list it does not
  // describe is the disagreement ADR-0068 exists to prevent, applied to one page.
  const decisions = useMemo(
    () => allDecisions.filter(d => decisionMatches(d, query, projectMap[d.project_id])),
    [allDecisions, query, projectMap],
  )

  // Where each decision lives (ADR-0094). Batched over the whole set — one request per
  // card is how a page ends up not asking, which is how this one drew a project's *name*
  // and never the organization above it. Keyed on the *unfiltered* ids on purpose: keying
  // it on what the search box has narrowed to would fire a request per keystroke and
  // answer each one with a subset of what the previous answer already held.
  const ancestryIds = useMemo(
    () => allDecisions.map(d => d.id).sort(),
    [allDecisions],
  )
  const { data: ancestry = {} } = useQuery({
    queryKey: qk.ancestry(ancestryIds.join(',')),
    queryFn: () => getAncestry(ancestryIds),
    enabled: ancestryIds.length > 0,
    staleTime: 30000,
  })

  const decisionById = useMemo(() => new Map(decisions.map(d => [d.id, d])), [decisions])
  // Resolved through the live map rather than held in state: a card built from a stale
  // copy would keep showing the relation you just cut.
  const selectedDecision = graphSelection ? decisionById.get(graphSelection) : null

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
    onSuccess: () => setLinkTarget(null),
  })

  // `requires` / `conflicts_with` are plain edges, so they go through the generic edge
  // surface (ADR-0118's rule; `supersedes` is the one exception because the edge and the
  // far end's status are a single act).
  const linkRelation = useInvalidatingMutation({
    mutationFn: ({ id, otherId, relType }) => linkDecisionRelation(id, otherId, relType),
    invalidateKeys: [['decisions']],
    onSuccess: () => setLinkTarget(null),
  })

  const unlinkRelation = useInvalidatingMutation({
    mutationFn: ({ id, otherId, relType }) => unlinkDecisionRelation(id, otherId, relType),
    invalidateKeys: [['decisions']],
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

  const handleLink = (d, relType) => setLinkTarget({ decision: d, relType })

  const handleUnlink = (d, node, relType) => {
    const key = relType === 'requires' ? 'decisions.unrequireConfirm' : 'decisions.unconflictConfirm'
    if (window.confirm(t(key, { name: node.title }))) {
      unlinkRelation.mutate({ id: d.id, otherId: node.id, relType })
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

  // What may sit at the far end of each relation. `supersedes` stays inside one project —
  // that is ADR-0118's rule and the server refuses the cycle anyway. The other two reach
  // across projects on purpose: an organization-level decision being the premise of a
  // project-level one is the interesting case, not an edge case, and nothing in the
  // declaration restricts it.
  const linkCandidates = (() => {
    if (!linkTarget) return []
    const { decision: subject, relType } = linkTarget
    const already = new Set([
      ...(subject[relType] || []).map(n => n.id),
      ...(relType === 'requires' ? (subject.required_by || []).map(n => n.id) : []),
    ])
    // Filtered against the *unfiltered* set: the search box narrows what you are reading,
    // not what you are allowed to connect to.
    return allDecisions.filter(d => {
      if (d.id === subject.id || already.has(d.id)) return false
      if (relType !== 'supersedes') return true
      return d.project_id === subject.project_id
        && !(subject.supersedes || []).some(n => n.id === d.id)
        && !(d.supersedes || []).some(n => n.id === subject.id)
    })
  })()

  const cardProps = {
    onStatus: handleStatus,
    onEdit: handleEdit,
    onDelete: handleDelete,
    onExport: handleExport,
    onSupersede: (d) => handleLink(d, 'supersedes'),
    onUnsupersede: handleUnsupersede,
    onLink: handleLink,
    onUnlink: handleUnlink,
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

  /**
   * One section of the room, filed under the containers its records live in (ADR-0126).
   *
   * Every section takes the same treatment because the reason is the same in all three:
   * a column of N cards in creation order says nothing about what belongs with what, and
   * stops being readable somewhere around a screenful. The groups carry the structure and
   * the counts; opening one is what puts cards on screen.
   */
  const renderSection = (sectionKey, lineages, emptyText) => {
    const { groups, loose, total } = buildDecisionGroups(lineages, ancestry)
    // One rule for the whole section, at every level: below the limit everything starts
    // open, so a small set reads as it always did; above it everything starts closed and
    // the column is a list of containers. Deciding it per *group* instead reads better
    // while you drill and worse where it matters — the largest project is exactly the
    // one whose 24 cards would greet you at the top of the column.
    const defaultOpen = total <= AUTO_EXPAND_LIMIT
    const isOpen = (id) => groupOverrides[`${sectionKey}:${id}`] ?? defaultOpen
    const onToggle = (id) => setGroupOverrides(o => ({
      ...o,
      [`${sectionKey}:${id}`]: !(o[`${sectionKey}:${id}`] ?? defaultOpen),
    }))

    if (total === 0) return <div className="kt-empty kt-decision-empty">{emptyText}</div>
    return (
      <div className={s.groups}>
        {groups.map(group => (
          <DecisionGroup
            key={group.id}
            group={group}
            isOpen={isOpen}
            onToggle={onToggle}
            typeByKey={typeByKey}
            renderLineage={renderLineage}
          />
        ))}
        {/* Nothing contains these. They are not filed under an invented parent, and they
            are not hidden either — an unfiled decision is a real state of the graph. */}
        {loose.length > 0 && (
          <div className={s.loose}>
            <div className={s.looseHead}>{t('decisions.unfiledGroup')}</div>
            {loose.map(renderLineage)}
          </div>
        )}
      </div>
    )
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
          <div className="kt-map-segment" aria-label={t('decisions.mode')}>
            <button type="button" onClick={() => setMode('list')} className={mode === 'list' ? 'is-active' : ''}>
              <List size={12} /> {t('decisions.modeList')}
            </button>
            <button type="button" onClick={() => setMode('graph')} className={mode === 'graph' ? 'is-active' : ''}>
              <Network size={12} /> {t('decisions.modeGraph')}
            </button>
          </div>
          <button onClick={() => setShowForm(true)} className="kt-btn kt-btn-primary">
            <Plus size={13} /> {t('decisions.new')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#4b5563', fontSize: 13 }}>{t('loading')}</div>
      ) : allDecisions.length === 0 ? (
        // Only when there is genuinely nothing. A search that matches nothing must not
        // offer "create your first decision" over the top of a hundred of them.
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
        <div className={[
          isMobile ? 'kt-decision-room is-mobile' : 'kt-decision-room',
          // The graph replaces the two card columns and keeps the console: the filters
          // and the scoreboard describe the same set in either mode, so duplicating them
          // into a graph-only sidebar would be two copies of one control.
          mode === 'graph' ? 'is-graph' : '',
        ].filter(Boolean).join(' ')}>
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
              {/* Narrowing by typing is the only filter that reaches a record whose
                  project you cannot remember — which, at a hundred records, is most. */}
              <label className={s.search}>
                <Search size={12} />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={t('decisions.searchPlaceholder')}
                  aria-label={t('decisions.searchPlaceholder')}
                />
                {query && (
                  <button type="button" aria-label={t('decisions.searchClear')} onClick={() => setQuery('')}>
                    <X size={11} />
                  </button>
                )}
              </label>
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

          {mode === 'graph' ? (
            <section className="kt-decision-outcomes kt-decision-graph-pane">
              <div className="kt-decision-section-head">
                <span>{t('decisions.modeGraph')}</span>
                <b>{room.counts.total}</b>
              </div>
              <DecisionGraph
                decisions={decisions}
                includeUnconnected={includeUnconnected}
                onToggleUnconnected={() => setIncludeUnconnected(v => !v)}
                selectedId={graphSelection}
                onSelect={setGraphSelection}
                projectMap={projectMap}
              />
              {/* The same card as the list draws. Selecting a node has to give you the
                  record's own controls, or the graph is a picture you cannot act on —
                  which is what `governs` was for the whole of ADR-0118's life. */}
              {selectedDecision && (
                <div className={s.graphSelection}>
                  <DecisionCard
                    decision={selectedDecision}
                    projectName={projectMap[selectedDecision.project_id] || ''}
                    {...cardProps}
                  />
                </div>
              )}
            </section>
          ) : (
            <>
              <section className="kt-decision-queue">
                <div className="kt-decision-section-head">
                  <span>{t('decisions.pendingQueue')}</span>
                  <b>{room.queue.length}</b>
                </div>
                {renderSection('queue', soloLineages(room.queue), t('decisions.noPendingQueue'))}
              </section>

              <section className="kt-decision-outcomes">
                <div className="kt-decision-section-head">
                  <span>{t('decisions.lineage')}</span>
                  <b>{chains.length}</b>
                </div>
                {renderSection('chains', chains, t('decisions.noChains'))}

                <div className="kt-decision-section-head">
                  <span>{t('decisions.standalone')}</span>
                  <b>{singles.length}</b>
                </div>
                {renderSection('singles', singles, t('decisions.noOutcomes'))}
              </section>
            </>
          )}
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

      {linkTarget && (
        <DecisionLinkPicker
          decision={linkTarget.decision}
          relType={linkTarget.relType}
          candidates={linkCandidates}
          projectMap={projectMap}
          onPick={(c) => (linkTarget.relType === 'supersedes'
            ? supersede.mutate({ id: linkTarget.decision.id, supersededId: c.id })
            : linkRelation.mutate({ id: linkTarget.decision.id, otherId: c.id, relType: linkTarget.relType }))}
          onClose={() => setLinkTarget(null)}
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
