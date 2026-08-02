import { describe, it, expect } from 'vitest'
import { BRAND, DARK } from '../../constants/theme'
import { actionClause, outcomeColor, outcomeLabel, OUTCOME_COLORS } from '../ruleOutcomes'

// A stand-in for i18next's t: returns the key, or the defaultValue when one is given.
const t = (key, opts) => (opts && 'defaultValue' in opts ? opts.defaultValue : key)

describe('ruleOutcomes', () => {
  it('gives "applied" and "no effect" different colours', () => {
    // The whole point (ADR-0053): a run that changed nothing must not look like one that did.
    expect(outcomeColor('applied')).toBe(BRAND)
    expect(outcomeColor('no_op')).not.toBe(outcomeColor('applied'))
  })

  it('does not colour a no-op as a problem', () => {
    // An idempotent rule is a correct rule; warning-colouring it trains the user to ignore warnings.
    expect(outcomeColor('no_op')).not.toBe(DARK.warning)
    expect(outcomeColor('no_op')).not.toBe(DARK.danger)
    expect(outcomeColor('skipped')).toBe(DARK.warning)
    expect(outcomeColor('failed')).toBe(DARK.danger)
  })

  it('covers exactly the engine outcome vocabulary', () => {
    expect(Object.keys(OUTCOME_COLORS).sort()).toEqual(['applied', 'failed', 'no_op', 'skipped'])
  })

  it('falls back to a neutral colour for an outcome it has never seen', () => {
    expect(outcomeColor('something_new')).toBe(DARK.textDim)
  })

  it('renders the action with its value', () => {
    // The engine's name read as words; the raw key is what gets saved, not what gets
    // shown (ADR-0058). With no catalogue entry the derived name is the answer.
    expect(actionClause({ type: 'set_priority', value: 'high' }, t)).toBe('Set Priority "high"')
    expect(actionClause({ type: 'add_comment', value: '' }, t)).toBe('Add Comment')
  })

  it('shows an engine value as words and the user\'s own value verbatim', () => {
    // `in_progress` is a word the product coined, so it may be re-spelled for reading.
    expect(actionClause({ type: 'set_status', value: 'in_progress' }, t, {
      set_status: { kind: 'enum', options: [], vocabulary: true },
    })).toBe('Set Status "In Progress"')
    // A label name is the user's own string: shown back in other words it is a string
    // they can no longer search for.
    expect(actionClause({ type: 'add_label', value: 'needs_review' }, t, {
      add_label: { kind: 'suggest', options: [], vocabulary: false },
    })).toBe('Add Label "needs_review"')
  })

  it('appends the reason when the engine gave one', () => {
    expect(outcomeLabel({ outcome: 'applied' }, t)).toBe('rules.outcome.applied')
    expect(outcomeLabel({ outcome: 'no_op', reason: 'no_subscribers' }, t))
      .toBe('rules.outcome.no_op — no_subscribers')
  })

  it('shows an untranslated reason rather than dropping it', () => {
    expect(outcomeLabel({ outcome: 'skipped', reason: 'brand_new_reason' }, t))
      .toContain('brand_new_reason')
  })
})
