import { test, expect, devices } from '@playwright/test'

test.use(devices['iPhone 13'])

test.describe('Mobile Layout', () => {
  test('hamburger menu is visible on mobile', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const hamburger = page.locator('.mobile-menu-btn')
    await expect(hamburger).toBeVisible()
  })

  test('sidebar opens when hamburger is clicked', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const hamburger = page.locator('.mobile-menu-btn')
    await hamburger.click()
    const sidebar = page.locator('.layout-sidebar.open')
    await expect(sidebar).toBeVisible()
  })

  test('main content is full width on mobile', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const main = page.locator('main')
    const box = await main.boundingBox()
    expect(box).not.toBeNull()
    const viewportWidth = page.viewportSize()?.width || 390
    expect(box!.width).toBeGreaterThanOrEqual(viewportWidth - 10)
  })

  test('notification center is positioned correctly', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const bell = page.locator('.kt-notification-center')
    const box = await bell.boundingBox()
    if (box) {
      const viewportWidth = page.viewportSize()?.width || 390
      expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth)
      expect(box.y).toBeLessThan(60)
    }
  })
})
