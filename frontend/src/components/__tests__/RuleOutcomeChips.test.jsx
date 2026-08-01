import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import RuleOutcomeChips from '../shared/RuleOutcomeChips'
import { BRAND, DARK } from '../../constants/theme'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => (options && 'defaultValue' in options ? options.defaultValue : key),
  }),
}))

describe('RuleOutcomeChips', () => {
  it('renders one chip per action', () => {
    const { container } = render(<RuleOutcomeChips records={[
      { type: 'set_priority', value: 'high', outcome: 'applied' },
      { type: 'add_label', value: 'security', outcome: 'skipped', reason: 'label_not_found' },
    ]} />)
    expect(container.querySelectorAll('.kt-chip')).toHaveLength(2)
  })

  it('shows a predicted skip as a skip, not as something that would fire', () => {
    // The bug ADR-0054 closes: the dry-run said "would fire: add_label security" for a
    // rule that skipped every single time, because it echoed the rule's own config back.
    render(<RuleOutcomeChips records={[
      { type: 'add_label', value: 'security', outcome: 'skipped', reason: 'label_not_found' },
    ]} />)
    const chip = screen.getByTitle(/rules\.outcome\.skipped/)
    expect(chip.textContent).toContain('add_label "security"')
    expect(chip).toHaveStyle({ color: DARK.warning })
  })

  it('gives a prediction and an execution the same appearance', () => {
    // A predicted record and a recorded one have the same shape, so they must render the
    // same: a prediction the user reads differently from an execution cannot be checked.
    const record = { type: 'set_priority', value: 'high', outcome: 'applied' }
    const predicted = render(<RuleOutcomeChips records={[record]} />).container.innerHTML
    const executed = render(<RuleOutcomeChips records={[{ ...record, from: 'low' }]} />).container.innerHTML
    expect(predicted).toBe(executed)
  })

  it('colours an action that would change something with the brand colour', () => {
    render(<RuleOutcomeChips records={[{ type: 'set_status', value: 'done', outcome: 'applied' }]} />)
    expect(screen.getByTitle('rules.outcome.applied')).toHaveStyle({ color: BRAND })
  })

  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<RuleOutcomeChips records={[]} />)
    expect(container.innerHTML).toBe('')
    expect(render(<RuleOutcomeChips records={undefined} />).container.innerHTML).toBe('')
  })
})
