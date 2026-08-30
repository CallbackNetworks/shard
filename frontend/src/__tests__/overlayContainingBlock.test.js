import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * An entrance animation on a page-level wrapper must not survive itself.
 *
 * `routeReveal` ends on `transform: translateX(0)`, and a `both`/`forwards` fill
 * *keeps* that final frame — an identity transform, which is still a transform, so
 * the element becomes the containing block **and** a new stacking context for every
 * `position: fixed` descendant. `.kt-route-shell` had it, and the symptom was two
 * removes away from the cause: a modal backdrop (`fixed; inset: 0`) sized itself to
 * the route's whole scroll content instead of the viewport, which centred the panel
 * in the middle of the page, and its `z-index: 300` stopped meaning anything outside
 * the shell, so the rail and the tickers drew over it. The same keyframe list also
 * ends on `clip-path: inset(0 0 0 0)`, which crops descendants to that box.
 *
 * Nothing about the retained frame is visible on its own, and the animation looks
 * identical either way — which is why this is a test and not a comment. ADR-0129.
 *
 * Scope: the wrappers a dialog or popover can be opened *inside*. Card- and
 * tile-level entrances keep `both`; they hold no overlays, and `OverflowMenu` /
 * `FormModal` portal out of them precisely because that cannot be relied on.
 */

const CSS = readFileSync(resolve(__dirname, '../styles/global.css'), 'utf8')

const WRAPPERS = ['.kt-route-shell', '.kt-modal']

const ruleFor = (selector) => {
  const at = CSS.indexOf(`\n${selector} {`)
  expect(at, `${selector} rule not found in global.css`).toBeGreaterThan(-1)
  return CSS.slice(at, CSS.indexOf('}', at))
}

describe('an overlay wrapper does not keep a transform after its entrance', () => {
  it.each(WRAPPERS)('%s fills backwards, not forwards', (selector) => {
    const rule = ruleFor(selector)
    const animation = rule.match(/animation:\s*([^;]+);/)?.[1] ?? ''
    expect(animation, `${selector} has no animation shorthand`).not.toBe('')
    expect(animation).not.toMatch(/\b(both|forwards)\b/)
  })
})
