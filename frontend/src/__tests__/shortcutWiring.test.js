/**
 * Every shortcut the hook dispatches must actually be wired up by App.
 *
 * `useKeyboardShortcuts` declared `onCreateTask` (`c`) and `onCreateProject`
 * (`n`), the help modal advertised both, and `App.jsx` passed neither — so both
 * keys called `preventDefault()` and then did nothing. Nothing failed: an
 * optional callback that is never supplied is not an error, it is silence.
 *
 * This reads the two files as text rather than importing them, because the
 * defect is precisely that no runtime value connects the two: the hook is
 * happy with any subset of its config, so only the source can say whether the
 * caller actually supplied it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const read = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8')

/** Handler names the hook will call when its key is pressed. */
function handlersDispatchedByHook() {
  const src = read('hooks/useKeyboardShortcuts.js')
  const body = src.slice(src.indexOf('function handler'))
  return new Set([
    ...[...body.matchAll(/fire\((on[A-Za-z]+)\)/g)].map(m => m[1]),
    ...[...body.matchAll(/(on[A-Za-z]+)\?\.\(/g)].map(m => m[1]),
  ])
}

/** Keys of the object literal App passes to useKeyboardShortcuts(). */
function handlersSuppliedByApp() {
  const src = read('App.jsx')
  const start = src.indexOf('useKeyboardShortcuts({')
  expect(start).toBeGreaterThan(-1)
  const config = src.slice(start, src.indexOf('})', start))
  return new Set([...config.matchAll(/^\s*(on[A-Za-z]+):/gm)].map(m => m[1]))
}

describe('keyboard shortcut wiring', () => {
  it('supplies every handler the hook dispatches', () => {
    const dispatched = handlersDispatchedByHook()
    const supplied = handlersSuppliedByApp()

    expect(dispatched.size).toBeGreaterThan(0)
    const unwired = [...dispatched].filter(name => !supplied.has(name))
    expect(unwired).toEqual([])
  })

  // The other half of the same bug: an unwired key must fall through to the
  // browser rather than being swallowed by a preventDefault with no action.
  it('does not preventDefault for a shortcut nobody is listening to', () => {
    const src = read('hooks/useKeyboardShortcuts.js')
    const singleKeySection = src.slice(src.indexOf('Single-key shortcuts'))
    expect(singleKeySection).toMatch(/if \(!fn\) return\s*\n\s*e\.preventDefault\(\)/)
  })
})
