import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * The corners are square.
 *
 * `global.css` has said so since the beginning — `border-radius: 0 !important` on every
 * form control and on any element carrying an inline radius — but that reset only
 * reaches what it names. A CSS module styling a `div`, a section or an `<a>` (which is
 * what a router `Link` renders) is outside it, and thirty-odd 4–8px radii had collected
 * there, plus three pills, none of them failing anything.
 *
 * So the rule is asserted where it can actually be checked: in the stylesheets. A circle
 * is not a rounded corner — `50%` is how the colour dots and avatars are drawn — and `0`
 * is the rule being stated rather than broken, so both are allowed and nothing else is.
 */

const SRC = resolve(__dirname, '..')
const DECL = /border-radius\s*:\s*([^;}]+)/g

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue
      walk(full, out)
    } else if (name.endsWith('.css')) {
      out.push(full)
    }
  }
  return out
}

// Comments are not declarations. This file's own prose explains the rule by
// quoting it, and so does global.css's type-scale note — a stylesheet that
// documents `border-radius: 0` was reported as breaking it. Newlines are kept
// so the reported line number still points at the real line.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g,
  (block) => block.replace(/[^\n]/g, ' '))

const allowed = (value) => {
  const v = value.replace('!important', '').trim().toLowerCase()
  return v === '0' || v === '0px' || v.includes('50%')
}

describe('no rounded corners', () => {
  it('every stylesheet declares square corners or a circle, nothing between', () => {
    const offenders = []
    for (const full of walk(SRC)) {
      const src = stripComments(readFileSync(full, 'utf8'))
      src.split('\n').forEach((line, i) => {
        // A selector matching elements that carry an inline radius is not a declaration.
        if (line.includes('[style*=')) return
        for (const m of line.matchAll(DECL)) {
          if (!allowed(m[1])) offenders.push(`${relative(SRC, full)}:${i + 1}  ${m[0].trim()}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
