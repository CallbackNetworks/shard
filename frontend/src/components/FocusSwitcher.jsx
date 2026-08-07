import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, Search, Users } from 'lucide-react'
import { useIdentityFocus } from '../context/IdentityFocusContext'
import s from './FocusSwitcher.module.css'

const PANEL_MAX_HEIGHT = 380

// Identity focus is one control with N mutually exclusive values, not N nav
// destinations — so it occupies one rail row whatever the identity count, and
// the values live in a searchable popover. Rendering it as a list per identity
// is what used to push the fixed nav below the fold (ADR-0066).
export default function FocusSwitcher({ open, onOpenChange }) {
  const { t } = useTranslation()
  const { identities, focusId, focusIdentity, setFocusId } = useIdentityFocus()
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [top, setTop] = useState(0)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return identities
    return identities.filter(identity => identity.name.toLowerCase().includes(q))
  }, [identities, query])

  // The "no focus" row is a value of the same control, so it joins the option
  // list and takes part in keyboard navigation.
  const options = useMemo(
    () => [{ id: null, name: t('focus.allIdentities') }, ...matches],
    [matches, t]
  )

  useEffect(() => { setHighlight(0) }, [query, open])
  useEffect(() => { if (!open) setQuery('') }, [open])

  // The trigger keeps its place when the rail widens, so its top is stable
  // even though the panel opens mid-transition.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setTop(Math.max(8, Math.min(rect.top, window.innerHeight - PANEL_MAX_HEIGHT - 8)))
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) onOpenChange(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') onOpenChange(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  if (identities.length === 0) return null

  const pick = (id) => {
    setFocusId(id)
    onOpenChange(false)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(h + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (options[highlight]) pick(options[highlight].id)
    }
  }

  const triggerLabel = focusIdentity
    ? t('focus.focusedOn', { name: focusIdentity.name })
    : t('focus.title')

  return (
    <div ref={rootRef} className={s.root}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        className={`kt-mini-nav-button ${s.trigger} ${focusIdentity ? s.isFocused : ''}`}
        style={focusIdentity ? { '--focus-color': focusIdentity.color } : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
      >
        <span className="kt-rail-ico">
          {focusIdentity ? (
            <span className="kt-focus-avatar">
              {focusIdentity.avatar || focusIdentity.name.charAt(0)}
            </span>
          ) : (
            <Users size={16} />
          )}
        </span>
        <span className={`kt-rail-label ${s.triggerLabel}`}>
          {focusIdentity ? focusIdentity.name : t('focus.title')}
        </span>
        <ChevronRight size={13} className={`kt-rail-kbd ${s.chevron}`} />
      </button>

      {open && (
        <div className={s.panel} style={{ top }} role="dialog" aria-label={t('focus.title')}>
          <div className={s.searchRow}>
            <Search size={13} className={s.searchIcon} />
            <input
              className={s.search}
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('focus.searchPlaceholder')}
              aria-label={t('focus.searchPlaceholder')}
            />
          </div>

          <div className={s.list} role="listbox" aria-label={t('focus.title')}>
            {options.map((option, i) => {
              const selected = focusId === option.id
              return (
                <button
                  key={option.id || 'all'}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(option.id)}
                  className={`${s.option} ${i === highlight ? s.isHighlighted : ''}`}
                  style={option.color ? { '--focus-color': option.color } : undefined}
                >
                  <span className={s.optionAvatar}>
                    {option.id ? (option.avatar || option.name.charAt(0)) : <Users size={13} />}
                  </span>
                  <span className={s.optionName}>{option.name}</span>
                  {option.id && option.project_count !== undefined && (
                    <span className={s.optionCount}>{option.project_count}</span>
                  )}
                  {selected && <Check size={13} className={s.optionCheck} />}
                </button>
              )
            })}
            {matches.length === 0 && (
              <div className={s.empty}>{t('focus.noMatches')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
