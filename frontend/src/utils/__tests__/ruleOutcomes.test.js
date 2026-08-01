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
    expect(actionClause({ type: 'set_priority', value: 'high' })).toBe('set_priority "high"')
    expect(actionClause({ type: 'add_comment', value: '' })).toBe('add_comment')
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
