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

const sourceFiles = (dir, ext) => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry)
  if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path, ext)
  return ext.some(e => path.endsWith(e)) ? [path] : []
})

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

describe('hover is answered with a transition, not an animation', () => {
  /**
   * The rule at the top of this file was written down and enforced on cards
   * only, so it went on being broken on the controls it explicitly exempted.
   * `.kt-btn:hover` ran `kineticSlidePunch`, whose first frame is
   * `translateX(-14px)`: every secondary button in the app jumped a quarter of
   * an inch left and slid back when the pointer arrived at it.
   *
   * An `animation` on `:hover` is the wrong tool three ways, and only the third
   * is cosmetic. (1) It plays once and holds its fill, so the settled hover
   * appearance is a keyframe rather than a declared state — and a second hover
   * replays the entrance rather than continuing from where the element is.
   * (2) Under reduced motion the duration collapses to 0.001ms, so the element
   * *teleports* to that fill frame: the accessibility setting does not remove
   * the effect, it removes the only part that made it legible. (3) A `both` or
   * `forwards` fill leaves a transform on the element, which makes it the
   * containing block for any `position: fixed` descendant — ADR-0129 and
   * ADR-0122 both chased that mechanism through popovers, and neither looked at
   * the buttons those popovers hang off.
   *
   * A pseudo-element is exempt: a sweep on `::after` carries no layout, holds
   * no transform for the real element, and cannot displace a fixed child.
   */
  it.each(cssFiles(SRC).map(f => [f.slice(SRC.length + 1), f]))('%s', (_name, file) => {
    const offenders = blocks(readFileSync(file, 'utf8'))
      .filter(b => /:hover(?![^,{]*::)/.test(b.selector))
      .filter(b => /(^|[^-])animation:/.test(b.body))
      .map(b => b.selector)
    expect(offenders, 'use a transition and declare the hovered state').toEqual([])
  })
})

describe('a declared motion is a motion something performs', () => {
  /**
   * `global.css` carried 39 keyframes and 16 of them had no consumer anywhere —
   * `letterPop`, `statPulse`, `toastImpact`, `pulseRing`, `slideMarquee` and
   * the rest. That is the failure this whole pass started from: the vocabulary
   * *read* kinetic while the app did not move, because the half with names like
   * motion was the half nothing referenced. A dead keyframe has no symptom, so
   * it is never removed and never noticed — it just makes the next reader
   * believe the surface is animated when it is inert.
   */
  const NAME = /@keyframes\s+([\w-]+)/g
  const files = sourceFiles(SRC, ['.css', '.jsx', '.js'])
  const corpus = files.map(f => readFileSync(f, 'utf8')).join('\n')
  const declared = [...readFileSync(resolve(SRC, 'styles/global.css'), 'utf8').matchAll(NAME)].map(m => m[1])

  it('declares no keyframe that nothing runs', () => {
    // Strip comments first: this file explains two keyframes it deleted by name,
    // and a mention in prose is not a consumer.
    const code = corpus.replace(/\/\*[\s\S]*?\*\//g, '')
    const orphans = declared.filter(name => {
      const used = new RegExp(`animation(-name)?\\s*:[^;}]*\\b${name}\\b`).test(code)
      return !used
    })
    expect(orphans, 'delete it, or give it a caller').toEqual([])
  })

  it('declares each keyframe once', () => {
    const dupes = declared.filter((n, i) => declared.indexOf(n) !== i)
    expect(dupes).toEqual([])
  })
})

describe('a control that answers the pointer also answers the press', () => {
  /**
   * The app had **one** `:active` rule in its entire stylesheet tree, and it set
   * `cursor: grabbing` on a drag handle. Roughly 130 `:hover` rules against one
   * press response is the measurable form of "the interface feels dead": every
   * control acknowledged being *approached* and none acknowledged being *used*,
   * which is the feedback a pointer user gets most often and the only one that
   * confirms the click landed at all.
   *
   * `button:active` reaches real <button>s only — the rail's rows are anchors
   * and the card surfaces are divs — so each family is named here. If a family
   * is dropped from the stylesheet this fails rather than quietly going silent
   * again.
   */
  const globalCss = readFileSync(resolve(SRC, 'styles/global.css'), 'utf8')
  const pressed = blocks(globalCss).filter(b => b.selector.includes(':active'))

  it.each(['button', '[role="button"]', '.kt-mini-nav-button', '.kt-card'])(
    '%s sinks when pressed', (family) => {
      const rule = pressed.find(b => b.selector.includes(family) && /transform:/.test(b.body))
      expect(rule, `nothing presses ${family}`).toBeTruthy()
      expect(rule.body, 'press with the shared --kt-press travel').toMatch(/var\(--kt-press\)/)
    })

  it('lands the press on the frame the pointer went down', () => {
    for (const b of pressed.filter(x => /transform:\s*translate/.test(x.body))) {
      expect(b.body, `${b.selector} eases into the press instead of landing on it`)
        .toMatch(/transition-duration:\s*0s/)
    }
  })
})
