import { BRAND, DARK } from '../constants/theme'
import { actionPhrase } from './ruleTerms'

/**
 * Mirrors `rules_engine.OUTCOME_*` (ADR-0053).
 *
 * "It ran" and "it changed something" are two different facts, and a run that changed
 * nothing is the state ADR-0050/0052 left out: they made *failure* visible, so a rule
 * whose every action was a legitimate no-op still reads as a success. It gets its own
 * neutral colour rather than a warning — an idempotent rule is a correct rule, and
 * colouring it as a problem would train the user to ignore the colour.
 */
export const OUTCOME_COLORS = {
  applied: BRAND,
  no_op: DARK.textDim,
  skipped: DARK.warning,
  failed: DARK.danger,
}

export function outcomeColor(outcome) {
  return OUTCOME_COLORS[outcome] || DARK.textDim
}

/** `Set Priority "High"` — the action itself, without its outcome (ADR-0058). */
export function actionClause(record, t, specs) {
  return actionPhrase(record?.type, record?.value, t, specs)
}

/** Human-readable outcome, with the engine's reason when it has one. */
export function outcomeLabel(record, t) {
  const outcome = record?.outcome || 'no_op'
  const label = t(`rules.outcome.${outcome}`)
  const reason = record?.reason
  if (!reason) return label
  // Falls back to the raw snake_case reason: an untranslated reason the user can read
  // and search for beats no reason at all.
  const translated = t(`rules.reason.${reason}`, { defaultValue: reason })
  return `${label} — ${translated}`
}
