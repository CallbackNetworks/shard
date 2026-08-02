import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Nothing may reach the internal API at the root of the origin (ADR-0036).
 *
 * The internal API is mounted under `/api` precisely so backend paths cannot collide with
 * SPA page routes — which means a request to `/analytics/cycle-burndown` is not a 404 the
 * caller can notice. Both the dev proxy and the production nginx answer an unknown root
 * path with the SPA's own `index.html`: HTTP 200, `Content-Type: text/html`, and a body
 * that any `.catch()` will never see. The burndown chart shipped that way and rendered
 * "no data" forever.
 *
 * A static scan rather than a runtime one, because the failure only appears on the one
 * screen that makes the call. Root-level paths are the external contracts, and only those.
 */
const ROOT_CONTRACTS = ['/api/', '/share/', '/ical/', '/webhook/', '/ws', '/health', '/docs', '/openapi.json']

// vitest runs with the frontend package root as its working directory.
const SRC = join(process.cwd(), 'src')

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(full)
    return /\.jsx?$/.test(entry) ? [full] : []
  })
}

// A literal absolute path handed straight to axios or fetch. A template that starts with
// an interpolation carries its own prefix and is left alone.
const CALL = /(?:axios\s*\.\s*(?:get|post|put|patch|delete)|fetch)\(\s*[`'"](\/[^`'"$]*)/g

describe('internal API calls go through the /api prefix', () => {
  it('makes no bare root-level request outside the external contracts', () => {
    const offenders = []
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const [, path] of text.matchAll(CALL)) {
        if (!ROOT_CONTRACTS.some(prefix => path === prefix || path.startsWith(prefix))) {
          offenders.push(`${file.slice(SRC.length + 1)}: ${path}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
