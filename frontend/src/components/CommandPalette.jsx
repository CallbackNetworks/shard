import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Search, ArrowRight, Hash, Boxes } from 'lucide-react'
import { getProjects, search, getNodes, getNodeTypes } from '../api/client'
import { NAV_GROUPS } from '../constants/nav'
import { BRAND, DARK } from '../constants/theme'
import { hasNodeRole } from '../constants/nodeRoles'
import { useIdentityFocus } from '../context/IdentityFocusContext'
import { orderByRecent, useRecentProjectIds } from '../utils/recentProjects'

const BACKDROP = 'rgba(0,0,0,0.8)'
const PANEL_BG = DARK.surface
const BORDER   = DARK.border
const ACCENT   = BRAND
const ITEM_HOVER = DARK.active

// Navigation commands are derived from the rail's own module list rather than
// re-typed here. A hand-written subset went stale the moment a page was added:
// goals, decisions, analytics, activity, settings and the whole Graph group
// existed in the rail and were unreachable from the palette.
const STATIC_COMMANDS = NAV_GROUPS.flatMap(group =>
  group.items.map(({ to, icon: Icon, labelKey }) => ({
    id: `nav-${to}`,
    labelKey,
    section: 'Navigation',
    icon: <Icon size={14} />,
    path: to,
  })),
)

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function SectionLabel({ label }) {
  return (
    <div style={{
      padding: '8px 14px 4px',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
      textTransform: 'uppercase', color: 'rgba(var(--kt-ink-rgb), 0.25)',
    }}>{label}</div>
  )
}

function CommandItem({ item, isActive, onSelect, onHover }) {
  const ref = useRef(null)
  useEffect(() => {
    if (isActive) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [isActive])

  // A real <button>: the palette is a keyboard-first surface, so its rows must
  // be reachable by Tab and activatable by Enter/Space without the arrow-key
  // loop being the only way in.
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={isActive}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: 'calc(100% - 12px)',
        padding: '8px 14px', cursor: 'pointer', borderRadius: 0, margin: '1px 6px',
        background: isActive ? ITEM_HOVER : 'transparent',
        border: 'none', borderLeft: isActive ? `3px solid ${ACCENT}` : '3px solid transparent',
        font: 'inherit', textAlign: 'left',
        transition: 'background 0.1s',
      }}
    >
      <span style={{ color: isActive ? ACCENT : 'rgba(var(--kt-ink-rgb), 0.35)', flexShrink: 0 }}>
        {item.icon}
      </span>
      <span style={{
        flex: 1, fontSize: 13, fontWeight: 500,
        color: isActive ? DARK.text : DARK.textMid,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {item.label}
      </span>
      {item.meta && (
        <span style={{ fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.2)', flexShrink: 0 }}>
          {item.meta}
        </span>
      )}
      {isActive && (
        <span style={{ color: 'rgba(var(--kt-ink-rgb), 0.2)', flexShrink: 0 }}>
          <ArrowRight size={12} />
        </span>
      )}
    </button>
  )
}

// `mode` picks what the palette is for: 'all' is the general command bar,
// 'projects' is the dedicated switcher (ADR-0067) — projects only, so the
// recency order is not diluted by nav commands, tasks and nodes.
export default function CommandPalette({ open, onClose, mode = 'all', intent = null }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [query, setQuery]     = useState('')
  const [activeIdx, setActive] = useState(0)
  const inputRef = useRef(null)
  const debouncedQ = useDebounce(query, 200)
  const projectsOnly = mode === 'projects'

  const { filterProjects } = useIdentityFocus()
  const recentIds = useRecentProjectIds()

  // Alt-tab semantics: the switcher never offers the project you are already
  // in, so Enter always lands somewhere new (ADR-0067).
  const { pathname } = useLocation()
  const currentProjectId = pathname.startsWith('/projects/') ? pathname.slice('/projects/'.length) : null

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
    staleTime: 30000,
    enabled: open,
  })

  // The palette offers the same projects the rest of the app is showing —
  // a focused identity narrows it here too.
  const projects = useMemo(() => filterProjects(allProjects), [filterProjects, allProjects])

  const { data: searchResults } = useQuery({
    queryKey: ['palette-search', debouncedQ],
    queryFn: () => search(debouncedQ),
    enabled: open && debouncedQ.trim().length >= 2,
    staleTime: 5000,
  })

  // Custom graph nodes (ADR-0037): searched via the generic /nodes API; builtin
  // entities are already covered by the search endpoint above.
  const { data: nodeTypes = [] } = useQuery({
    queryKey: ['node-types'], queryFn: getNodeTypes, staleTime: 300000, enabled: open,
  })
  const { data: nodeHits = [] } = useQuery({
    queryKey: ['palette-nodes', debouncedQ],
    queryFn: () => getNodes(null, debouncedQ),
    enabled: open && debouncedQ.trim().length >= 2,
    staleTime: 5000,
  })

  // Build command list. Memoized so its reference is stable across renders that
  // don't touch a source — otherwise the keyboard-nav effect below rebinds its
  // listener on every render.
  const items = useMemo(() => {
    const list = []
    const q = query.trim().toLowerCase()
    const resolvedStatic = STATIC_COMMANDS.map(c => ({ ...c, label: t(c.labelKey), section: t('palette.sectionNavigation') }))

    const projectItem = (p, section) => ({
      id: `proj-${p.id}`,
      label: p.name,
      section,
      icon: <FolderOpen size={14}/>,
      meta: p.status === 'archived'
        ? t('palette.archived')
        : (p.total_tasks > 0 ? t('palette.taskCount', { count: p.total_tasks }) : undefined),
      path: `/projects/${p.id}`,
    })

    // Projects you were just in come first, whatever their status — that is
    // what makes this a switcher rather than a directory. Everything behind
    // them stays limited to active projects, as before.
    const pushProjects = (limit) => {
      const named = q ? projects.filter(p => p.name.toLowerCase().includes(q)) : projects
      const matched = projectsOnly ? named.filter(p => p.id !== currentProjectId) : named
      const { recent, rest } = orderByRecent(matched, recentIds)
      recent.forEach(p => list.push(projectItem(p, t('palette.sectionRecent'))))
      rest
        .filter(p => p.status === 'active')
        .slice(0, Math.max(0, limit - recent.length))
        .forEach(p => list.push(projectItem(p, t('palette.sectionProjects'))))
    }

    if (projectsOnly) {
      pushProjects(20)
      return list
    }

    if (!q) {
      // No query: show static nav + recent and active projects
      resolvedStatic.forEach(c => list.push(c))
      pushProjects(8)
    } else {
      // With query: filter static commands
      const matchedStatic = resolvedStatic.filter(c =>
        c.label.toLowerCase().includes(q)
      )
      matchedStatic.forEach(c => list.push(c))

      pushProjects(6)

      // Search results (tasks)
      if (searchResults?.tasks?.length > 0) {
        searchResults.tasks.slice(0, 8).forEach(task => list.push({
          id: `task-${task.id}`,
          label: task.title,
          section: t('palette.sectionTasks'),
          icon: <Hash size={14}/>,
          meta: task.status,
          path: `/projects/${task.project_id}`,
        }))
      }

      // Search results (projects from search API): these match on more than the
      // name, but they bypass the identity filter, so only projects already
      // visible here may come through.
      if (searchResults?.projects?.length > 0) {
        const alreadyIds = new Set(list.filter(i => i.id.startsWith('proj-')).map(i => i.id.replace('proj-', '')))
        const visibleById = new Map(projects.map(p => [p.id, p]))
        searchResults.projects
          .filter(p => !alreadyIds.has(p.id) && visibleById.has(p.id))
          .slice(0, 4)
          .forEach(p => list.push(projectItem(visibleById.get(p.id), t('palette.sectionProjects'))))
      }

      // Custom graph nodes (ADR-0037): containers open their task view, the rest
      // land on the universal node page.
      const customTypeByKey = new Map(nodeTypes.filter(nt => !nt.is_builtin).map(nt => [nt.key, nt]))
      if (customTypeByKey.size > 0) {
        nodeHits.filter(n => customTypeByKey.has(n.type)).slice(0, 6).forEach(n => {
          const nt = customTypeByKey.get(n.type)
          list.push({
            id: `node-${n.id}`,
            label: n.title || n.id,
            section: t('palette.sectionNodes'),
            icon: <Boxes size={14}/>,
            meta: nt.label,
            path: hasNodeRole(nt, 'container') ? `/c/${n.id}` : `/n/${n.id}`,
          })
        })
      }
    }

    return list
  }, [query, t, projects, recentIds, projectsOnly, currentProjectId, searchResults, nodeTypes, nodeHits])

  // Group items by section for rendering
  const grouped = []
  let currentSection = null
  items.forEach((item, idx) => {
    if (item.section !== currentSection) {
      currentSection = item.section
      grouped.push({ type: 'section', label: item.section })
    }
    grouped.push({ type: 'item', item, idx })
  })

  const clampedActive = Math.min(activeIdx, items.length - 1)

  // `intent` lets a caller open the switcher to answer a question it already
  // has — `c` off a project page asks "in which project?" and wants the create
  // form open on arrival, not just the project page.
  const execute = useCallback((item) => {
    if (!item) return
    if (item.path) {
      const carries = intent === 'new-task' && item.path.startsWith('/projects/')
      navigate(carries ? `${item.path}?new=task` : item.path)
    }
    onClose()
  }, [navigate, onClose, intent])

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  // Clamp active index when items change
  useEffect(() => {
    setActive(idx => Math.max(0, Math.min(idx, items.length - 1)))
  }, [items.length])

  // Keyboard navigation
  useEffect(() => {
    if (!open) return
    const handleKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, items.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter')     { e.preventDefault(); execute(items[clampedActive]); return }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, items, clampedActive, execute, onClose])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: BACKDROP,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '15vh',
        animation: 'fadeIn 0.1s ease',
      }}
    >
      <div
        className="kt-command-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        onClick={e => e.stopPropagation()}
        style={{
          width: 560, maxWidth: '90vw',
          background: PANEL_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 0,
          boxShadow: '10px 10px 0 rgba(0,0,0,0.42)',
          overflow: 'hidden',
          animation: 'fadeUpIn 0.15s ease',
        }}
      >
        {/* Input */}
        <div className="kt-command-header" style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px',
          borderBottom: `1px solid ${BORDER}`,
        }}>
          <Search size={15} style={{ color: 'rgba(var(--kt-ink-rgb), 0.3)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0) }}
            placeholder={projectsOnly ? t('palette.switchProject') : t('palette.placeholder')}
            aria-label={projectsOnly ? t('palette.switchProject') : t('palette.placeholder')}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: DARK.text, fontSize: 15, fontWeight: 400,
              '::placeholder': { color: 'rgba(var(--kt-ink-rgb), 0.2)' },
            }}
          />
          <kbd style={{
            padding: '2px 6px', borderRadius: 0,
            background: 'rgba(var(--kt-ink-rgb), 0.05)', border: `1px solid ${BORDER}`,
            color: 'rgba(var(--kt-ink-rgb), 0.25)', fontSize: 11,
          }}>esc</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 400, overflowY: 'auto', padding: '6px 0' }}>
          {grouped.length === 0 && (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'rgba(var(--kt-ink-rgb), 0.2)', fontSize: 13 }}>
              {t('palette.noResults')}
            </div>
          )}
          {grouped.map((entry, i) =>
            entry.type === 'section'
              ? <SectionLabel key={`sec-${i}`} label={entry.label} />
              : <CommandItem
                  key={entry.item.id}
                  item={entry.item}
                  isActive={entry.idx === clampedActive}
                  onSelect={() => execute(entry.item)}
                  onHover={() => setActive(entry.idx)}
                />
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: `1px solid ${BORDER}`,
          padding: '8px 14px',
          display: 'flex', gap: 16,
          color: 'rgba(var(--kt-ink-rgb), 0.2)', fontSize: 11,
        }}>
          {[['↑↓', t('palette.navigate')], ['↵', t('palette.select')], ['esc', t('palette.close')]].map(([key, label]) => (
            <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <kbd style={{
                padding: '1px 5px', borderRadius: 0,
                background: 'rgba(var(--kt-ink-rgb), 0.06)', border: `1px solid ${BORDER}`,
                fontSize: 10,
              }}>{key}</kbd>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
