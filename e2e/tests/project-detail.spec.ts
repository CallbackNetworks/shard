import { test, expect } from '@playwright/test'

test.describe('Project Detail', () => {
  test('can navigate to a project', async ({ page }) => {
    await page.goto('/app')
    await page.waitForLoadState('networkidle')
    const projectCard = page.locator('[class*="projectCard"], [class*="ProjectCard"]').first()
    if (await projectCard.isVisible()) {
      await projectCard.click()
      await expect(page).toHaveURL(/projects\//)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).not.toContainText('Error')
    }
  })

  test('task list is visible in project', async ({ page }) => {
    await page.goto('/app')
    await page.waitForLoadState('networkidle')
    const projectCard = page.locator('[class*="projectCard"], [class*="ProjectCard"]').first()
    if (await projectCard.isVisible()) {
      await projectCard.click()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toContainText(/todo|in_progress|done/i, { timeout: 5000 })
    }
  })
})
