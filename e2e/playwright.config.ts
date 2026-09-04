import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  // The guide-shot capture lives in this directory but is not a check: it writes
  // PNGs into the working tree and needs seeded data to produce anything worth
  // looking at (ADR-0148). Opted in by `scripts/screenshots.sh`, which sets
  // GUIDE_SHOTS — excluded here rather than moved elsewhere so it keeps this
  // project's baseURL, its browser pin and the `open()` readiness rules the other
  // specs learned the hard way.
  testIgnore: process.env.GUIDE_SHOTS ? [] : ['**/guide-shots.spec.ts'],
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
})
