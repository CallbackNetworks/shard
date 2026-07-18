import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { getNodes, getNodeTypes } from '../../api/client'
import { DARK } from '../../constants/theme'

// Debounced-search node picker (ADR-0037). Backed by GET /nodes?query=&type=.
// `type` restricts server-side to one type key; `filter` refines client-side
// (e.g. role-based restriction via the node-types registry); `excludeIds`
// hides nodes such as the current one.
export default function NodeCombobox({ type = null, filter = null, excludeIds = [], placeholder, onSelect, autoFocus = false }) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef(null)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(text.trim()), 200)
    return () => clearTimeout(id)
  }, [text])

  const { data: nodeTypes = [] } = useQuery({ queryKey: ['node-types'], queryFn: getNodeTypes, staleTime: 300000 })
  const typeByKey = useMemo(() => new Map(nodeTypes.map(nt => [nt.key, nt])), [nodeTypes])

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ['node-search', type, debounced],
    queryFn: () => getNodes(type, debounced),
    enabled: open,
    staleTime: 30000,
  })

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds])
  const options = useMemo(() => {
    let list = hits.filter(n => !excluded.has(n.id))
    if (filter) list = list.filter(filter)
    return list.slice(0, 20)
  }, [hits, excluded, filter])

  useEffect(() => { setHighlight(0) }, [debounced, open])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const pick = (node) => {
    setOpen(false)
    setText('')
    onSelect(node)
  }

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, options.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (options[highlight]) pick(options[highlight]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', flex: 1, minWidth: 180 }}>
      <div style={{ position: 'relative' }}>
        <Search size={12} color={DARK.textDim} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          className="kt-input"
          style={{ width: '100%', paddingLeft: 26 }}
          role="combobox"
          aria-expanded={open}
          aria-label={placeholder || t('nodeCombobox.placeholder')}
          placeholder={placeholder || t('nodeCombobox.placeholder')}
          value={text}
          autoFocus={autoFocus}
          onFocus={() => setOpen(true)}
          onChange={e => { setText(e.target.value); setOpen(true) }}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40, marginTop: 4,
          background: DARK.elevated, border: `1px solid ${DARK.border}`, borderRadius: 4,
          maxHeight: 240, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {options.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: DARK.textDim }}>
              {isFetching ? t('loading') : t('nodeCombobox.noResults')}
            </div>
          ) : (
            options.map((n, i) => {
              const nt = typeByKey.get(n.type)
              const color = nt?.color || '#818cf8'
              return (
                <div
                  key={n.id}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={e => { e.preventDefault(); pick(n) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer',
                    background: i === highlight ? DARK.hover : 'transparent',
                  }}
                >
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                    textTransform: 'uppercase', letterSpacing: 0.4,
                    color, background: `${color}22`, border: `1px solid ${color}44`,
                  }}>
                    {nt?.label || n.type}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, color: DARK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.title || <em style={{ color: DARK.textDim }}>{t('nodeCombobox.untitled')}</em>}
                  </span>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
