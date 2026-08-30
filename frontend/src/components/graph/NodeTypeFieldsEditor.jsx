import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { DARK } from '../../constants/theme'

// Declaring a field was API-only until ADR-0132. `node_types.fields` is what the generic
// node editor draws (ADR-0074), it is writable through both doors, and this page — the one
// screen about the type registry — could edit key, label, colour and roles and not this.
// The consequence was not subtle: a custom type could never gain an editable field at all,
// so production's own `repository` layer carried eight real fields across nine nodes with
// zero declarations, every one of them read-only on the node page and settable only by
// somebody writing JSON at the API.
//
// Built-in declarations stay frozen (ADR-0121) and are drawn read-only instead: they are
// code, and an edit here would be reverted by the next resync revision.

// A field says where it lives. A `column` field must name a real writable column — named
// anything else it is written into `data` under the same name, which looks saved while the
// column never changes. So the key becomes a picker the moment the store is `column`,
// rather than a free box that can be wrong (ADR-0056's rule, one layer down).
function FieldKeyInput({ spec, columns, onChange }) {
  const { t } = useTranslation()
  if (spec.store === 'column') {
    return (
      <select
        className="kt-input" style={{ width: 120 }}
        aria-label={t('graphTypes.fieldKey')}
        value={spec.key}
        onChange={e => onChange({ ...spec, key: e.target.value })}
      >
        <option value="">{t('graphTypes.fieldPickColumn')}</option>
        {columns.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    )
  }
  return (
    <input
      className="kt-input" style={{ width: 120 }}
      aria-label={t('graphTypes.fieldKey')}
      placeholder={t('graphTypes.keyPlaceholder')}
      value={spec.key}
      onChange={e => onChange({ ...spec, key: e.target.value })}
    />
  )
}

function FieldRow({ spec, vocabulary, managedHit, onChange, onRemove }) {
  const { t } = useTranslation()
  return (
    // The controls wrap; the row's own delete button must not wrap with them, or it lands
    // on a line of its own under the *next* row's controls and reads as belonging to that
    // one. So the wrapping half is a box and the button sits outside it.
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      marginTop: 6, paddingTop: 6, borderTop: `1px solid ${DARK.border}`,
    }}>
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
      <FieldKeyInput spec={spec} columns={vocabulary.columns || []} onChange={onChange} />
      <input
        className="kt-input" style={{ width: 130 }}
        aria-label={t('graphTypes.fieldLabel')}
        placeholder={t('graphTypes.labelPlaceholder')}
        value={spec.label}
        onChange={e => onChange({ ...spec, label: e.target.value })}
      />
      <select
        className="kt-input" style={{ width: 100 }}
        aria-label={t('graphTypes.fieldKind')}
        value={spec.kind}
        onChange={e => onChange({
          ...spec,
          kind: e.target.value,
          options: e.target.value === 'enum' ? (spec.options || []) : undefined,
        })}
      >
        {(vocabulary.kinds || []).map(k => <option key={k} value={k}>{k}</option>)}
      </select>
      <select
        className="kt-input" style={{ width: 92 }}
        aria-label={t('graphTypes.fieldStore')}
        value={spec.store}
        onChange={e => onChange({ ...spec, store: e.target.value, key: e.target.value === 'column' ? '' : spec.key })}
      >
        {(vocabulary.stores || []).map(s => <option key={s} value={s}>{t(`graphTypes.store_${s}`)}</option>)}
      </select>
      {/* An enum with no values is refused by the server; asking for them here is the
          difference between a picker and a save that fails. */}
      {spec.kind === 'enum' && (
        <input
          className="kt-input" style={{ width: 160 }}
          aria-label={t('graphTypes.fieldOptions')}
          placeholder={t('graphTypes.fieldOptionsPlaceholder')}
          value={(spec.options || []).join(', ')}
          onChange={e => onChange({ ...spec, options: e.target.value.split(',').map(o => o.trim()).filter(Boolean) })}
        />
      )}
      {managedHit && (
        <span style={{ fontSize: 11, color: DARK.danger, flexBasis: '100%' }}>
          {t('graphTypes.fieldManaged', { key: spec.key })}
        </span>
      )}
    </div>
      <button
        onClick={onRemove} aria-label={`remove field ${spec.key || ''}`}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textMid, padding: 4 }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

export default function NodeTypeFieldsEditor({ fields, vocabulary, onChange }) {
  const { t } = useTranslation()
  const managed = new Set(vocabulary?.managed || [])
  const list = fields || []

  const replace = (i, spec) => onChange(list.map((f, n) => (n === i ? spec : f)))

  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${DARK.border}`, width: '100%' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: DARK.textMid, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {t('graphTypes.fields')}
      </div>
      <p style={{ margin: '4px 0 0', fontSize: 11, color: DARK.textDim }}>{t('graphTypes.fieldsHint')}</p>
      {list.map((spec, i) => (
        <FieldRow
          key={i}
          spec={spec}
          vocabulary={vocabulary || {}}
          managedHit={managed.has(spec.key)}
          onChange={s => replace(i, s)}
          onRemove={() => onChange(list.filter((_, n) => n !== i))}
        />
      ))}
      <button
        className="kt-btn" style={{ marginTop: 8 }}
        onClick={() => onChange([...list, { key: '', label: '', kind: 'text', store: 'data' }])}
      >
        <Plus size={12} /> {t('graphTypes.fieldAdd')}
      </button>
    </div>
  )
}

// The read-only rendering, for a built-in type and for the collapsed row of a custom one.
export function FieldSummary({ fields }) {
  const { t } = useTranslation()
  if (!fields?.length) return <span style={{ color: DARK.textDim }}>{t('graphTypes.fieldsNone')}</span>
  return (
    <span style={{ color: DARK.textDim }}>
      {t('graphTypes.fieldsCount', { n: fields.length })} · {fields.map(f => f.label).join(', ')}
    </span>
  )
}
