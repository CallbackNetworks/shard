import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test('app shell renders', async ({ page }) => {
    await page.goto('/app')
    await expect(page.locator('.layout-sidebar')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('#main-content')).toBeVisible()
  })

  test('loads without a runtime error', async ({ page }) => {
    // The SPA renders through React Query against a live backend, so a broken
    // request or a crashed component shows up here and nowhere in the unit tests.
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/app')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.layout-sidebar')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('command palette opens', async ({ page }) => {
    await page.goto('/app')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible()
  })
})
