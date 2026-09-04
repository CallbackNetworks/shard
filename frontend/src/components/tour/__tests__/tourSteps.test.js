import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { TOURS, stepKeys, tourForPath, LINKABLE_TOURS } from '../tours'
import en from '../../../i18n/en.json'
import zh from '../../../i18n/zh-TW.json'

const SRC = resolve(__dirname, '../../..')

// `tours.js` is excluded, and that exclusion is the whole test. It *contains* every
// selector it declares, so scanning it means the guard compares the declaration
// against itself: breaking an anchor anywhere in the app still passed, because the
// string was right there in the file being checked. A guard that reimplements the
// rule it is checking passes against the broken version too (ADR-0061) —
// negative-controlled by breaking a real anchor and watching this fail.
//
// One file, not the whole `components/tour/` directory as this started out. The
// launcher lives in there and renders a real anchor of its own, so excluding the
// folder made the one step pointing at it permanently unverifiable — the guard would
// have reported a deleted launcher as fine.
const SKIP_DIRS = new Set(['node_modules'])
const SKIP_FILES = new Set(['tours.js'])

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return SKIP_DIRS.has(name) ? [] : walk(full)
    if (SKIP_FILES.has(name)) return []
    return /\.jsx?$/.test(full) ? [full] : []
  })
}

const ALL_STEPS = TOURS.flatMap(tour => tour.steps.map(step => ({
  name: `${tour.id}/${step.id}`, tour, step,
})))

/**
 * A tour step points at something that exists (ADR-0148, ADR-0152).
 *
 * A step is declared data naming a `data-tour` attribute somewhere in the app, and
 * the overlay skips a step whose anchor it cannot find — which is the right runtime
 * behaviour and a terrible failure signal, because a step deleted by an unrelated
 * refactor looks exactly like a step the user's own widget settings hid. So the
 * anchor must exist in the source, and that is checked here rather than discovered
 * by nobody. With eighteen tours instead of one, this is the only thing standing
 * between a page refactor and a tour that silently walks through empty air.
 */
describe('the tours point at things that exist', () => {
  const source = walk(SRC).map(f => readFileSync(f, 'utf8')).join('\n')

  it.each(ALL_STEPS)('$name has an anchor rendered somewhere', ({ step, name }) => {
    const anchor = /\[data-tour="([^"]+)"\]/.exec(step.anchor)?.[1]
    expect(anchor, `${name}: anchor must be a [data-tour="..."] selector`).toBeTruthy()
    // Two forms, both narrow. The bare-name fallback this started with matched any
    // string literal anywhere in `src/`, so `search` passed on `t('search')` and the
    // guard would have reported a step whose anchor had been deleted as fine.
    // A rail row declares its anchor in `constants/nav.js` because it is rendered
    // from a map, so `tour: 'guide'` is the literal there.
    expect(
      source.includes(`data-tour="${anchor}"`) || source.includes(`tour: '${anchor}'`),
      `no element renders data-tour="${anchor}" — step '${name}' would silently skip itself`
    ).toBe(true)
  })

  it.each(ALL_STEPS)('$name has copy in both languages', ({ tour, step, name }) => {
    const { titleKey, bodyKey } = stepKeys(tour, step)
    for (const key of [titleKey, bodyKey]) {
      expect(en[key], `${key} missing from en.json (step ${name})`).toBeTruthy()
      expect(zh[key], `${key} missing from zh-TW.json (step ${name})`).toBeTruthy()
    }
  })

  it.each(TOURS)('$id is named in both languages', (tour) => {
    expect(en[tour.nameKey], `${tour.nameKey} missing from en.json`).toBeTruthy()
    expect(zh[tour.nameKey], `${tour.nameKey} missing from zh-TW.json`).toBeTruthy()
  })

  it('has unique tour ids, and unique step ids within a tour', () => {
    expect(new Set(TOURS.map(tr => tr.id)).size).toBe(TOURS.length)
    for (const tour of TOURS) {
      expect(new Set(tour.steps.map(st => st.id)).size, `${tour.id} has duplicate step ids`)
        .toBe(tour.steps.length)
    }
  })

  /**
   * Every page in the rail can be toured.
   *
   * The defect this prevents is the one ADR-0152 exists to fix, arriving again from
   * the other direction: a module is added to the rail, nothing points at it, and
   * the missing tour has no symptom at all — the launcher simply does not appear on
   * that page and no test, screenshot or type error mentions it. The rail is the
   * product's own list of its screens, so it is the right thing to check against.
   */
  it('offers a tour for every destination in the rail', async () => {
    const { NAV_GROUPS } = await import('../../../constants/nav')
    const missing = NAV_GROUPS
      .flatMap(g => g.items.map(it => it.to))
      .filter(to => !tourForPath(to))
    expect(missing, `rail rows with no tour: ${missing.join(', ')}`).toEqual([])
  })

  it('only offers tours the guide can navigate to', () => {
    // `LINKABLE_TOURS` is what the guide's index renders, and it calls
    // `navigate(tour.route)` on every row. A route-less tour in that list is a
    // navigation to `undefined`.
    for (const tour of LINKABLE_TOURS) expect(typeof tour.route).toBe('string')
  })
})
