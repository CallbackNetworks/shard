import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test('app shell renders', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.layout-sidebar')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('#main-content')).toBeVisible()
  })

  test('loads without a runtime error', async ({ page }) => {
    // The SPA renders through React Query against a live backend, so a broken
    // request or a crashed component shows up here and nowhere in the unit tests.
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.layout-sidebar')).toBeVisible()
    expect(errors).toEqual([])
  })

  // Every assertion above holds on a page whose entire content area is blank —
  // sidebar visible, #main-content visible (an empty container is still visible),
  // no runtime error. That is not hypothetical: the whole suite navigated to `/app`
  // for two months after the routes moved to `/`, and passed the entire time against
  // a shell with nothing routed into it. This is the assertion that was missing.
  test('the routed page renders content, not just the shell', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const shell = page.locator('.kt-route-shell')
    await expect(shell).toBeVisible()
    await expect
      .poll(async () => (await shell.innerText()).trim().length, {
        message: '.kt-route-shell is empty — the URL renders the app shell but matches no route',
        timeout: 10000,
      })
      .toBeGreaterThan(50)
  })

  test('command palette opens', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible()
  })
})
