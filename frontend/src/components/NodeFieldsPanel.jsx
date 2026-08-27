import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SlidersHorizontal, Check } from 'lucide-react'
import { updateNode, getManagedDataKeys } from '../api/client'
import { qk } from '../api/queryKeys'
import { DARK } from '../constants/theme'

// The one editor for a node's own fields (ADR-0074). It draws whatever the type
// declared — nothing here knows what an identity or a project is — so a user-defined
// type gets the same form the built-ins do, which no surface could offer while
// `data` was an undescribed bag.
//
// `data` holds three kinds of key and this panel treats each differently: declared
// fields get a widget; a feature's own keys (share token, callback token, sync
// bookkeeping) are hidden, because they are shown properly by the panels that own them;
// anything left is an ad-hoc key somebody or some agent wrote, listed read-only. Hiding
// that last group would leave a slice of the data visible only to API callers.
// The machinery list is fetched, never mirrored here (ADR-0056, ADR-0058).

const COLOR_CHOICES = [
  '#818cf8', '#f472b6', '#38bdf8', '#34d399', '#fbbf24',
  '#a78bfa', '#f97316', '#22c55e', '#e11d48', '#06b6d4',
]

function FieldInput({ spec, value, onChange }) {
  const common = { className: 'kt-input', style: { width: '100%' } }

  if (spec.kind === 'longtext') {
    return (
      <textarea {...common} rows={3} style={{ ...common.style, resize: 'vertical' }}
        value={value ?? ''} onChange={e => onChange(e.target.value)} aria-label={spec.label} />
    )
  }
  if (spec.kind === 'bool') {
    return (
      <input type="checkbox" checked={!!value} aria-label={spec.label}
        onChange={e => onChange(e.target.checked)} />
    )
  }
  if (spec.kind === 'number') {
    return (
      <input {...common} type="number" value={value ?? ''} aria-label={spec.label}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
    )
  }
  if (spec.kind === 'enum') {
    return (
      <select {...common} value={value ?? ''} aria-label={spec.label} onChange={e => onChange(e.target.value || null)}>
        <option value="">—</option>
        {(spec.options || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (spec.kind === 'color') {
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {COLOR_CHOICES.map(c => (
          <button key={c} type="button" aria-label={c} onClick={() => onChange(c)}
            style={{
              width: 22, height: 22, background: c, cursor: 'pointer',
              border: value === c ? '2px solid #fff' : '2px solid transparent',
            }} />
        ))}
        <input {...common} style={{ width: 90 }} value={value ?? ''} aria-label={spec.label}
          placeholder="#hex" onChange={e => onChange(e.target.value || null)} />
      </div>
    )
  }
  if (spec.kind === 'date') {
    // datetime-local wants "YYYY-MM-DDTHH:mm"; the API speaks ISO.
    const local = value ? new Date(value).toISOString().slice(0, 16) : ''
    return (
      <input {...common} type="datetime-local" value={local} aria-label={spec.label}
        style={{ ...common.style, width: 220, colorScheme: 'dark' }}
        onChange={e => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} />
    )
  }
  if (spec.kind === 'json') {
    return (
      <textarea {...common} rows={3} aria-label={spec.label}
        style={{ ...common.style, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
        value={typeof value === 'string' ? value : JSON.stringify(value ?? null)}
        onChange={e => onChange(e.target.value)} />
    )
  }
  // text, url, emoji
  return (
    <input {...common} value={value ?? ''} aria-label={spec.label}
      maxLength={spec.max_length || undefined}
      style={{ ...common.style, width: spec.kind === 'emoji' ? 60 : '100%', textAlign: spec.kind === 'emoji' ? 'center' : 'left' }}
      onChange={e => onChange(e.target.value || null)} />
  )
}

export default function NodeFieldsPanel({ node, typeMeta, invalidateKeys }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const specs = typeMeta?.fields || []
  const data = node?.data || {}
  const [draft, setDraft] = useState({})
  const [saved, setSaved] = useState(false)

  // A node loaded later, or switched to, must not keep the previous one's edits.
  useEffect(() => { setDraft({}); setSaved(false) }, [node?.id])

  const { data: managed } = useQuery({
    queryKey: qk.managedDataKeys(),
    queryFn: getManagedDataKeys,
    staleTime: 600000,
  })

  const declaredKeys = new Set(specs.filter(f => f.store !== 'column').map(f => f.key))
  const managedKeys = new Set(managed?.keys || [])
  const extras = Object.keys(data).filter(k => !declaredKeys.has(k) && !managedKeys.has(k)).sort()

  const stored = (key) => {
    const spec = specs.find(f => f.key === key)
    return spec?.store === 'column' ? node?.[key] : data[key]
  }
  const valueOf = (key) => (key in draft ? draft[key] : stored(key))
  const dirty = Object.keys(draft).some(k => draft[k] !== (stored(k) ?? null))

  const save = useMutation({
    mutationFn: () => {
      // `json` fields are edited as text; send the parsed value or fail loudly rather
      // than silently persisting a string where a dict is expected.
      // A field says where it lives (ADR-0074): a column goes at the top level, a
      // `data` key inside `data`. Sending a column key inside `data` would write a
      // same-named key into the bag and leave the column untouched.
      const body = {}
      const data = {}
      for (const [k, v] of Object.entries(draft)) {
        const spec = specs.find(f => f.key === k)
        const value = spec?.kind === 'json' && typeof v === 'string' ? JSON.parse(v || 'null') : v
        if (spec?.store === 'column') body[k] = value
        else data[k] = value
      }
      if (Object.keys(data).length) body.data = data
      return updateNode(node.id, body)
    },
    onSuccess: () => {
      for (const key of invalidateKeys || [['node', node.id]]) qc.invalidateQueries({ queryKey: key })
      setDraft({})
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    },
  })

  if (!specs.length && !extras.length) return null

  return (
    <div className="kt-card" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <SlidersHorizontal size={15} color="#818cf8" />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: DARK.text }}>{t('nodeFields.title')}</h3>
        {dirty && (
          <button className="kt-btn kt-btn-primary" style={{ marginLeft: 'auto' }}
            disabled={save.isPending} onClick={() => save.mutate()}>
            {t('save')}
          </button>
        )}
        {saved && !dirty && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: DARK.success, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Check size={12} /> {t('nodeFields.saved')}
          </span>
        )}
      </div>

      {specs.map(spec => (
        <div key={spec.key} style={{ marginTop: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: DARK.textMid, display: 'block', marginBottom: 4 }}>
            {spec.label}
          </label>
          <FieldInput spec={spec} value={valueOf(spec.key)}
            onChange={v => setDraft(d => ({ ...d, [spec.key]: v }))} />
        </div>
      ))}

      {extras.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${DARK.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: DARK.textMid }}>{t('nodeFields.undeclared')}</div>
          <div style={{ fontSize: 11, color: DARK.textDim, marginTop: 2, marginBottom: 6 }}>
            {t('nodeFields.undeclaredHint')}
          </div>
          {extras.map(k => (
            <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '3px 0' }}>
              <code style={{ color: DARK.textDim, flex: '0 0 40%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k}</code>
              <span style={{ color: DARK.textMid, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {typeof data[k] === 'object' ? JSON.stringify(data[k]) : String(data[k])}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
