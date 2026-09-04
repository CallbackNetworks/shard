import { test, expect, Page } from '@playwright/test'
import { mkdirSync, copyFileSync, existsSync, chownSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The in-app guide's pictures, captured from the running app (ADR-0148).
 *
 * `docs/screenshots/` was hand-captured once and then diverged from the product it
 * documents — two layout ADRs later, images described a UI nobody could still see.
 * The fix is not "recapture more carefully" but "capture from the app, on demand":
 * this spec is the source of every tutorial image, so a picture is never older than
 * the run that made it.
 *
 * Both destinations are written in one pass because the two copies cannot be the
 * same file: `Dockerfile.prod`'s build context is `./frontend`, so an image under
 * `docs/` is unreachable from the SPA build no matter how it is referenced. The app
 * serves its own copy out of `public/guide`; the repo docs keep theirs.
 *
 * Not part of the CI check suite. It writes into the working tree and needs a
 * populated database to produce anything worth looking at — `scripts/screenshots.sh`
 * seeds, runs it and reports what changed.
 */

const API = process.env.API_URL || 'http://localhost:8000'
const GUIDE_DIR = process.env.GUIDE_SHOT_DIR || '/out/guide'
const DOCS_DIR = process.env.DOCS_SHOT_DIR || '/out/docs'
// This container runs as root and the destinations are bind mounts, so every PNG
// lands owned by root in the host's working tree — unstageable without a second
// privileged command, which is the ownership trap ADR-0138/0139 hit at a larger
// scale. The caller passes its own uid and the file is handed over as it is written.
const SHOT_UID = Number(process.env.SHOT_UID || 0)
const SHOT_GID = Number(process.env.SHOT_GID || 0)

// The guide is written against the dark theme with the rail expanded, which is what
// a new install looks like. A viewport wide enough for the two-column command layout
// but not so wide the screenshots become unreadable when scaled into a page column.
test.use({
  viewport: { width: 1440, height: 960 },
  colorScheme: 'dark',
  // 1x, not retina. These images ship inside the SPA build and are drawn at roughly
  // half the capture width in a guide column, so 2x bought nothing visible and cost
  // ~2.5MB per file — 60MB of screenshots in a frontend image.
  deviceScaleFactor: 1,
})

// Each of these tests walks a handful of pages, and every page waits for the routed
// content to actually render. The suite default of 30s is sized for a single
// assertion and cut the last capture off mid-run — a failure that looks like a
// broken page and is really a stopwatch.
test.setTimeout(180000)

for (const dir of [GUIDE_DIR, DOCS_DIR]) mkdirSync(dir, { recursive: true })

/** Capture once, land in both destinations. */
async function shoot(page: Page, name: string, opts: { full?: boolean } = {}) {
  const file = join(GUIDE_DIR, `${name}.png`)
  await page.screenshot({ path: file, fullPage: opts.full ?? false, animations: 'disabled' })
  expect(existsSync(file), `${name}.png was not written — the output mount is missing`).toBe(true)
  const docsFile = join(DOCS_DIR, `${name}.png`)
  copyFileSync(file, docsFile)
  if (SHOT_UID) for (const f of [file, docsFile]) chownSync(f, SHOT_UID, SHOT_GID)
}

/**
 * Arrive at a page and wait for it to have actually rendered.
 *
 * `networkidle` alone is not enough and the dashboard spec says why: the shell
 * renders, the routed page does not, and every assertion about "the page loaded"
 * still holds. A screenshot taken in that state is a picture of an empty column,
 * and it is a picture that never fails — which is the whole failure mode this file
 * exists to avoid.
 */
async function open(page: Page, path: string) {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  const shell = page.locator('.kt-route-shell')
  await expect(shell).toBeVisible({ timeout: 15000 })
  await expect
    .poll(async () => (await shell.innerText()).trim().length, {
      message: `${path} rendered the app shell but no content`,
      timeout: 15000,
    })
    .toBeGreaterThan(50)
  // Entrance animations are staggered per card; a shot mid-stagger shows half the
  // page at partial opacity (ADR-0133 is the same mechanism from the other side).
  await page.waitForTimeout(700)
}

test.describe('guide screenshots', () => {
  test.describe.configure({ mode: 'serial' })

  let projectId: string
  let taskIds: string[] = []

  test.beforeAll(async ({ request }) => {
    // The pictures are only worth taking against work that looks like work. A shot
    // of an empty board teaches nothing, and an empty board is exactly what a fresh
    // CI database produces.
    const project = await request.post(`${API}/api/nodes`, {
      data: { type: 'project', title: 'Guide Tour', description: 'The project the tutorial walks through' },
    })
    projectId = (await project.json()).id
    const now = Date.now()
    const seeds = [
      { title: 'Draft the launch note', status: 'done', priority: 'medium' },
      { title: 'Wire the export endpoint', status: 'in_progress', priority: 'high' },
      { title: 'Review the migration', status: 'todo', priority: 'high', due_date: new Date(now + 2 * 86400000).toISOString() },
      { title: 'Chase the missing invoice', status: 'todo', priority: 'low', due_date: new Date(now - 86400000).toISOString() },
      { title: 'Schedule the retro', status: 'todo', priority: 'medium' },
    ]
    for (const seed of seeds) {
      const res = await request.post(`${API}/api/nodes`, { data: { type: 'task', container_id: projectId, ...seed } })
      taskIds.push((await res.json()).id)
    }

    // A cycle with tasks in it. The first capture of the Cycles tab was a picture of
    // "No cycles yet" filed under a chapter explaining burndown and velocity — an
    // empty screen photographs perfectly and teaches nothing, which is the failure
    // this file's own header warns about.
    const cycle = await request.post(`${API}/api/nodes`, {
      data: {
        type: 'cycle',
        container_id: projectId,
        title: 'Sprint 14',
        start_date: new Date(now - 6 * 86400000).toISOString(),
        due_date: new Date(now + 8 * 86400000).toISOString(),
        status: 'active',
      },
    })
    if (cycle.ok()) {
      const cycleId = (await cycle.json()).id
      for (const taskId of taskIds.slice(0, 3)) {
        await request.post(`${API}/api/projects/${projectId}/cycles/${cycleId}/tasks/${taskId}`)
      }
    }
  })

  test.afterAll(async ({ request }) => {
    // Deleting the container cascades its tasks (ADR-0131), so a rerun does not
    // accumulate a new "Guide Tour" project every time.
    if (projectId) await request.delete(`${API}/api/nodes/${projectId}`)
  })

  test('overview', async ({ page }) => {
    await open(page, '/')
    await shoot(page, '01-overview')
    // The two the guide's "jump from anywhere" chapter needs: the numbers, and a
    // narrowed list arrived at by clicking one of them.
    await open(page, '/?tab=tasks&only=overdue')
    await shoot(page, '02-overview-overdue')
  })

  test('project views', async ({ page }) => {
    await open(page, `/projects/${projectId}`)
    await shoot(page, '03-project-issues')
    for (const [tab, name] of [['board', '04-project-board'], ['timeline', '05-project-timeline'], ['calendar', '06-project-calendar'], ['table', '07-project-table']]) {
      await open(page, `/projects/${projectId}?tab=${tab}`)
      await shoot(page, name)
    }
  })

  test('the rest of the app', async ({ page }) => {
    // The numbering is capture order and nothing else — it is deliberately *not*
    // reading order. `docs/screenshots.md` and `README.md` reference these by name,
    // so renumbering to match a rewritten guide would rename eighteen files to move
    // some pictures around inside one page, and break two documents doing it.
    const pages: Array<[string, string]> = [
      ['/analytics', '08-analytics'],
      ['/structure', '09-structure-map'],
      ['/decisions', '10-decisions'],
      ['/activity', '11-activity'],
      ['/assistant', '12-assistant'],
      ['/workflow-rules', '13-workflow-rules'],
      ['/integrations', '14-integrations'],
      ['/identities', '15-identities'],
      ['/graph-types', '16-item-types'],
      ['/explorer', '17-node-explorer'],
      ['/settings', '18-settings'],
      // Added with the rewritten guide (ADR-0152): every one of these was a chapter
      // describing a screen the reader had never been shown.
      ['/goals', '20-goals'],
      ['/templates', '21-templates'],
      ['/webhook-logs', '23-webhook-logs'],
      ['/api-keys', '24-api-keys'],
      ['/guide', '27-guide'],
    ]
    for (const [path, name] of pages) {
      await open(page, path)
      await shoot(page, name)
    }
  })

  /**
   * The decision graph, reached the way a person reaches it.
   *
   * `/decisions?mode=graph` looks like it should work and does not: the mode is
   * component state, not URL state, so that address renders the list and the capture
   * silently produced a picture of the wrong view under the right filename — which is
   * the exact failure this whole spec exists to prevent, arriving from inside it.
   */
  test('the decision graph', async ({ page }) => {
    await open(page, '/decisions')
    await page.getByRole('button', { name: /^Graph$/i }).click()
    await page.waitForTimeout(1200)
    await shoot(page, '22-decisions-graph')
  })

  test('the project cycles tab', async ({ page }) => {
    await open(page, `/projects/${projectId}?tab=cycles`)
    await shoot(page, '19-project-cycles')
  })

  /**
   * The public share page, captured through the door a visitor uses.
   *
   * Not `/projects/{id}` with something hidden: the whole point of the sharing
   * chapter is what a person outside your account sees, and a picture of the owner's
   * page with a caption claiming otherwise is the kind of documentation that is
   * wrong in the one way nobody checks. The token is minted here and the page is
   * opened at its real address.
   */
  test('the public share page', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/${projectId}/share/rotate-token`)
    if (!res.ok()) test.skip(true, `share token could not be minted: ${res.status()}`)
    const token = (await res.json()).share_token
    await page.goto(`/share/n/${token}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1200)
    await shoot(page, '25-share-page')
  })

  test('the command palette', async ({ page }) => {
    await open(page, '/')
    // The palette is a keyboard gesture, so it is opened by the gesture. Reaching
    // into the app's state to force it open would photograph a state a user cannot
    // produce, and would keep passing if the shortcut broke.
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(600)
    await shoot(page, '26-command-palette')
  })
})
