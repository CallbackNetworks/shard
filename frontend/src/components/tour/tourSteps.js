/**
 * The guided tour, declared (ADR-0148).
 *
 * A step names a route and a selector, never a component. That is the difference
 * between a tour and a second implementation of the app: adding a step is a data
 * edit, and a step whose anchor has been removed skips itself rather than breaking
 * the page it was pointing at.
 *
 * `anchor` matches a `data-tour` attribute. Those attributes are the contract —
 * they exist so the tour never depends on a class name that a CSS-module rename
 * would silently invalidate, which is exactly the failure a tour cannot detect on
 * its own because "the highlight did not appear" looks like "the step was skipped".
 *
 * `placement` is a preference, not a promise: `TourOverlay` flips a bubble that
 * would land off-screen. `route` is where the step lives; the tour navigates there
 * and waits for the anchor before drawing anything.
 */
export const TOUR_STEPS = [
  {
    id: 'rail',
    route: '/',
    anchor: '[data-tour="rail"]',
    titleKey: 'tour.rail.title',
    bodyKey: 'tour.rail.body',
    placement: 'right',
  },
  {
    id: 'stats',
    route: '/',
    anchor: '[data-tour="stat-cards"]',
    titleKey: 'tour.stats.title',
    bodyKey: 'tour.stats.body',
    placement: 'bottom',
  },
  {
    id: 'lanes',
    route: '/',
    anchor: '[data-tour="priority-wall"]',
    titleKey: 'tour.lanes.title',
    bodyKey: 'tour.lanes.body',
    placement: 'top',
  },
  {
    id: 'signals',
    route: '/',
    anchor: '[data-tour="ops-sidebar"]',
    titleKey: 'tour.signals.title',
    bodyKey: 'tour.signals.body',
    placement: 'left',
  },
  {
    id: 'newProject',
    route: '/',
    anchor: '[data-tour="new-project"]',
    titleKey: 'tour.newProject.title',
    bodyKey: 'tour.newProject.body',
    placement: 'bottom',
  },
  {
    id: 'search',
    route: '/',
    anchor: '[data-tour="search"]',
    titleKey: 'tour.search.title',
    bodyKey: 'tour.search.body',
    placement: 'right',
  },
  {
    id: 'guide',
    route: '/',
    anchor: '[data-tour="guide"]',
    titleKey: 'tour.guide.title',
    bodyKey: 'tour.guide.body',
    placement: 'right',
  },
]
