import { test, expect } from '@playwright/test'

const API = process.env.API_URL || 'http://localhost:8000'

// Both tests in this file used to be wrapped in `if (await projectCard.isVisible())`.
// CI runs against a fresh, empty database, so the branch never entered and both tests
// reported pass having asserted nothing — in the only file that covers a project's task
// list, the app's primary surface.
//
// Seeded here instead of assuming data exists. Everything is created through the same
// node write surface the app itself uses (ADR-0040/0042), so the fixture cannot drift
// from a per-entity endpoint that no longer exists.
let projectId: string
let projectTitle: string

async function createNode(request, body: Record<string, unknown>) {
  const resp = await request.post(`${API}/api/nodes`, { data: body })
  expect(resp.status(), `creating ${JSON.stringify(body)} failed: ${await resp.text()}`).toBe(201)
  return resp.json()
}

test.beforeAll(async ({ request }) => {
  projectTitle = `E2E Project ${Date.now()}`
  const project = await createNode(request, { type: 'project', title: projectTitle })
  projectId = project.id

  await createNode(request, {
    type: 'task',
    title: 'E2E seeded todo task',
    container_id: projectId,
    status: 'todo',
  })
  await createNode(request, {
    type: 'task',
    title: 'E2E seeded finished task',
    container_id: projectId,
    status: 'done',
  })
})

test.afterAll(async ({ request }) => {
  // Deleting the container cascades its exclusively-owned tasks, so the two seeded
  // rows go with it and a re-run does not accumulate projects.
  if (projectId) await request.delete(`${API}/api/nodes/${projectId}`)
})

// BLOCKED, not flaky. Under Playwright the app renders its chrome — sidebar, ticker,
// activity strip — and `.kt-route-shell` stays completely empty on *every* route,
// dashboard included. No console error, no failed request, no pageerror, no Suspense
// fallback: the routed component simply produces nothing. Confirmed against both the
// Vite dev server and the built prod image, with `/api/auth/me` returning
// `auth_required: false`, so it is neither a dev-server artifact nor the auth gate.
//
// Every assertion below is correct and the seeding works (the API returns 201 and the
// activity ticker reports the writes). They cannot pass until the blank render is
// understood, so they are marked rather than deleted — the seeding is the part that
// was missing, and throwing it away would leave the next person to rediscover it.
//
// The same blankness is why the rest of this suite is green: all 11 other e2e tests
// assert only on chrome (`.layout-sidebar` visible, `#main-content` visible, the search
// button, zero pageerrors), every one of which holds on an empty page.
test.describe('Project Detail', () => {
  test.fixme(true, 'routed content renders nothing under Playwright — see the note above')

  // `.kt-route-shell` is the routed page, and the activity ticker is its sibling
  // inside <main> (App.jsx). Scoping matters more than it looks: every ticker entry
  // names both a task and the project it was created in, so an unscoped text locator
  // matches a marquee span first — and because that span is animating, the failure
  // arrives as a stability timeout rather than the assertion you wrote.
  const content = (page) => page.locator('.kt-route-shell')

  test('the seeded project is reachable from the dashboard', async ({ page }) => {
    await page.goto('/app')
    await page.waitForLoadState('networkidle')

    const card = content(page).getByText(projectTitle).first()
    await expect(card).toBeVisible()
    await card.click()

    await expect(page).toHaveURL(new RegExp(`projects/${projectId}`))
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Error')
  })

  test('the project page lists the tasks it contains', async ({ page }) => {
    await page.goto(`/app/projects/${projectId}`)
    await page.waitForLoadState('networkidle')

    // The titles, not a status vocabulary: the old assertion looked for the strings
    // "todo|in_progress|done" anywhere in the body, which the filter controls satisfy
    // on their own whether or not a single task rendered.
    await expect(content(page).getByText('E2E seeded todo task').first()).toBeVisible()
    await expect(content(page).getByText('E2E seeded finished task').first()).toBeVisible()
  })

  test('the page renders without a client-side crash', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto(`/app/projects/${projectId}`)
    await page.waitForLoadState('networkidle')

    expect(errors, `uncaught errors: ${errors.join(' | ')}`).toHaveLength(0)
  })
})
