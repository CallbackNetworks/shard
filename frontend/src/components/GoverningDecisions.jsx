import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Gavel, Plus, X } from 'lucide-react'
import { getDecisionsGoverning, linkDecisionToWork, unlinkDecisionFromWork } from '../api/client'
import { qk } from '../api/queryKeys'
import { useInvalidatingMutation } from '../hooks/useCrudMutations'
import { DECISION_STATUS_COLORS as STATUS_COLORS } from '../constants/theme'
import FormModal from './shared/FormModal'
import NodeCombobox from './shared/NodeCombobox'
import s from './GoverningDecisions.module.css'

/**
 * What decided this node (ADR-0118's `governs`, read from the work's side).
 *
 * The relation shipped with a read endpoint, a reverse read endpoint and two client
 * helpers, and not one caller: a decision could say what it governed and the governed
 * work could not say what decided it. That asymmetry is the whole point of the relation
 * — the person looking at a task is the one who does not know why it exists.
 *
 * ADR-0128 made it *writable* from here. `governs` had exactly one control in the whole
 * app, on the decision side, and production had one `governs` edge across 103 records:
 * the act is almost always noticed from the work ("why am I doing this?"), and that end
 * could only read. An edge nobody can create from the place they think of it is an edge
 * that does not get created.
 *
 * When it is not writable the strip still renders nothing on a node governed by nothing,
 * because then it is pure output and every node would carry an empty row. When it *is*
 * writable the empty state is the point — it is the only thing offering the link.
 */
export default function GoverningDecisions({ nodeId, className = '', editable = false }) {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  const { data: decisions = [] } = useQuery({
    queryKey: qk.governingDecisions(nodeId),
    queryFn: () => getDecisionsGoverning(nodeId),
    enabled: !!nodeId,
    staleTime: 30000,
  })

  // The edge is `decision -> work`, so the decision is the source however you reached it
  // (ADR-0078's declaration; picking the ends the other way round is a 400).
  const link = useInvalidatingMutation({
    mutationFn: ({ decisionId }) => linkDecisionToWork(decisionId, nodeId),
    invalidateKeys: [['governing-decisions'], ['decisions']],
    onSuccess: () => setPicking(false),
  })

  const unlink = useInvalidatingMutation({
    mutationFn: ({ decisionId }) => unlinkDecisionFromWork(decisionId, nodeId),
    invalidateKeys: [['governing-decisions'], ['decisions']],
  })

  if (decisions.length === 0 && !editable) return null

  const drop = (d) => {
    if (window.confirm(t('decisions.ungovernConfirm', { name: d.name }))) {
      unlink.mutate({ decisionId: d.id })
    }
  }

  return (
    <div className={`${s.root} ${className}`}>
      <div className={s.head}>
        <Gavel size={11} />
        {t('decisions.governedBy', { count: decisions.length })}
        {editable && (
          <button type="button" className={s.add} onClick={() => setPicking(true)}>
            <Plus size={10} /> {t('decisions.governedByAdd')}
          </button>
        )}
      </div>
      <div className={s.chips}>
        {decisions.map(d => {
          const style = STATUS_COLORS[d.decision_status || 'proposed'] || STATUS_COLORS.proposed
          return (
            <span key={d.id} className={s.chip} style={{ borderColor: style.color, color: style.color }}>
              <Link to={`/n/${d.id}`} className={s.chipName}>{d.name}</Link>
              <span className={s.chipStatus}>{t(`decisions.${d.decision_status || 'proposed'}`)}</span>
              {editable && (
                <button type="button" className={s.drop} onClick={() => drop(d)}
                  aria-label={t('decisions.ungovern', { name: d.name })}>
                  <X size={9} />
                </button>
              )}
            </span>
          )
        })}
        {decisions.length === 0 && <span className={s.none}>{t('decisions.governedByNone')}</span>}
      </div>

      {picking && (
        <FormModal
          title={t('decisions.governedByTitle')}
          onClose={() => setPicking(false)}
          onSubmit={() => setPicking(false)}
          submitLabel={t('close')}
        >
          <div className="kt-page-subtitle" style={{ marginBottom: 10 }}>{t('decisions.governedByHint')}</div>
          {/* Restricted to `decision` server-side rather than filtered here: the relation
              declares `decision` as its only legal source, so anything else in this list
              would be an option whose only feedback is a 400. */}
          <NodeCombobox
            autoFocus
            type="decision"
            placeholder={t('decisions.governedByPlaceholder')}
            excludeIds={[nodeId, ...decisions.map(d => d.id)]}
            onSelect={(node) => link.mutate({ decisionId: node.id })}
          />
        </FormModal>
      )}
    </div>
  )
}
