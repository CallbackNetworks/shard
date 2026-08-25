import { test, expect } from '@playwright/test'

test.describe('Floating Panels', () => {
  test('notification bell is visible and clickable', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const bell = page.locator('.kt-notification-center button').first()
    await expect(bell).toBeVisible()
    await bell.click()
    const panel = page.locator('.kt-notification-panel')
    await expect(panel).toBeVisible()
  })

  test('assistant FAB is visible', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const fab = page.locator('.kt-assistant-fab')
    await expect(fab).toBeVisible()
  })

  test('assistant panel opens on click', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const fab = page.locator('.kt-assistant-fab')
    await fab.click()
    const panel = page.locator('.kt-assistant-panel')
    await expect(panel).toBeVisible()
  })

  test('floating panels do not block main content', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const main = page.locator('main')
    const mainBox = await main.boundingBox()
    expect(mainBox).not.toBeNull()
    expect(mainBox!.width).toBeGreaterThan(300)
  })
})
