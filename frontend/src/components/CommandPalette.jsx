import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LayoutGrid, Zap, Key, Users, FolderOpen, Search, ArrowRight, Hash, Boxes } from 'lucide-react'
import { getProjects, search, getNodes, getNodeTypes } from '../api/client'
import { BRAND, DARK } from '../constants/theme'

const BACKDROP = 'rgba(0,0,0,0.8)'
const PANEL_BG = DARK.surface
const BORDER   = DARK.border
const ACCENT   = BRAND
const ITEM_HOVER = DARK.active

const STATIC_COMMANDS = [
  { id: 'nav-dashboard',    labelKey: 'nav.myIssues',      section: 'Navigation', icon: <LayoutGrid size={14}/>, path: '/' },
  { id: 'nav-identities',  labelKey: 'nav.identities',    section: 'Navigation', icon: <Users size={14}/>,      path: '/identities' },
  { id: 'nav-integrations',labelKey: 'nav.integrations',  section: 'Navigation', icon: <Zap size={14}/>,        path: '/integrations' },
  { id: 'nav-apikeys',     labelKey: 'nav.apiKeys',       section: 'Navigation', icon: <Key size={14}/>,        path: '/api-keys' },
]

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

  return (
    <div
      ref={ref}
      onMouseEnter={onHover}
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px', cursor: 'pointer', borderRadius: 0, margin: '1px 6px',
        background: isActive ? ITEM_HOVER : 'transparent',
        borderLeft: isActive ? `3px solid ${ACCENT}` : '3px solid transparent',
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
    </div>
  )
}

export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [query, setQuery]     = useState('')
  const [activeIdx, setActive] = useState(0)
  const inputRef = useRef(null)
  const debouncedQ = useDebounce(query, 200)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
    staleTime: 30000,
    enabled: open,
  })

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
    const resolvedStatic = STATIC_COMMANDS.map(c => ({ ...c, label: t(c.labelKey) }))

    if (!q) {
      // No query: show static nav + all projects
      resolvedStatic.forEach(c => list.push(c))

      if (projects.length > 0) {
        const activeProjects = projects.filter(p => p.status === 'active').slice(0, 8)
        activeProjects.forEach(p => list.push({
          id: `proj-${p.id}`,
          label: p.name,
          section: 'Projects',
          icon: <FolderOpen size={14}/>,
          meta: p.total_tasks > 0 ? `${p.total_tasks} tasks` : undefined,
          path: `/projects/${p.id}`,
        }))
      }
    } else {
      // With query: filter static commands
      const matchedStatic = resolvedStatic.filter(c =>
        c.label.toLowerCase().includes(q)
      )
      matchedStatic.forEach(c => list.push(c))

      // Filter projects by name
      const matchedProjects = projects.filter(p =>
        p.name.toLowerCase().includes(q)
      ).slice(0, 6)
      matchedProjects.forEach(p => list.push({
        id: `proj-${p.id}`,
        label: p.name,
        section: 'Projects',
        icon: <FolderOpen size={14}/>,
        meta: p.status === 'archived' ? 'archived' : (p.total_tasks > 0 ? `${p.total_tasks} tasks` : undefined),
        path: `/projects/${p.id}`,
      }))

      // Search results (tasks)
      if (searchResults?.tasks?.length > 0) {
        searchResults.tasks.slice(0, 8).forEach(task => list.push({
          id: `task-${task.id}`,
          label: task.title,
          section: 'Tasks',
          icon: <Hash size={14}/>,
          meta: task.status,
          path: `/projects/${task.project_id}`,
        }))
      }

      // Search results (projects from search API)
      if (searchResults?.projects?.length > 0) {
        const alreadyIds = new Set(list.filter(i => i.id.startsWith('proj-')).map(i => i.id.replace('proj-', '')))
        searchResults.projects.filter(p => !alreadyIds.has(p.id)).slice(0, 4).forEach(p => list.push({
          id: `proj-${p.id}`,
          label: p.name,
          section: 'Projects',
          icon: <FolderOpen size={14}/>,
          path: `/projects/${p.id}`,
        }))
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
            section: 'Nodes',
            icon: <Boxes size={14}/>,
            meta: nt.label,
            path: nt.is_container ? `/c/${n.id}` : `/n/${n.id}`,
          })
        })
      }
    }

    return list
  }, [query, t, projects, searchResults, nodeTypes, nodeHits])

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

  const execute = useCallback((item) => {
    if (!item) return
    if (item.path) navigate(item.path)
    onClose()
  }, [navigate, onClose])

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
            placeholder={t('palette.placeholder')}
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
