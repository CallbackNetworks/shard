import { useTranslation } from 'react-i18next'
import { actionClause, outcomeColor, outcomeLabel } from '../../utils/ruleOutcomes'

/**
 * One chip per rule action: what it was, and what it did — or would do.
 *
 * The same records describe a run that happened (`rule.executed`'s `meta.actions`), a
 * dry-run that predicts one, and the static warnings on a rule that has never fired.
 * They render identically on purpose: a prediction the user reads differently from an
 * execution is a prediction they cannot check (ADR-0053, ADR-0054).
 */
export default function RuleOutcomeChips({ records, className = '' }) {
  const { t } = useTranslation()
  if (!Array.isArray(records) || records.length === 0) return null
  return (
    <div className={`kt-rule-outcomes ${className}`.trim()}>
      {records.map((record, i) => {
        const color = outcomeColor(record.outcome)
        return (
          <span
            key={i}
            className="kt-chip"
            style={{ color, borderColor: `${color}55` }}
            title={outcomeLabel(record, t)}
          >
            {actionClause(record)} · {outcomeLabel(record, t)}
          </span>
        )
      })}
    </div>
  )
}
