import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8')

describe('PWA API caching', () => {
  it('never serves authenticated API responses from a service-worker cache', () => {
    expect(viteConfig).toContain("url.pathname.startsWith('/api/')")
    expect(viteConfig).toContain("handler: 'NetworkOnly'")
    expect(viteConfig).not.toContain("cacheName: 'api-cache'")
  })
})
