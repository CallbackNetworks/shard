import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test('loads and shows projects', async ({ page }) => {
    await page.goto('/app')
    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('body')).not.toContainText('Error')
  })

  test('sidebar navigation works', async ({ page }) => {
    await page.goto('/app')
    await page.waitForLoadState('networkidle')
    const sidebar = page.locator('.layout-sidebar')
    await expect(sidebar).toBeVisible()
  })

  test('new project button exists', async ({ page }) => {
    await page.goto('/app')
    await page.waitForLoadState('networkidle')
    const btn = page.getByRole('button', { name: /new project/i })
    await expect(btn).toBeVisible()
  })
})
