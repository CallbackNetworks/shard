import { describe, it, expect } from 'vitest'
import { conditionPhrase, humanizeTerm, valueLabel } from '../ruleTerms'
import en from '../../i18n/en.json'

// A stand-in for i18next's t, reading the real catalogue: the point of these phrases is
// how they come out on the shipped page, and a stub that always returns the fallback would
// only pin the derived name.
const t = (key, opts) => en[key] ?? (opts && 'defaultValue' in opts ? opts.defaultValue : key)

describe('ruleTerms', () => {
  it('reads an engine identifier as words', () => {
    expect(humanizeTerm('changed_field')).toBe('Changed Field')
    expect(humanizeTerm('node.created')).toBe('Node Created')
  })

  it('re-spells only what the engine named', () => {
    // The served spec draws the line, so a slot added on the server needs no change here.
    expect(valueLabel('in_progress', { vocabulary: true })).toBe('In Progress')
    expect(valueLabel('needs_review', { vocabulary: false })).toBe('needs_review')
  })

  it('states what title_contains actually tests, not the op it was saved with', () => {
    // The engine reads that field's op as nothing but negation, so printing the stored op
    // beside it either stutters ("Title Contains contains") or claims a match it would
    // never make ("Title Contains is").
    expect(conditionPhrase({ field: 'title_contains', op: 'eq', value: 'security' }, t))
      .toBe('Title contains "security"')
    expect(conditionPhrase({ field: 'title_contains', op: 'contains', value: 'security' }, t))
      .toBe('Title contains "security"')
    expect(conditionPhrase({ field: 'title_contains', op: 'neq', value: 'security' }, t))
      .toBe('Title does not contain "security"')
  })

  it('reads an ordinary condition as field, op, value', () => {
    expect(conditionPhrase({ field: 'changed_field', op: 'eq', value: 'priority' }, t, {
      changed_field: { vocabulary: true },
    })).toBe('Changed Field is "Priority"')
  })

  it('never puts an underscore on screen for an engine-named condition', () => {
    const phrase = conditionPhrase({ field: 'has_role', op: 'eq', value: 'task' }, t, {
      has_role: { vocabulary: true },
    })
    expect(phrase).not.toMatch(/_/)
  })
})
