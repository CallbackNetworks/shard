import { request } from '@playwright/test'

const API = process.env.API_URL || 'http://localhost:8000'

// Mark the guided tour as already seen before any spec runs.
//
// ADR-0148 shipped a first-visit tour whose "seen" flag is a *server* preference, so
// that a returning user is not walked through the product again on a second machine.
// The integration suite runs against a freshly built prod stack with an empty database,
// which means every run is a first visit: the tour opened on `/` and its scrim sat over
// the page, so `locator.click()` in four specs timed out with
// `<div class="_scrim_…"> from <div aria-modal="true" aria-label="Guided tour"> subtree
// intercepts pointer events`. Three runs went 4 failed / 16 passed for that one reason
// (ADR-0151).
//
// Setting the preference — rather than clicking Skip in a `beforeEach` — is what a
// returning user's state actually is, it costs one request for the whole suite instead
// of one interaction per test, and it cannot itself flake on the overlay's animation.
//
// What this deliberately stops covering: the first-run experience. A spec asserting the
// tour opens would have to flip this same global preference mid-run, and Playwright runs
// spec *files* in parallel, so it would race every other file into the failure it was
// written to prevent. The tour's own logic is unit-tested
// (`src/components/tour/__tests__`); what is not covered anywhere is "the overlay does
// not block the app underneath it", which is the defect that happened. Fixing that
// properly means the tour not being a full-page click sink, not a serialised E2E run.
export default async function globalSetup() {
  const ctx = await request.newContext()
  try {
    const resp = await ctx.put(`${API}/api/settings/preferences/tour-state`, {
      data: { value: { seen: true, at: new Date().toISOString() } },
    })
    if (!resp.ok()) {
      // Loud, not fatal: if this ever stops working the suite should still run and fail
      // on the real symptom rather than on a silent setup step.
      console.error(`global-setup: could not suppress the tour (${resp.status()}) — expect click timeouts`)
    }
  } finally {
    await ctx.dispose()
  }
}
