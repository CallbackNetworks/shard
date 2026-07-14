# ADR-0030: Application Auth Hardening and Forward-Auth Delegation

## Status
Accepted

## Date
2026-07-14

## Context
The application shipped with a single shared-password gate for `/app`. Two
weaknesses made it feel unfit for a public open-source project:

1. **Session tokens never expired.** The signed token's second segment was a
   random value that `verify_token` never inspected, so a leaked token stayed
   valid until the password changed.
2. **No brute-force protection.** `/auth/login` accepted unlimited guesses.

Separately, we wanted to let operators delegate authentication to a real
identity provider (Google, GitHub, etc.) for SSO and MFA. The tempting option —
removing built-in auth entirely and putting Cloudflare Access in front — is
wrong for a self-hostable project: it forces every deployer onto one commercial
proxy and makes the app **insecure by default** for anyone who runs it without
that proxy. The app has deliberately public endpoints (`/webhook/`, `/api/v1/`,
`/share/`, `/ical/`, `/health`) that machine clients must reach, so an all-or-
nothing edge gate is also a poor fit.

The established pattern among self-hostable tools (Gitea, Miniflux, Grafana,
Paperless-ngx) is: keep built-in auth that works standalone, **and** optionally
trust an upstream proxy's identity header for those who want SSO.

## Decision
Keep the built-in shared-password gate as the zero-dependency default, and:

- **Expiring tokens.** `issue_token` embeds a real unix expiry
  (`AUTH_TOKEN_TTL`, default 7 days); `verify_token` validates both the HMAC
  signature (constant-time) and that the token is unexpired.
- **Login throttling.** Failures are counted per client IP; after
  `AUTH_MAX_ATTEMPTS` within `AUTH_LOCKOUT_SECONDS` (default 5 / 300s) further
  attempts return `429` until the window rolls off. A successful login clears
  the counter. State is in-memory — sufficient for single-instance self-hosting.
- **Password comparison** uses `hmac.compare_digest` to avoid timing leaks.
- **Forward-auth mode.** When `AUTH_PROXY_HEADER` is set, the app trusts that
  header to carry an already-authenticated identity, delegating login to an
  upstream SSO proxy (Cloudflare Access `Cf-Access-Authenticated-User-Email`,
  oauth2-proxy `X-Auth-Request-Email`, Authelia/Authentik `Remote-User`). The
  central `is_authenticated()` gate passes a request when a trusted proxy
  asserts an identity **or** a valid password token is presented, so the two
  mechanisms can coexist. In proxy mode `/auth/me` reports `auth_required:false`
  so the SPA renders no login gate. Auth is considered enabled when *either*
  mechanism is configured.

The public bypass list (`/webhook/`, `/api/v1/`, `/share/`, `/ical/`,
`/health`, `/auth/`, docs) is unchanged; forward-auth gates the human UI only.

## Consequences
**Positive:** Secure-by-default standalone deployment (expiring sessions, brute-
force resistance) with no external dependency. Operators can layer any OIDC/SSO
proxy without app changes and without vendor lock-in. The frontend needs no
changes — proxy mode is transparent to the SPA.

**Negative / trade-offs:** Forward-auth is **only safe when the origin is
reachable exclusively through the trusted proxy** — a client that reaches the
origin directly can forge the header. This constraint is documented in
`.env.example` and must be enforced at the network layer (e.g. Cloudflare
Tunnel, firewall, or origin allowlist). Throttle state is per-process and resets
on restart; a multi-instance deployment would need shared state (out of scope
for the current single-instance target).
