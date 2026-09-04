import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, X } from 'lucide-react'
import { DARK } from '../../constants/theme'
import { NODE_ROLE_DEFS } from '../../constants/nodeRoles'

// Declaring what may sit at each end of a *custom* relation (ADR-0150).
//
// `allowed_source`/`allowed_target` have been enforced on every write since ADR-0078
// and served on both API doors, and the create form here could set exactly three
// things: key, label, containment. So a relation made from the UI arrived with both
// rules NULL — permanently unconstrained, permanently undeclarable — which is the same
// shape ADR-0132 closed for node-type `fields`: a column the engine reads, writable by
// the API and by nothing a person can click.
//
// It matters more now than it did: the relation picker is built *from* these rules
// (ADR-0150), so an undeclared relation is one the picker must offer everywhere,
// against every node in the database. Declaring it is what makes it usable.
//
// Built-in relations are not editable here. Their declarations are frozen at both doors
// (ADR-0121) because the engine reads them: an API edit changed behaviour and was then
// silently reverted weeks later by an unrelated deploy.
function EndpointFields({ legend, spec, nodeTypes, onChange }) {
  const { t } = useTranslation()
  const types = spec?.types || []
  const roles = spec?.roles || []

  const emit = (next) => {
    // An empty declaration is `null`, not `{types: [], roles: []}` — the latter reads as
    // "nothing qualifies" and would refuse every edge, where the column's own meaning
    // for absent is "unconstrained".
    const clean = {}
    if (next.types.length) clean.types = next.types
    if (next.roles.length) clean.roles = next.roles
    onChange(Object.keys(clean).length ? clean : null)
  }
  const toggle = (list, value) =>
    list.includes(value) ? list.filter(x => x !== value) : [...list, value]

  return (
    <fieldset style={{ border: `1px solid ${DARK.border}`, borderRadius: 4, padding: '8px 10px', margin: 0, minWidth: 0 }}>
      <legend style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: DARK.textDim, padding: '0 4px' }}>
        {legend}
      </legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {nodeTypes.map(nt => (
          <button
            key={nt.key}
            type="button"
            aria-pressed={types.includes(nt.key)}
            onClick={() => emit({ types: toggle(types, nt.key), roles })}
            style={{
              fontSize: 11, padding: '2px 7px', borderRadius: 3, cursor: 'pointer',
              border: `1px solid ${types.includes(nt.key) ? (nt.color || '#818cf8') : DARK.border}`,
              background: types.includes(nt.key) ? `${nt.color || '#818cf8'}22` : 'transparent',
              color: types.includes(nt.key) ? (nt.color || '#818cf8') : DARK.textMid,
            }}
          >
            {nt.label}
          </button>
        ))}
        {/* Roles, next to types, because either key matching is enough — a role rule is
            what lets a custom task-like type qualify without being named (ADR-0090). */}
        {NODE_ROLE_DEFS.map(({ role, labelKey }) => (
          <button
            key={role}
            type="button"
            aria-pressed={roles.includes(role)}
            onClick={() => emit({ types, roles: toggle(roles, role) })}
            style={{
              fontSize: 11, padding: '2px 7px', borderRadius: 3, cursor: 'pointer',
              border: `1px dashed ${roles.includes(role) ? '#818cf8' : DARK.border}`,
              background: roles.includes(role) ? 'rgba(129,140,248,0.13)' : 'transparent',
              color: roles.includes(role) ? '#818cf8' : DARK.textMid,
            }}
          >
            {t('graphTypes.anyWithRole', { role: t(labelKey) })}
          </button>
        ))}
      </div>
      {types.length === 0 && roles.length === 0 && (
        <p style={{ margin: '6px 0 0', fontSize: 11, color: DARK.textDim }}>{t('graphTypes.anyNode')}</p>
      )}
    </fieldset>
  )
}

export default function EdgeEndpointsEditor({ item, nodeTypes, onSave, onCancel, saving }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState({
    description: item.description || '',
    is_symmetric: !!item.is_symmetric,
    allowed_source: item.allowed_source || null,
    allowed_target: item.allowed_target || null,
  })

  return (
    <div style={{ padding: '10px 0 4px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* The description is not decoration: it is what the relation picker shows at the
          moment somebody chooses this relation, and what an agent reads from
          `/api/v1/edge-types`. */}
      <textarea
        className="kt-input"
        rows={2}
        placeholder={t('graphTypes.descriptionPlaceholder')}
        aria-label={t('graphTypes.descriptionPlaceholder')}
        value={draft.description}
        onChange={e => setDraft({ ...draft, description: e.target.value })}
      />

      {item.is_containment ? (
        <p style={{ margin: 0, fontSize: 11, color: DARK.textDim }}>{t('graphTypes.containmentRule')}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
          <EndpointFields
            legend={t('graphTypes.allowedSource')}
            spec={draft.allowed_source}
            nodeTypes={nodeTypes}
            onChange={v => setDraft({ ...draft, allowed_source: v })}
          />
          <EndpointFields
            legend={t('graphTypes.allowedTarget')}
            spec={draft.allowed_target}
            nodeTypes={nodeTypes}
            onChange={v => setDraft({ ...draft, allowed_target: v })}
          />
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: DARK.textMid, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={draft.is_symmetric}
          onChange={e => setDraft({ ...draft, is_symmetric: e.target.checked })}
        />
        {t('graphTypes.symmetricHint')}
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="kt-btn kt-btn-primary" disabled={saving} onClick={() => onSave(draft)}>
          <Check size={12} /> {t('save')}
        </button>
        <button className="kt-btn" onClick={onCancel}>
          <X size={12} /> {t('cancel')}
        </button>
      </div>
    </div>
  )
}
