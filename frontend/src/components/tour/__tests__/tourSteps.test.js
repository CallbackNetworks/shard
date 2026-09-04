import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { TOUR_STEPS } from '../tourSteps'
import en from '../../../i18n/en.json'
import zh from '../../../i18n/zh-TW.json'

const SRC = resolve(__dirname, '../../..')

// `components/tour/` is excluded, and that exclusion is the whole test.
// `tourSteps.js` *contains* every selector it declares, so scanning it means the
// guard compares the declaration against itself: breaking an anchor anywhere in the
// app still passed, because the string was right there in the file being checked.
// A guard that reimplements the rule it is checking passes against the broken
// version too (ADR-0061) — negative-controlled by breaking a real anchor and
// watching this fail.
const SKIP = new Set(['node_modules', 'tour'])

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return SKIP.has(name) ? [] : walk(full)
    return /\.jsx?$/.test(full) ? [full] : []
  })
}

/**
 * A tour step points at something that exists (ADR-0148).
 *
 * A step is declared data naming a `data-tour` attribute somewhere in the app, and
 * the overlay skips a step whose anchor it cannot find — which is the right runtime
 * behaviour and a terrible failure signal, because a step deleted by an unrelated
 * refactor looks exactly like a step the user's own widget settings hid. So the
 * anchor must exist in the source, and that is checked here rather than discovered
 * by nobody.
 */
describe('the tour points at things that exist', () => {
  const source = walk(SRC).map(f => readFileSync(f, 'utf8')).join('\n')

  it.each(TOUR_STEPS)('$id has an anchor rendered somewhere', (step) => {
    const name = /\[data-tour="([^"]+)"\]/.exec(step.anchor)?.[1]
    expect(name, `${step.id}: anchor must be a [data-tour="..."] selector`).toBeTruthy()
    // Two forms, both narrow. The bare-name fallback this started with matched any
    // string literal anywhere in `src/`, so `search` passed on `t('search')` and the
    // guard would have reported a step whose anchor had been deleted as fine.
    // A rail row declares its anchor in `constants/nav.js` because it is rendered
    // from a map, so `tour: 'guide'` is the literal there.
    expect(
      source.includes(`data-tour="${name}"`) || source.includes(`tour: '${name}'`),
      `no element renders data-tour="${name}" — step '${step.id}' would silently skip itself`
    ).toBe(true)
  })

  it.each(TOUR_STEPS)('$id has copy in both languages', (step) => {
    for (const key of [step.titleKey, step.bodyKey]) {
      expect(en[key], `${key} missing from en.json`).toBeTruthy()
      expect(zh[key], `${key} missing from zh-TW.json`).toBeTruthy()
    }
  })

  it('has unique ids', () => {
    expect(new Set(TOUR_STEPS.map(s => s.id)).size).toBe(TOUR_STEPS.length)
  })
})
