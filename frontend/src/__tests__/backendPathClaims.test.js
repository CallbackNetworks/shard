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
    expect(isClaimed('/share/node/tok')).toBe(true)
    expect(isClaimed('/share/project/tok')).toBe(true)
    // ...while the SPA's own share pages keep falling through to the app.
    expect(isClaimed('/share/n/sometoken')).toBe(false)
    expect(isClaimed('/share/p/sometoken')).toBe(false)
  })

  /**
   * The converse claim, which is where this rule actually broke (ADR-0071).
   *
   * The check above only ever asked "is a page route wrongly claimed?". A URL that is
   * *both* — a page route and the path that page fetches — passes it and still cannot
   * work: `/share/n/:token` fetching `GET /share/n/{token}` was answered by the SPA's
   * own index.html, HTTP 200 and `text/html`, so the generic share page never loaded
   * its data in any browser while every backend test stayed green.
   */
  describe('every root-level path the client fetches is claimed', () => {
    const client = read('src/api/client.js')

    /** Root-level (non-`/api`) request URLs the client builds, as concrete paths. */
    function rootFetchPaths() {
      return [...client.matchAll(/axios\.(?:get|post|put|patch|delete)\(`([^`]+)`/g)]
        .map(m => m[1])
        // `${scope}` stands for whichever scope the caller passes; both are real paths.
        .flatMap(u => (u.includes('${scope}') ? ['node', 'project'].map(s => u.replace('${scope}', s)) : [u]))
        .map(u => u.replace(/\$\{[^}]+\}/g, 'x'))
        .filter(u => u.startsWith('/'))
    }

    it('finds the calls it is supposed to be checking', () => {
      const paths = rootFetchPaths()
      expect(paths.length).toBeGreaterThan(2)
      expect(paths).toContain('/share/node/x')
    })

    it('the dev server proxies each of them to the backend', () => {
      expect(rootFetchPaths().filter(p => !claimedByBackend(p))).toEqual([])
    })

    it('production nginx proxies each of them to the backend', () => {
      const shareRe = /location\s+~\s+\^([^\s{]+)/g
      const regexLocations = [...read('nginx.conf').matchAll(shareRe)].map(m => new RegExp(m[1]))
      const plain = nginxLocations()
      const proxied = (p) =>
        regexLocations.some(re => re.test(p)) ||
        plain.some(l => (l.modifier === '=' ? p === l.path : p.startsWith(l.path)))
      expect(rootFetchPaths().filter(p => !proxied(p))).toEqual([])
    })
  })
})
