/**
 * No SPA page route may be claimed by a backend path (ADR-0036, ADR-0061).
 *
 * The internal API was namespaced under `/api` so that backend paths and page routes could
 * never collide. The namespace was right; the *matching* was not. Both the dev proxy and
 * the production nginx config asked "does this URL start with `/api`?", which is true of
 * `/api-keys` — so the SPA's own API Keys page was proxied to the backend and answered
 * 404. Same for `/webhook` and `/webhook-logs`. Both pages worked when reached by in-app
 * navigation, because React Router never asks the server, and broke on reload, bookmark or
 * a shared link. Nothing failed loudly enough for a test to notice.
 *
 * These read the two config files as text rather than importing them: nginx.conf is not
 * JavaScript, and the whole point is that the two must agree with the router without any
 * shared runtime to keep them honest.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { BACKEND_PATHS, claimedByBackend } from '../../backendPaths.js'

const read = (p) => readFileSync(resolve(__dirname, '../..', p), 'utf8')

/** Every path the SPA router answers, as a concrete URL a browser could be pointed at. */
function spaRoutes() {
  const app = read('src/App.jsx')
  const paths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1])
  return paths
    .filter(p => p !== '/*' && p !== '*')
    .map(p => (p.startsWith('/') ? p : `/${p}`))
    // A param stands for whatever the user actually has; any literal will do.
    .map(p => p.replace(/:[A-Za-z]+/g, 'x'))
}

/** Production locations, as (kind, path) so `=` exact matches are not treated as prefixes. */
function nginxLocations() {
  return [...read('nginx.conf').matchAll(/^\s*location\s+(=\s+|~\*?\s+)?([^\s{]+)/gm)]
    .map(m => ({ modifier: (m[1] || '').trim(), path: m[2] }))
    .filter(l => l.path !== '/' && !l.modifier.startsWith('~'))
}

describe('backend paths do not claim SPA page routes', () => {
  const routes = spaRoutes()

  it('finds the routes it is supposed to be checking', () => {
    // A regex that silently matched nothing would make every assertion below vacuous.
    expect(routes.length).toBeGreaterThan(15)
    expect(routes).toContain('/api-keys')
    expect(routes).toContain('/webhook-logs')
  })

  it('the dev server serves every page route from the SPA', () => {
    expect(routes.filter(claimedByBackend)).toEqual([])
  })

  it('production nginx serves every page route from the SPA', () => {
    const locations = nginxLocations()
    const claimed = routes.filter(r =>
      locations.some(l => (l.modifier === '=' ? r === l.path : r.startsWith(l.path))),
    )
    expect(claimed).toEqual([])
  })

  it('the two configs claim the same namespaces', () => {
    // Drift between them is the failure that only shows up in production.
    const nginx = nginxLocations().map(l => l.path.replace(/\/$/, ''))
    for (const p of BACKEND_PATHS) {
      // /share/* is one regex location in nginx, deliberately, and is excluded above.
      if (p.startsWith('/share/')) continue
      expect(nginx, `nginx.conf has no location for ${p}`).toContain(p)
    }
  })

  it('still routes real backend paths to the backend', () => {
    const isClaimed = claimedByBackend

    expect(isClaimed('/api/projects')).toBe(true)
    expect(isClaimed('/api/v1/nodes')).toBe(true)
    expect(isClaimed('/webhook/callback/abc')).toBe(true)
    expect(isClaimed('/ws')).toBe(true)
    expect(isClaimed('/health')).toBe(true)
    expect(isClaimed('/share/identity/tok')).toBe(true)
    // ...while the SPA's own share pages keep falling through to the app.
    expect(isClaimed('/share/sometoken')).toBe(false)
    expect(isClaimed('/share/p/sometoken')).toBe(false)
  })
})
