import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown, ChevronRight, GitFork, Target, UserRound, Users } from 'lucide-react'
import { STATUS_COLOR } from '../../constants/theme'
import { riskColor } from '../../utils/structureMapLayout'
import { computeTerritoryHighlight } from '../../utils/territoryModel'
import s from './TerritoryCanvas.module.css'

const TASK_CHIP_LIMIT = 12
const GOAL_LIMIT = 12

function cx(...names) {
  return names.filter(Boolean).join(' ')
}

// Curve between two element rects, measured relative to the canvas content box.
function overlayPath(fromRect, toRect, base) {
  const x1 = fromRect.left + fromRect.width / 2 - base.left
  const y1 = fromRect.top + fromRect.height / 2 - base.top
  const x2 = toRect.left + toRect.width / 2 - base.left
  const y2 = toRect.top + toRect.height / 2 - base.top
  const bend = Math.max(24, Math.abs(y2 - y1) * 0.35)
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`
}

export default function TerritoryCanvas({
  model,
  dependencyLinks,
  selected,
  selectedNodeKey,
  onSelect,
  onOpen,
  showEmpty,
  onClearFilters,
}) {
  const { t } = useTranslation()
  const contentRef = useRef(null)
  const nodeEls = useRef(new Map())
  const [expanded, setExpanded] = useState(() => new Set())
  const [paths, setPaths] = useState([])

  const registerNode = (key) => (el) => {
    if (el) nodeEls.current.set(key, el)
    else nodeEls.current.delete(key)
  }

  const highlight = useMemo(
    () => computeTerritoryHighlight(selected, model, dependencyLinks),
    [selected, model, dependencyLinks]
  )

  // Risky projects start expanded so their warning tasks are visible at once.
  useEffect(() => {
    setExpanded(prev => {
      const next = new Set(prev)
      for (const project of model.projectById.values()) {
        if (project.failed > 0 || project.overdue > 0) next.add(project.id)
      }
      return next
    })
  }, [model])

  // Selecting a task pulls every card in its dependency neighborhood open so
  // the overlay lines have chips to land on.
  useEffect(() => {
    if (!highlight?.chipKeys || selected?.type !== 'task') return
    setExpanded(prev => {
      const missing = [...highlight.projectIds].filter(id => !prev.has(id))
      if (missing.length === 0) return prev
      const next = new Set(prev)
      for (const id of missing) next.add(id)
      return next
    })
  }, [highlight, selected])

  const linePairs = useMemo(() => {
    if (!selected) return []
    if (selected.type === 'goal') {
      const goal = model.goals.find(item => item.id === selected.id)
      return (goal?.linkedProjectIds || []).map(projectId => ({
        from: `goal:${selected.id}`,
        to: `project:${projectId}`,
        color: STATUS_COLOR.done,
      }))
    }
    if (selected.type === 'project') {
      return model.goals
        .filter(goal => goal.linkedProjectIds.includes(selected.id))
        .map(goal => ({ from: `goal:${goal.id}`, to: `project:${selected.id}`, color: STATUS_COLOR.done }))
    }
    if (selected.type === 'task') {
      const selfKey = `task:${selected.id}`
      return dependencyLinks
        .filter(link => link.from === selfKey || link.to === selfKey)
        .map(link => ({ from: link.from, to: link.to, color: STATUS_COLOR.failed }))
    }
    return []
  }, [selected, model, dependencyLinks])

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    const measure = () => {
      const base = content.getBoundingClientRect()
      setPaths(linePairs.flatMap(pair => {
        const fromEl = nodeEls.current.get(pair.from)
        const toEl = nodeEls.current.get(pair.to)
        if (!fromEl || !toEl) return []
        return [{ d: overlayPath(fromEl.getBoundingClientRect(), toEl.getBoundingClientRect(), base), color: pair.color }]
      }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [linePairs, expanded, model])

  const isProjectMuted = (projectId) => highlight && !highlight.projectIds.has(projectId)
  const isChipMuted = (key) => Boolean(highlight?.chipKeys) && !highlight.chipKeys.has(key)

  const toggleExpanded = (projectId) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const selectProject = (project) => {
    onSelect(project)
    setExpanded(prev => (prev.has(project.id) ? prev : new Set(prev).add(project.id)))
  }

  const renderCard = (project) => {
    const key = `project:${project.id}`
    const isOpen = expanded.has(project.id)
    const tasks = model.tasksByProject.get(project.id) || []
    const decisions = model.decisionsByProject.get(project.id) || []
    const pendingDecisions = decisions.filter(decision => decision.status === 'proposed').length
    const riskCount = project.failed + project.overdue
    const overflow = Math.max(0, tasks.length - TASK_CHIP_LIMIT)

    return (
      <div
        key={project.id}
        ref={registerNode(key)}
        className={cx(s.card, selectedNodeKey === key && s.active, isProjectMuted(project.id) && s.muted)}
        style={{ '--node-color': riskColor(project.risk) }}
      >
        <button
          type="button"
          className={s.cardHead}
          onClick={() => selectProject(project)}
          onDoubleClick={() => onOpen(project)}
          title={`${project.name} — ${t('structure.doubleClickOpen')}`}
        >
          <strong>{project.name}</strong>
          {project.isCustomType && project.typeLabel && (
            <b style={{
              fontSize: 9, fontWeight: 700, padding: '0 5px', borderRadius: 3, flexShrink: 0,
              textTransform: 'uppercase', letterSpacing: 0.4,
              color: project.typeColor || '#818cf8',
              background: `${project.typeColor || '#818cf8'}22`,
              border: `1px solid ${project.typeColor || '#818cf8'}44`,
            }}>
              {project.typeLabel}
            </b>
          )}
          {riskCount > 0 && <b className={s.riskBadge}><AlertTriangle size={10} /> {riskCount}</b>}
          {pendingDecisions > 0 && <b className={s.pendingBadge}><GitFork size={10} /> {pendingDecisions}</b>}
        </button>
        <span className={s.progress}><i style={{ width: `${project.progress}%` }} /></span>
        <em className={s.meta}>
          {project.doneTasks}/{project.totalTasks} {t('done')} · {project.progress}%
        </em>
        {(tasks.length > 0 || decisions.length > 0) && (
          <button
            type="button"
            className={s.chevron}
            aria-expanded={isOpen}
            aria-label={isOpen ? t('structure.collapse') : t('structure.expand')}
            onClick={() => toggleExpanded(project.id)}
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>{tasks.length}</span>
          </button>
        )}
        {isOpen && tasks.length > 0 && (
          <div className={s.chips} aria-label={t('structure.signalTasks')}>
            {tasks.slice(0, TASK_CHIP_LIMIT).map(task => {
              const taskKey = `task:${task.id}`
              return (
                <button
                  key={task.id}
                  type="button"
                  ref={registerNode(taskKey)}
                  className={cx(s.chip, selectedNodeKey === taskKey && s.active, isChipMuted(taskKey) && s.muted)}
                  style={{ '--chip-color': task.color }}
                  onClick={() => onSelect(task)}
                  onDoubleClick={() => onOpen(task)}
                  title={`${task.name} · ${task.status}`}
                >
                  {(task.risk === 'failed' || task.risk === 'overdue') && <AlertTriangle size={9} />}
                  <span>{task.name}</span>
                </button>
              )
            })}
            {overflow > 0 && (
              <button type="button" className={cx(s.chip, s.moreChip)} onClick={() => onOpen(project)}>
                {t('structure.moreTasks', { count: overflow })}
              </button>
            )}
          </div>
        )}
        {isOpen && decisions.length > 0 && (
          <div className={s.chips} aria-label={t('structure.decisionsLabel')}>
            {decisions.map(decision => {
              const decisionKey = `decision:${decision.id}`
              const pending = decision.status === 'proposed'
              return (
                <button
                  key={decision.id}
                  type="button"
                  className={cx(
                    s.chip,
                    s.decisionChip,
                    pending && s.pendingChip,
                    selectedNodeKey === decisionKey && s.active,
                    isChipMuted(decisionKey) && s.muted,
                  )}
                  onClick={() => onSelect(decision)}
                  onDoubleClick={() => onOpen(decision)}
                  title={`${decision.name} · ${decision.status}`}
                >
                  <GitFork size={9} />
                  <span>{decision.name}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const renderLane = ({ key, className, style, header, projects, emptyHint }) => (
    <section key={key} className={cx(s.territory, className)} style={style}>
      {header}
      <div className={s.cards}>
        {projects.map(renderCard)}
        {projects.length === 0 && emptyHint && <span className={s.laneEmpty}>{emptyHint}</span>}
      </div>
    </section>
  )

  const territoryMuted = (identity, projects) =>
    highlight &&
    !highlight.identityIds.has(identity.id) &&
    !projects.some(project => highlight.projectIds.has(project.id))

  return (
    <div
      className={s.wrap}
      onClick={(event) => {
        // Click/tap on the background (every interactive element here is a
        // button) clears the selection, matching the graph views.
        if (!event.target.closest('button, a, input')) onSelect(null)
      }}
    >
      <div ref={contentRef} className={s.content}>
        <svg className={s.overlay} aria-hidden="true">
          {paths.map((path, index) => (
            <path key={index} d={path.d} stroke={path.color} strokeWidth="1.4" strokeDasharray="4 4" fill="none" />
          ))}
        </svg>

        {model.goals.length > 0 && (
          <div className={s.goalRail} aria-label={t('structure.goals')}>
            <span className={s.railLabel}><Target size={11} /> {t('structure.goals')}</span>
            {model.goals.slice(0, GOAL_LIMIT).map(goal => {
              const key = `goal:${goal.id}`
              return (
                <button
                  key={goal.id}
                  type="button"
                  ref={registerNode(key)}
                  className={cx(
                    s.goal,
                    selectedNodeKey === key && s.active,
                    highlight && !highlight.goalIds.has(goal.id) && s.muted,
                  )}
                  onClick={() => onSelect(goal)}
                  onDoubleClick={() => onOpen(goal)}
                  title={`${goal.name} — ${t('structure.doubleClickOpen')}`}
                >
                  <strong>{goal.name}</strong>
                  <span className={s.goalBar}><i style={{ width: `${goal.progress || 0}%` }} /></span>
                  <em>{goal.progress || 0}%</em>
                </button>
              )
            })}
          </div>
        )}

        <div className={s.board}>
          {model.territories.map(({ identity, projects }) =>
            renderLane({
              key: identity.id,
              className: cx(territoryMuted(identity, projects) && s.muted),
              style: { '--terr-color': identity.color },
              projects,
              emptyHint: t('focus.empty'),
              header: (
                <button
                  type="button"
                  ref={registerNode(`identity:${identity.id}`)}
                  className={cx(s.terrHead, selectedNodeKey === `identity:${identity.id}` && s.active)}
                  onClick={() => onSelect(identity)}
                  onDoubleClick={() => onOpen(identity)}
                >
                  {identity.avatar ? <span className={s.avatar}>{identity.avatar}</span> : <UserRound size={13} />}
                  <strong>{identity.name}</strong>
                  <em>{projects.length} {t('structure.projects')}</em>
                </button>
              ),
            })
          )}

          {model.shared.length > 0 &&
            renderLane({
              key: 'shared',
              className: cx(s.sharedLane, highlight && !model.shared.some(p => highlight.projectIds.has(p.id)) && s.muted),
              projects: model.shared,
              header: (
                <div className={s.terrHead}>
                  <Users size={13} />
                  <strong>{t('structure.sharedLane')}</strong>
                  <em>{model.shared.length} {t('structure.projects')}</em>
                </div>
              ),
            })}

          {model.unowned.length > 0 &&
            renderLane({
              key: 'unowned',
              className: cx(s.unownedLane, highlight && !model.unowned.some(p => highlight.projectIds.has(p.id)) && s.muted),
              projects: model.unowned,
              header: (
                <div className={s.terrHead}>
                  <UserRound size={13} />
                  <strong>{t('structure.unowned')}</strong>
                  <em>{model.unowned.length} {t('structure.projects')}</em>
                </div>
              ),
            })}
        </div>

        {showEmpty && (
          <div className="kt-map-empty">
            <strong>{t('structure.noMatches')}</strong>
            <span>{t('structure.noMatchesHint')}</span>
            <button type="button" onClick={onClearFilters}>{t('structure.clearFilters')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
