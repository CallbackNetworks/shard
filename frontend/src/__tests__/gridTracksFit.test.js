import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

/**
 * An explicit grid's floors have to fit somewhere real.
 *
 * `repeat(auto-fill, minmax(260px, 1fr))` carries its own escape hatch: when the
 * container is too narrow the browser satisfies the minimum by drawing *fewer* columns.
 * An explicit track list has none — a px floor is a floor, and a grid whose floors
 * exceed its container just grows past it.
 *
 * `.kt-decision-room` was `230px minmax(320px, 0.9fr) minmax(360px, 1.1fr)` plus two
 * 14px gaps: 938px of content box before it would honour its own declaration. The page
 * only has that above a ~1180px viewport, and its columns are `overflow: hidden`, so
 * below it the third column did not wrap, did not scroll and did not shrink — it was
 * cut off, and the middle column's cards were sliced down their right edge. It was
 * reported as a phone bug; it was every width from 600px (where the JS `is-mobile`
 * class stops applying) up to and including a 1024px laptop.
 *
 * The threshold below is "wider than any phone or small tablet in portrait". Under it,
 * a px floor is a real layout decision that a media query can be trusted to have
 * handled — `.commandHero`'s 260px sidebar collapses to one column at 900px. Over it,
 * the declaration cannot fit anywhere a person actually holds, and the fix is always
 * the same: `minmax(0, …)`, and let a media query decide how many columns to draw.
 * ADR-0134.
 */

const SRC = resolve(__dirname, '..')
const NO_PHONE_FITS_THIS = 600

const cssFiles = (dir) => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry)
  if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : cssFiles(path)
  return path.endsWith('.css') ? [path] : []
})

// Every `grid-template-columns` / `-rows` value, with `repeat(auto-fill|auto-fit, …)`
// stripped out first.
const explicitTracks = (css) => [...css.matchAll(/grid-template-(?:columns|rows):\s*([^;}]+)/g)]
  .map(m => m[1].replace(/repeat\(\s*auto-(?:fill|fit)\s*,[^)]*\([^)]*\)[^)]*\)/g, '')
                .replace(/repeat\(\s*auto-(?:fill|fit)\s*,[^)]*\)/g, ''))

// A bare `240px` track and the `240px` in `minmax(240px, 1fr)` are the same floor.
const floorPx = (value) => {
  const minmaxFloors = [...value.matchAll(/minmax\(\s*([\d.]+)px/g)].map(m => Number(m[1]))
  const bare = [...value.replace(/minmax\([^)]*\)/g, '').matchAll(/(?:^|[\s,(])([\d.]+)px/g)].map(m => Number(m[1]))
  return [...minmaxFloors, ...bare].reduce((a, b) => a + b, 0)
}

describe('an explicit grid fits a screen someone holds', () => {
  it.each(cssFiles(SRC).map(f => [f.slice(SRC.length + 1), f]))('%s', (_name, file) => {
    const offenders = explicitTracks(readFileSync(file, 'utf8'))
      .map(value => ({ value: value.trim().replace(/\s+/g, ' '), floor: floorPx(value) }))
      .filter(t => t.floor > NO_PHONE_FITS_THIS)
    expect(offenders, 'use minmax(0, …) and let a media query decide the column count').toEqual([])
  })
})
