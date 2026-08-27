/**
 * Guard: a React Query cache key is spelled once, in the registry.
 *
 * A mistyped key is not an error. The query runs, fetches, and returns data — into a
 * cache entry nobody else shares or invalidates. The screen simply stops updating, and
 * the only symptom is a user saying "it didn't refresh". There were 289 inline literals
 * before `api/queryKeys.js`, `['projects']` alone across ten files.
 *
 * Two checks, because the registry only helps while it is the only spelling: no raw
 * literal anywhere in the app, and no dead entry in the registry itself.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'

import { qk } from '../api/queryKeys'

const SRC = resolve(__dirname, '..')
const REGISTRY = resolve(SRC, 'api/queryKeys.js')

function sourceFiles(dir = SRC) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.jsx?$/.test(entry) && full !== REGISTRY) {
      out.push(full)
    }
  }
  return out
}

describe('every cache key comes from the registry', () => {
  const files = sourceFiles()

  it('finds the app source', () => {
    // Anti-vacuity: a walk that returns nothing would make every check below pass.
    expect(files.length).toBeGreaterThan(100)
  })

  it.each(files.map((f) => [f.replace(`${SRC}/`, ''), f]))('%s uses qk, not a literal', (_rel, full) => {
    const source = readFileSync(full, 'utf8')
    const literals = [...source.matchAll(/queryKey:\s*\[\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1])
    expect(
      literals,
      `spell these through api/queryKeys instead — a mistyped literal silently creates a ` +
        `second cache entry rather than failing`,
    ).toEqual([])
  })
})

describe('the registry describes what the app actually uses', () => {
  const used = new Set()
  for (const full of sourceFiles()) {
    for (const m of readFileSync(full, 'utf8').matchAll(/\bqk\.([a-zA-Z]+)\s*\(/g)) {
      used.add(m[1])
    }
  }

  it('found call sites', () => {
    expect(used.size).toBeGreaterThan(40)
  })

  it('every key the app calls exists', () => {
    const missing = [...used].filter((name) => typeof qk[name] !== 'function')
    expect(missing, 'called but not defined in api/queryKeys').toEqual([])
  })

  it('every entry in the registry is called', () => {
    // A key nobody asks for is a name that will drift from whatever replaced it.
    const unused = Object.keys(qk).filter((name) => !used.has(name))
    expect(unused, 'defined in api/queryKeys but never called — delete it').toEqual([])
  })
})

describe('a key factory behaves the way invalidation needs', () => {
  it('drops trailing undefined so a bare call is a prefix', () => {
    expect(qk.goals()).toEqual(['goals'])
    expect(qk.goals(undefined)).toEqual(['goals'])
  })

  it('keeps the arguments it is given, in order', () => {
    expect(qk.comments('p1', 't2')).toEqual(['comments', 'p1', 't2'])
  })

  it('keeps null, which is a value a caller meant', () => {
    // `workflowRuleVocabulary(projectId || null)` distinguishes "global" from "unset".
    expect(qk.workflowRuleVocabulary(null)).toEqual(['workflow-rule-vocabulary', null])
  })

  it('returns a fresh array each call', () => {
    // A shared array would let one consumer mutate another's key.
    expect(qk.projects()).not.toBe(qk.projects())
    expect(qk.projects()).toEqual(qk.projects())
  })
})
