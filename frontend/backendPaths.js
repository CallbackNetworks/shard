/**
 * Which URL paths belong to the backend rather than to the SPA.
 *
 * Its own module, and not a const inside `vite.config.js`, so the guard test can exercise
 * the real function: importing the vite config into jsdom drags esbuild in with it, and a
 * test that reimplemented this rule would have passed against the broken version too.
 *
 * Every entry names a whole path *segment*, and matching is anchored to match: a request
 * belongs to the backend only when it equals the entry or continues with `/` or `?`.
 * Written as bare prefixes — which is how this started — the list also claimed every page
 * route that merely began with the same letters. `/api-keys` and `/webhook-logs` were
 * proxied to the backend, which answered 404, so both pages worked when reached by in-app
 * navigation and broke on reload, bookmark or a shared link. ADR-0036 put the internal API
 * under `/api` precisely so page routes could not collide; the collision came back through
 * the matching rule instead of the namespace (ADR-0061).
 *
 * Share data is claimed one segment deeper (`/share/identity`, `/share/project`) so the
 * SPA's own share *pages* (`/share/:token`, `/share/p/:token`) still fall through to the
 * app. `nginx.conf` carries the same list for production and must stay in step;
 * `src/__tests__/backendPathClaims.test.js` checks both against the router.
 */
export const BACKEND_PATHS = [
  '/api', '/webhook', '/share/identity', '/share/project',
  '/ical', '/ws', '/health', '/docs', '/openapi.json', '/redoc',
]

export const claimedByBackend = (url) =>
  BACKEND_PATHS.some(p => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`))
