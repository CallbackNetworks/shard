import { test, expect } from '@playwright/test'

const API = process.env.API_URL || 'http://localhost:8000'

test.describe('API Health', () => {
  test('health endpoint returns ok', async ({ request }) => {
    const resp = await request.get(`${API}/health`)
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body.status).toBe('ok')
  })

  test('internal API lives under /api', async ({ request }) => {
    // ADR-0036: SPA-facing routers are mounted under /api so backend paths cannot
    // collide with SPA page routes. Root-level /projects is not a contract.
    const resp = await request.get(`${API}/api/projects`)
    expect(resp.status()).toBe(200)
    expect(Array.isArray(await resp.json())).toBe(true)

    const root = await request.get(`${API}/projects`)
    expect(root.status()).toBe(404)
  })

  test('openapi spec is available', async ({ request }) => {
    const resp = await request.get(`${API}/openapi.json`)
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body.paths).toBeDefined()
  })

  test('external API rejects a request with no key', async ({ request }) => {
    // 422 (missing required header) rather than 401 (header present but bad);
    // both are rejections, and which one you get is a FastAPI validation detail.
    const resp = await request.get(`${API}/api/v1/summary`)
    expect([401, 422]).toContain(resp.status())
  })

  test('external API rejects an invalid key', async ({ request }) => {
    const resp = await request.get(`${API}/api/v1/summary`, {
      headers: { 'X-API-Key': 'tdp_definitely_not_a_real_key' },
    })
    expect(resp.status()).toBe(401)
  })

  test('external API works with a valid key', async ({ request }) => {
    // Needs a key provisioned in the target environment; skipped when absent so
    // the suite stays runnable against a fresh database.
    test.skip(!process.env.API_KEY, 'set API_KEY to run this test')
    const resp = await request.get(`${API}/api/v1/summary`, {
      headers: { 'X-API-Key': process.env.API_KEY! },
    })
    expect(resp.status()).toBe(200)
    expect(await resp.json()).toHaveProperty('total_projects')
  })
})
