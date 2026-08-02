import { useTranslation } from 'react-i18next'
import { actionClause, outcomeColor, outcomeLabel } from '../../utils/ruleOutcomes'

/**
 * One chip per rule action: what it was, and what it did — or would do.
 *
 * The same records describe a run that happened (`rule.executed`'s `meta.actions`), a
 * dry-run that predicts one, and the static warnings on a rule that has never fired.
 * They render identically on purpose: a prediction the user reads differently from an
 * execution is a prediction they cannot check (ADR-0053, ADR-0054).
 *
 * `specs` is the served action-value vocabulary (ADR-0056), passed in rather than fetched
 * so this stays a presentational component. Without it the action's value is shown raw,
 * which is what it always was; with it, engine-coined values read as words (ADR-0058).
 */
export default function RuleOutcomeChips({ records, specs, className = '' }) {
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
            {actionClause(record, t, specs)} · {outcomeLabel(record, t)}
          </span>
        )
      })}
    </div>
  )
}
