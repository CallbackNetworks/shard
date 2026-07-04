import { test, expect } from '@playwright/test'

const API = process.env.API_URL || 'http://localhost:8000'

test.describe('API Health', () => {
  test('health endpoint returns ok', async ({ request }) => {
    const resp = await request.get(`${API}/health`)
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body.status).toBe('ok')
  })

  test('projects endpoint returns array', async ({ request }) => {
    const resp = await request.get(`${API}/projects`)
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test('openapi spec is available', async ({ request }) => {
    const resp = await request.get(`${API}/openapi.json`)
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body.paths).toBeDefined()
  })

  test('external API requires auth', async ({ request }) => {
    const resp = await request.get(`${API}/api/v1/summary`)
    expect(resp.status()).toBe(401)
  })

  test('external API works with key', async ({ request }) => {
    const key = process.env.API_KEY || 'tdp_bc2ace77734b3c48a2b0a280dd72516b1d14a127c029c097'
    const resp = await request.get(`${API}/api/v1/summary`, {
      headers: { 'X-API-Key': key },
    })
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body.total_projects).toBeGreaterThan(0)
  })
})
