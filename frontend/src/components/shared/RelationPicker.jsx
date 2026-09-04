import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { attachNodeEdge, getRelationOptions } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { DARK } from '../../constants/theme'
import NodeCombobox from './NodeCombobox'

// The one control that creates an edge (ADR-0150). Three copies of this existed —
// `NodePage`, `NodeExplorer` and `MembershipPanel` — and each re-derived the rules
// from nothing, so all three got the same three things wrong:
//
//   1. Every relation was offered on every node. On a project, seven of the nine
//      could not succeed; the picker learned that only from the 400 afterwards.
//   2. The edge always pointed outward. So `owns` and `governs`, which have the
//      project at their *target* end, were unreachable from a project entirely,
//      and "this task belongs to that project" — the commonest act there is —
//      could only be expressed as `task contains project`, which `contains`
//      accepts, storing the containment backwards with no error at all.
//   3. Candidates were every node in the database, whatever the relation allowed.
//
// The fix is not a smarter client: it is asking. `GET /graph-types/edges/options/{type}`
// runs the same predicate `add_edge` enforces, once per direction, and resolves the far
// end to concrete type keys. Nothing here knows what a role is (ADR-0056: a vocabulary
// re-derived in the client is a vocabulary that drifts).
//
// Direction lives *inside* the option list rather than in a separate toggle, so one
// choice is one complete sentence. The two `optgroup` headings carry the direction
// because the wording cannot be conjugated per relation across languages — English has
// no generic passive for a user-supplied label the way Chinese has 被 — and a heading
// translates cleanly where "Contains by" does not.
export default function RelationPicker({
  nodeId,
  nodeType,
  excludeIds = [],
  onLinked,
  compact = false,
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [picked, setPicked] = useState('')

  const { data: options = [], isLoading } = useQuery({
    queryKey: qk.relationOptions(nodeType),
    queryFn: () => getRelationOptions(nodeType),
    enabled: !!nodeType,
    staleTime: 300000,
  })

  // `rel_type` alone is not a key: a directed relation appears twice.
  const idOf = (o) => `${o.rel_type}:${o.direction}`
  const current = useMemo(() => options.find(o => idOf(o) === picked) || null, [options, picked])
  const outgoing = options.filter(o => o.direction === 'outgoing')
  const incoming = options.filter(o => o.direction === 'incoming')

  const attachMut = useMutation({
    mutationFn: (node) => {
      // The whole reason direction is a first-class choice: which id is the source.
      const [sourceId, targetId] = current.direction === 'outgoing'
        ? [nodeId, node.id]
        : [node.id, nodeId]
      return attachNodeEdge(sourceId, { target_id: targetId, rel_type: current.rel_type })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.nodeEdges(nodeId) })
      onLinked?.()
    },
  })

  const allowed = useMemo(
    () => (current ? new Set(current.other_types) : null),
    [current],
  )

  if (isLoading) return <div style={{ fontSize: 12, color: DARK.textDim }}>{t('loading')}</div>
  if (options.length === 0) {
    return <div style={{ fontSize: 12, color: DARK.textDim }}>{t('relationPicker.noOptions')}</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          className="kt-input"
          style={{ width: 'auto', minWidth: 190 }}
          aria-label={t('relationPicker.relation')}
          value={picked}
          onChange={e => setPicked(e.target.value)}
        >
          <option value="">{t('relationPicker.choose')}</option>
          {outgoing.length > 0 && (
            <optgroup label={t('relationPicker.thisToOther')}>
              {outgoing.map(o => (
                <option key={idOf(o)} value={idOf(o)}>{`→ ${o.label}`}</option>
              ))}
            </optgroup>
          )}
          {incoming.length > 0 && (
            <optgroup label={t('relationPicker.otherToThis')}>
              {incoming.map(o => (
                <option key={idOf(o)} value={idOf(o)}>{`← ${o.label}`}</option>
              ))}
            </optgroup>
          )}
        </select>

        {current && (
          <NodeCombobox
            placeholder={t('relationPicker.findNode')}
            filter={n => allowed.has(n.type)}
            excludeIds={[nodeId, ...excludeIds]}
            onSelect={n => attachMut.mutate(n)}
          />
        )}
      </div>

      {/* The relation's own description, at the moment it is being chosen. It was
          served all along and drawn only on the type-registry page — the one screen
          where you can read the rule but not act on it. */}
      {current?.description && !compact && (
        <p style={{ margin: '6px 0 0', fontSize: 11, lineHeight: 1.5, color: DARK.textDim, maxWidth: 620 }}>
          {current.description}
        </p>
      )}

      {attachMut.isError && (
        <div style={{ fontSize: 12, color: DARK.danger, marginTop: 6 }}>
          {attachMut.error?.response?.data?.detail || t('nodePage.attachFailed')}
        </div>
      )}
    </div>
  )
}
