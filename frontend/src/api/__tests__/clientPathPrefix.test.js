/**
 * The `/api` client must not be pointed at a root-level backend path (ADR-0085).
 *
 * `api` is an axios instance with `baseURL: '/api'` (ADR-0036), so every path handed to it
 * is *relative to that namespace*. Root-level paths — `/webhook`, `/share`, `/ical`, `/ws`
 * — are external contracts that deliberately live outside it, and calling one through this
 * instance produces `/api/webhook/...`, which matches no route at all.
 *
 * That is not hypothetical. `getWebhookEvents` did exactly this, requesting
 * `/api/webhook/events/{id}` while the endpoint only ever existed at `/webhook/events/{id}`,
 * so the build-history panel had never loaded once. Nothing failed loudly: React Query
 * reports an error into a panel nobody had a reason to open, and every test mocked the
 * client rather than exercising the URL it builds. The same shape as ADR-0058's burndown
 * call and ADR-0071's share fetch — a path that reads correct against the backend's route
 * table and is wrong against the client that requests it.
 *
 * Read as source text on purpose: importing the module would only tell us what it exports,
 * not which URLs it builds.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { BACKEND_PATHS } from '../../../backendPaths.js'

const source = readFileSync(resolve(__dirname, '../client.js'), 'utf8')

/** Paths passed to the `/api`-based instance: `api.get('/x')`, `api.post(\`/x/${id}\`)`. */
function apiInstancePaths() {
  return [...source.matchAll(/\bapi\.(get|post|patch|put|delete)\(\s*[`'"]([^`'"]+)/g)].map(m => m[2])
}

/** Root-level prefixes that are NOT reachable through the `/api` namespace. */
const ROOT_ONLY = BACKEND_PATHS.filter(p => p !== '/api')

describe('the /api client is never handed a root-level backend path', () => {
  const paths = apiInstancePaths()

  it('finds the calls it is supposed to be checking', () => {
    // A regex that silently matched nothing would make the assertion below vacuous — the
    // near-miss ADR-0061 records, where the first guard passed against the broken config.
    expect(paths.length).toBeGreaterThan(50)
    expect(paths).toContain('/nodes')
  })

  it.each(ROOT_ONLY)('no call starts with %s', (prefix) => {
    const offenders = paths.filter(p => p === prefix || p.startsWith(`${prefix}/`))
    expect(offenders).toEqual([])
  })

  it('build history is requested under /api/nodes, where the route now lives', () => {
    expect(paths.some(p => p.includes('/webhook-events'))).toBe(true)
    expect(paths.some(p => p.includes('webhook/events'))).toBe(false)
  })
})
