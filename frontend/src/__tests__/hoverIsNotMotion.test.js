import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

/**
 * Two rules about how a card reacts to the pointer, both learned from the same bug.
 *
 * **1. An entrance animation's fill is not a place to keep state.** A card that
 * declares `opacity: 0` and relies on `animation: … forwards` to reveal itself is
 * visible only for as long as *that* animation is the one running. `.kt-card` used
 * to pick a hover reaction from `:nth-child(6n + N)`, and two of the six set
 * `animation:` — the shorthand replaced the entrance, its fill went with it, and the
 * card fell back to `opacity: 0`. Hovering an integration made it disappear. Reduced
 * motion is a second way to lose the same fill. `backwards` fills only *before* the
 * animation, so the settled state is the element's own style either way. This is the
 * card-level half of ADR-0129, which pinned the same mechanism for route wrappers.
 *
 * **2. Hover is a state change, not a stunt.** A card that translates or scales under
 * the pointer moves the thing being aimed at, and six different reactions keyed to a
 * card's position in its list reads as the page glitching rather than as feedback.
 * Colour carries hover now; motion is reserved for buttons and nav, which are aimed
 * at once and not read in a column of forty.
 */

const SRC = resolve(__dirname, '..')

const cssFiles = (dir) => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry)
  if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : cssFiles(path)
  return path.endsWith('.css') ? [path] : []
})

// A rule block plus the selector list immediately above it. Comments are stripped
// first, or a documented rule's selector comes back with the paragraph above it
// glued to the front.
const blocks = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(m => ({
  selector: m[1].trim().replace(/\s+/g, ' '),
  body: m[2],
}))

const isKeyframeStep = (selector) => /^(from|to|-?\d+%)/.test(selector) || selector === ''

describe('an entrance animation is not the only thing holding an element visible', () => {
  it.each(cssFiles(SRC).map(f => [f.slice(SRC.length + 1), f]))('%s', (_name, file) => {
    const offenders = blocks(readFileSync(file, 'utf8'))
      .filter(b => !isKeyframeStep(b.selector))
      .filter(b => /opacity:\s*0\s*;/.test(b.body) && /animation:[^;]*\b(forwards|both)\b/.test(b.body))
      .map(b => b.selector)
    expect(offenders, 'declare the entrance `backwards` and drop the `opacity: 0`').toEqual([])
  })
})

describe('a card does not move under the pointer', () => {
  // Surfaces that are read in a list and clicked where they sit. Buttons, nav rows and
  // page titles are deliberately excluded: they are aimed at, not scanned.
  const CARDS = ['.kt-card', '.card-hover', '.kt-map-node', '.kt-assistant-conversation', '.kt-assistant-bubble']

  const globalCss = readFileSync(resolve(SRC, 'styles/global.css'), 'utf8')
  const moduleCss = ['pages/Dashboard.module.css', 'pages/Integrations.module.css']
    .map(f => readFileSync(resolve(SRC, f), 'utf8')).join('\n')

  it.each(CARDS)('%s has no hover transform and no positional hover variants', (card) => {
    const hovered = blocks(globalCss).filter(b => b.selector.includes(`${card}:hover`))
    expect(hovered.length, `${card}:hover rule not found`).toBeGreaterThan(0)
    for (const b of hovered) {
      expect(b.body, `${b.selector} moves the card`).not.toMatch(/(^|[^-])transform:/)
      expect(b.selector, `${b.selector} keys hover off list position`).not.toMatch(/nth-child/)
    }
  })

  it('module-level cards answer hover with colour only', () => {
    const offenders = blocks(moduleCss)
      .filter(b => /\.(projectCard|card)\b[^,{]*:hover/.test(b.selector))
      .filter(b => /(^|[^-])transform:/.test(b.body))
      .map(b => b.selector)
    expect(offenders).toEqual([])
  })
})

describe('the loading words do not all draw at once', () => {
  /**
   * `.kt-loading` stacks three absolutely-positioned words in one spot and lets
   * `loadingWord` reveal one at a time. With the inherited `opacity: 1` that made the
   * settled state "all three on top of each other", which is what anyone with OS
   * reduced motion, `data-motion="reduced"`, or a first paint before `applyUiPrefs`
   * runs actually saw. Same rule as above, on the other side: the animation may not be
   * the only thing keeping the layout legible.
   */
  const globalCss = readFileSync(resolve(SRC, 'styles/global.css'), 'utf8')
  const rule = (selector) => blocks(globalCss).find(b => b.selector === selector)

  it('hides every word by default and stands one still', () => {
    expect(rule('.kt-loading span')?.body).toMatch(/opacity:\s*0\s*;/)
    expect(rule('.kt-loading span:first-child')?.body).toMatch(/opacity:\s*1\s*;/)
  })
})
