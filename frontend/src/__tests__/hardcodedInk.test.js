import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * A text colour written as `#fff` or `#000` is readable in one theme and not
 * the other, and nothing fails when it is wrong — the text is simply gone.
 *
 * There are two ways to land here. A filled button takes its ink from
 * `--kt-on-fill`, because every meaning colour is light in the dark theme and
 * dark in the light one: white on `--kt-info` is 2.2:1 in the dark theme, black
 * on it is 2.4:1 in the light one, so a fixed ink is wrong in exactly one of
 * them. Text on a *surface* takes `--kt-ink`, which is white in the dark theme
 * and near-black in the light one; `#fff` there was white-on-white.
 *
 * Scope: component sources and CSS modules, which are theme-agnostic. It does
 * not read `styles/global.css`, which declares both palettes — a literal inside
 * a `[data-theme="light"]` block is correct there, and telling the two apart
 * needs the selector, not the declaration.
 */

const SRC = resolve(__dirname, '..')

// `color:` / `color=` only — not `background-color`, `borderColor`, `accentColor`.
const INK = /(?<![A-Za-z-])color\s*[:=]\s*['"]?(#(?:fff|ffffff|000|000000)\b)/i

// Ink sitting on a colour the *user* picked — an identity's avatar, a project
// icon, an accent swatch. White is a fixed choice there because the fill is not
// ours to reason about; making it correct needs a luminance rule, not a token.
const ON_A_USER_COLOUR = new Set([
  'pages/Dashboard.module.css',        // .cardAvatar, .identityGroupAvatar
  'pages/ProjectDetail.module.css',    // .projectIcon
  'pages/Identities.jsx',              // identity avatar tile
  'pages/Settings.jsx',                // the tick on the chosen accent swatch
  'components/IdentityChartsView.jsx', // value drawn inside a coloured bar
  'components/GanttChart.jsx',         // task label inside its own bar
  'components/CommentsPanel.jsx',      // identity initial on its colour chip
])

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full)
    return /\.(jsx|module\.css)$/.test(name) ? [full] : []
  })
}

describe('no text colour is hardcoded to one theme', () => {
  const files = walk(SRC)
    .map(f => relative(SRC, f).replaceAll('\\', '/'))
    .filter(rel => !ON_A_USER_COLOUR.has(rel))

  it('finds the app source', () => {
    expect(files.length).toBeGreaterThan(80)
  })

  it.each(files)('%s', (rel) => {
    const offenders = readFileSync(join(SRC, rel), 'utf8')
      .split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => INK.test(line))
      .map(([n, line]) => `${rel}:${n}  ${line.trim()}`)

    expect(
      offenders,
      `use var(--kt-on-fill) for ink on a filled colour, var(--kt-ink) for ink on a surface`
    ).toEqual([])
  })

  it('still names every file it excuses', () => {
    // An excuse that stops being true is a gap wearing a reason: each allowlisted
    // file has to still contain the literal it was excused for.
    for (const rel of ON_A_USER_COLOUR) {
      const source = readFileSync(join(SRC, rel), 'utf8')
      expect(source.split('\n').some(line => INK.test(line)), `${rel} no longer needs its entry`).toBe(true)
    }
  })
})
