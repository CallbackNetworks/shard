import { test, expect } from '@playwright/test'

/**
 * The tour works, and the app under it keeps working (ADR-0152).
 *
 * The second half is the point. ADR-0151 recorded a defect nobody could have caught:
 * the tour itself was fine, its unit tests were green, and what broke was whether the
 * page underneath was still usable — which no layer tested. The layer that would have
 * noticed was E2E, and E2E was the thing being knocked over, so the failure arrived as
 * four unrelated specs timing out on clicks.
 *
 * That ADR fixed the symptom by putting the suite in the returning-user state and said
 * plainly that the real fix — a scrim that does not swallow pointer events — had not
 * been made. This asserts the real fix, from the state a user is actually in: the tour
 * open, on purpose, with somebody trying to use the page.
 *
 * It starts the tour explicitly rather than relying on a first visit, so it is
 * unaffected by the global preference `global-setup.ts` writes, and it cannot race the
 * other spec files the way an assertion about first-visit behaviour would.
 */
test.use({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark' })

test('a page tour runs and does not block the page under it', async ({ page }) => {
  await page.goto('/explorer')
  await page.waitForLoadState('networkidle')

  // Every page with a tour draws this, from one mount point in the layout.
  const launcher = page.locator('[data-tour="page-tour"]')
  await expect(launcher).toBeVisible({ timeout: 15000 })
  await launcher.click()

  const bubble = page.getByRole('dialog', { name: /Guided tour|導覽/ })
  await expect(bubble).toBeVisible({ timeout: 10000 })

  // Copy, not translation keys. A missing key renders as its own name and looks like
  // text until you read it, which is exactly the kind of thing that ships.
  expect(await bubble.innerText(), 'the bubble is rendering raw translation keys')
    .not.toMatch(/tour\.[a-zA-Z]/)

  // The spotlit control is usable during the step that describes it.
  await page.getByRole('button', { name: /^Task/ }).first().click({ timeout: 5000 })
  await page.waitForTimeout(400)
  await expect(bubble).toBeVisible()

  // And so is the rest of the page. Navigating away ends the tour rather than
  // dragging the reader back to it.
  await page.getByRole('link', { name: 'Overview', exact: true }).click({ timeout: 5000 })
  await expect(bubble).toBeHidden({ timeout: 5000 })
  await expect(page).toHaveURL(/\/$/)
})
