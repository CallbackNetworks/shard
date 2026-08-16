import { useState } from 'react'
import { Bookmark, CheckSquare, Download, SlidersHorizontal, Upload } from 'lucide-react'
import { DARK } from '../../constants/theme'
import s from './TaskFiltersPanel.module.css'

/**
 * Issues-tab filter strip: status tabs, saved views, bulk/export/import
 * toggles, search box, and the advanced filter row. Dumb component — all
 * state and mutations stay in ProjectDetail.
 */
export default function TaskFiltersPanel({
  filters,          // { status, priority, label, assignee, due, agent }
  setFilters,       // (patch) => void
  searchQ,
  setSearchQ,
  showFilters,
  setShowFilters,
  activeFilterCount,
  topTasks,
  labels,
  assignees,
  agentNames,
  savedFilters,
  onApplySavedFilter,
  onSaveFilter,
  bulkMode,
  onToggleBulk,
  showBulk = true,
  onExport,
  showImport,
  onToggleImport,
}) {
  const { status, priority, label, assignee, due, agent } = filters
  const [naming, setNaming] = useState(false)
  const [viewName, setViewName] = useState('')

  const commitSavedView = () => {
    const name = viewName.trim()
    if (!name) return
    onSaveFilter(name)
    setViewName('')
    setNaming(false)
  }

  return (
    <>
      <div className={s.filterBar}>
        {!searchQ && ['all', 'todo', 'in_progress', 'done', 'failed'].map(f => (
          <button key={f} onClick={() => setFilters({ status: f })} className={`${s.filterBtn} ${status === f ? s.filterBtnActive : s.filterBtnInactive}`}>
            {f === 'all' ? 'All' : f === 'in_progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
            {' '}<span className={s.filterCount}>{f === 'all' ? topTasks.length : topTasks.filter(t => t.status === f).length}</span>
          </button>
        ))}
        <div className={s.filterRight}>
          {/* Saved filters dropdown */}
          {savedFilters.length > 0 && (
            <select
              onChange={e => onApplySavedFilter(e.target.value)}
              style={{ fontSize: 11, background: DARK.elevated, color: DARK.textMid, border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}
              value=""
            >
              <option value="">Saved views</option>
              {savedFilters.map(sf => (
                <option key={sf.id} value={sf.id}>{sf.name}</option>
              ))}
            </select>
          )}
          {/* Save current filter. Naming a view is a real form field, so it is
              one here rather than a native window.prompt: unthemed, unvalidated
              and hardcoded English regardless of locale. */}
          {activeFilterCount > 0 && (
            naming ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <input
                  value={viewName}
                  autoFocus
                  onChange={e => setViewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitSavedView()
                    if (e.key === 'Escape') { setNaming(false); setViewName('') }
                  }}
                  placeholder="View name…"
                  aria-label="View name"
                  className={s.searchInput}
                />
                <button
                  onClick={commitSavedView}
                  disabled={!viewName.trim()}
                  style={{ background: 'none', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', color: DARK.textMid, fontSize: 11, opacity: viewName.trim() ? 1 : 0.4 }}
                >
                  Save
                </button>
              </span>
            ) : (
              <button
                onClick={() => setNaming(true)}
                title="Save current filter"
                style={{ background: 'none', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', color: DARK.textMid, display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }}
              >
                <Bookmark size={11} /> Save
              </button>
            )
          )}
          {/* Bulk mode toggle */}
          {showBulk && (
            <button
              onClick={onToggleBulk}
              style={{
                background: bulkMode ? 'rgba(250,204,21,0.12)' : 'none',
                border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 4, padding: '3px 6px', cursor: 'pointer',
                color: bulkMode ? DARK.info : DARK.textMid, display: 'flex', alignItems: 'center', gap: 3, fontSize: 11,
              }}
            >
              <CheckSquare size={11} /> Bulk
            </button>
          )}
          {/* Export */}
          <button
            onClick={onExport}
            title="Export tasks"
            style={{ background: 'none', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', color: DARK.textMid, display: 'flex', alignItems: 'center' }}
          >
            <Download size={11} />
          </button>
          {/* Import */}
          <button
            onClick={onToggleImport}
            title="Import tasks"
            style={{ background: showImport ? 'rgba(250,204,21,0.12)' : 'none', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', color: showImport ? DARK.info : DARK.textMid, display: 'flex', alignItems: 'center' }}
          >
            <Upload size={11} />
          </button>
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`${s.advancedFilterBtn} ${activeFilterCount > 0 ? s.advancedFilterActive : s.advancedFilterInactive}`}
          >
            <SlidersHorizontal size={12} />
            Filter
            {activeFilterCount > 0 && (
              <span className={s.activeFilterBadge}>
                {activeFilterCount}
              </span>
            )}
          </button>
          <input
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="Search issues…"
            className={s.searchInput}
          />
          {searchQ && (
            <button onClick={() => setSearchQ('')} className={s.clearSearchBtn}>
              {'✕'}
            </button>
          )}
        </div>
      </div>

      {/* Advanced filter bar */}
      {showFilters && (
        <div className={s.advancedFilterBar}>
          <span className={s.advancedFilterLabel}>Filters:</span>
          <select value={priority} onChange={e => setFilters({ priority: e.target.value })}
            className={`${s.filterSelect} ${priority !== 'all' ? s.filterSelectActive : s.filterSelectDefault}`}>
            <option value="all">Priority: All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select value={label} onChange={e => setFilters({ label: e.target.value })}
            className={`${s.filterSelect} ${label !== 'all' ? s.filterSelectActive : s.filterSelectDefault}`}>
            <option value="all">Label: All</option>
            {labels.map(lb => <option key={lb.id} value={lb.id}>{lb.name}</option>)}
          </select>
          <select value={assignee} onChange={e => setFilters({ assignee: e.target.value })}
            className={`${s.filterSelect} ${assignee !== 'all' ? s.filterSelectActive : s.filterSelectDefault}`}>
            <option value="all">Assignee: All</option>
            {assignees.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={due} onChange={e => setFilters({ due: e.target.value })}
            className={`${s.filterSelect} ${due !== 'all' ? s.filterSelectActive : s.filterSelectDefault}`}>
            <option value="all">Due: All</option>
            <option value="overdue">Overdue</option>
            <option value="this_week">This week</option>
            <option value="no_date">No date</option>
          </select>
          {agentNames.length > 0 && (
            <select value={agent} onChange={e => setFilters({ agent: e.target.value })}
              className={`${s.filterSelect} ${agent !== 'all' ? s.filterSelectAgent : s.filterSelectAgentDefault}`}>
              <option value="all">Agent: All</option>
              {agentNames.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {activeFilterCount > 0 && (
            <button
              onClick={() => setFilters({ priority: 'all', label: 'all', assignee: 'all', due: 'all', agent: 'all' })}
              className={s.clearAllFiltersBtn}
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </>
  )
}
