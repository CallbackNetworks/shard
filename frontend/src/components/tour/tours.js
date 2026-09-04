/**
 * The guided tours, declared (ADR-0148 → ADR-0152).
 *
 * ADR-0148 shipped *one* tour, seven steps, all of them on `/`. Every other screen
 * in the product — the one you are on when you are confused about it — had nothing.
 * A tour of the front door is an introduction; it is not help, because help is a
 * thing you go looking for while standing somewhere specific.
 *
 * So a tour is now per page, and this file is the whole registry. A tour names a
 * route, and each step names a selector rather than a component: adding a step is a
 * data edit, and a step whose anchor has been removed skips itself rather than
 * breaking the page it was pointing at.
 *
 * `anchor` matches a `data-tour` attribute. Those attributes are the contract — they
 * exist so the tour never depends on a class name that a CSS-module rename would
 * silently invalidate, which is exactly the failure a tour cannot detect on its own
 * because "the highlight did not appear" looks like "the step was skipped".
 * `tests/tourSteps.test.js` is what turns that into a build failure.
 *
 * `placement` is a preference, not a promise: `TourOverlay` flips a bubble that would
 * land off-screen.
 *
 * `auto` marks the one tour that offers itself unasked, on a first visit to `/`.
 * Every other tour waits to be asked, from the launcher that sits on every page. A
 * product that starts explaining itself each time you open a new screen is not
 * teaching, it is interrupting — and the interruption arrives exactly when somebody
 * is finally moving quickly.
 *
 * `match` exists for the routes that carry an id. A project tour cannot declare
 * `/projects/abc123`, so it declares the shape instead and has no `route` to
 * navigate to: it is offered while you are already on one.
 */
export const TOURS = [
  {
    id: 'overview',
    route: '/',
    nameKey: 'tour.overview.name',
    auto: true,
    steps: [
      { id: 'rail', anchor: '[data-tour="rail"]', placement: 'right' },
      { id: 'search', anchor: '[data-tour="search"]', placement: 'right' },
      { id: 'stats', anchor: '[data-tour="stat-cards"]', placement: 'bottom' },
      { id: 'lanes', anchor: '[data-tour="priority-wall"]', placement: 'top' },
      { id: 'signals', anchor: '[data-tour="ops-sidebar"]', placement: 'left' },
      { id: 'newProject', anchor: '[data-tour="new-project"]', placement: 'bottom' },
      { id: 'launcher', anchor: '[data-tour="page-tour"]', placement: 'top' },
      { id: 'guide', anchor: '[data-tour="guide"]', placement: 'right' },
    ],
  },
  {
    id: 'project',
    // No `route`: this one is offered on whichever project you are looking at.
    match: (p) => p.startsWith('/projects/'),
    nameKey: 'tour.project.name',
    steps: [
      { id: 'progress', anchor: '[data-tour="project-progress"]', placement: 'bottom' },
      { id: 'newIssue', anchor: '[data-tour="project-new-issue"]', placement: 'bottom' },
      { id: 'tabs', anchor: '[data-tour="project-tabs"]', placement: 'bottom' },
      { id: 'filters', anchor: '[data-tour="project-filters"]', placement: 'bottom' },
      { id: 'rows', anchor: '[data-tour="project-rows"]', placement: 'top' },
      { id: 'share', anchor: '[data-tour="project-share"]', placement: 'bottom' },
      { id: 'agent', anchor: '[data-tour="project-agent"]', placement: 'bottom' },
    ],
  },
  {
    id: 'analytics',
    route: '/analytics',
    nameKey: 'tour.analytics.name',
    steps: [
      { id: 'filters', anchor: '[data-tour="analytics-filters"]', placement: 'bottom' },
      { id: 'cards', anchor: '[data-tour="analytics-cards"]', placement: 'bottom' },
      { id: 'charts', anchor: '[data-tour="analytics-charts"]', placement: 'top' },
    ],
  },
  {
    id: 'structure',
    route: '/structure',
    nameKey: 'tour.structure.name',
    steps: [
      { id: 'style', anchor: '[data-tour="structure-style"]', placement: 'bottom' },
      { id: 'filters', anchor: '[data-tour="structure-filters"]', placement: 'bottom' },
      { id: 'stats', anchor: '[data-tour="structure-stats"]', placement: 'bottom' },
      { id: 'canvas', anchor: '[data-tour="structure-canvas"]', placement: 'top' },
    ],
  },
  {
    id: 'goals',
    route: '/goals',
    nameKey: 'tour.goals.name',
    steps: [
      { id: 'new', anchor: '[data-tour="goals-new"]', placement: 'bottom' },
      { id: 'tabs', anchor: '[data-tour="goals-tabs"]', placement: 'bottom' },
      { id: 'list', anchor: '[data-tour="goals-list"]', placement: 'top' },
    ],
  },
  {
    id: 'decisions',
    route: '/decisions',
    nameKey: 'tour.decisions.name',
    steps: [
      { id: 'new', anchor: '[data-tour="decisions-new"]', placement: 'bottom' },
      { id: 'mode', anchor: '[data-tour="decisions-mode"]', placement: 'bottom' },
      { id: 'console', anchor: '[data-tour="decisions-console"]', placement: 'right' },
      { id: 'groups', anchor: '[data-tour="decisions-groups"]', placement: 'top' },
    ],
  },
  {
    id: 'templates',
    route: '/templates',
    nameKey: 'tour.templates.name',
    steps: [
      { id: 'new', anchor: '[data-tour="templates-new"]', placement: 'bottom' },
      { id: 'list', anchor: '[data-tour="templates-list"]', placement: 'top' },
    ],
  },
  {
    id: 'assistant',
    route: '/assistant',
    nameKey: 'tour.assistant.name',
    steps: [
      { id: 'conversations', anchor: '[data-tour="assistant-rail"]', placement: 'right' },
      { id: 'prompts', anchor: '[data-tour="assistant-stage"]', placement: 'top' },
    ],
  },
  {
    id: 'activity',
    route: '/activity',
    nameKey: 'tour.activity.name',
    steps: [
      { id: 'console', anchor: '[data-tour="activity-console"]', placement: 'right' },
      { id: 'views', anchor: '[data-tour="activity-views"]', placement: 'bottom' },
      { id: 'feed', anchor: '[data-tour="activity-feed"]', placement: 'top' },
    ],
  },
  {
    id: 'integrations',
    route: '/integrations',
    nameKey: 'tour.integrations.name',
    steps: [
      { id: 'new', anchor: '[data-tour="integrations-new"]', placement: 'bottom' },
      { id: 'list', anchor: '[data-tour="integrations-list"]', placement: 'top' },
    ],
  },
  {
    id: 'rules',
    route: '/workflow-rules',
    nameKey: 'tour.rules.name',
    steps: [
      { id: 'new', anchor: '[data-tour="rules-new"]', placement: 'bottom' },
      { id: 'list', anchor: '[data-tour="rules-list"]', placement: 'top' },
    ],
  },
  {
    id: 'webhookLogs',
    route: '/webhook-logs',
    nameKey: 'tour.webhookLogs.name',
    steps: [
      { id: 'filters', anchor: '[data-tour="logs-filters"]', placement: 'bottom' },
      { id: 'table', anchor: '[data-tour="logs-table"]', placement: 'top' },
    ],
  },
  {
    id: 'apiKeys',
    route: '/api-keys',
    nameKey: 'tour.apiKeys.name',
    steps: [
      { id: 'new', anchor: '[data-tour="keys-new"]', placement: 'bottom' },
      { id: 'list', anchor: '[data-tour="keys-list"]', placement: 'top' },
    ],
  },
  {
    id: 'identities',
    route: '/identities',
    nameKey: 'tour.identities.name',
    steps: [
      { id: 'new', anchor: '[data-tour="identities-new"]', placement: 'bottom' },
      { id: 'list', anchor: '[data-tour="identities-list"]', placement: 'top' },
      { id: 'focus', anchor: '[data-tour="focus"]', placement: 'right' },
    ],
  },
  {
    id: 'explorer',
    route: '/explorer',
    nameKey: 'tour.explorer.name',
    steps: [
      { id: 'types', anchor: '[data-tour="explorer-types"]', placement: 'right' },
      { id: 'loose', anchor: '[data-tour="explorer-loose"]', placement: 'right' },
      { id: 'search', anchor: '[data-tour="explorer-search"]', placement: 'bottom' },
      { id: 'detail', anchor: '[data-tour="explorer-detail"]', placement: 'left' },
    ],
  },
  {
    id: 'graphTypes',
    route: '/graph-types',
    nameKey: 'tour.graphTypes.name',
    steps: [
      { id: 'nodes', anchor: '[data-tour="types-nodes"]', placement: 'bottom' },
      { id: 'edges', anchor: '[data-tour="types-edges"]', placement: 'top' },
    ],
  },
  {
    id: 'settings',
    route: '/settings',
    nameKey: 'tour.settings.name',
    steps: [
      { id: 'preferences', anchor: '[data-tour="settings-preferences"]', placement: 'bottom' },
      { id: 'modules', anchor: '[data-tour="settings-modules"]', placement: 'bottom' },
      { id: 'calendar', anchor: '[data-tour="settings-calendar"]', placement: 'top' },
      { id: 'backup', anchor: '[data-tour="settings-backup"]', placement: 'top' },
      { id: 'llm', anchor: '[data-tour="settings-llm"]', placement: 'top' },
    ],
  },
  {
    id: 'guide',
    route: '/guide',
    nameKey: 'tour.guide.name',
    steps: [
      { id: 'chapters', anchor: '[data-tour="guide-chapters"]', placement: 'right' },
      { id: 'tours', anchor: '[data-tour="guide-tours"]', placement: 'right' },
      { id: 'content', anchor: '[data-tour="guide-content"]', placement: 'left' },
    ],
  },
]

/**
 * A step's copy keys are derived, not declared.
 *
 * The alternative — writing `titleKey: 'tour.overview.rail.title'` beside
 * `id: 'rail'` inside the tour with `id: 'overview'` — states the same fact three
 * times, and the failure when they disagree is a bubble with a translation key in
 * it. The one place a key is spelled out is `i18n/*.json`, which is where the guard
 * test looks.
 */
export function stepKeys(tour, step) {
  return {
    titleKey: `tour.${tour.id}.${step.id}.title`,
    bodyKey: `tour.${tour.id}.${step.id}.body`,
  }
}

/** The tour that belongs to a path, or null. `match` first, then the exact route. */
export function tourForPath(pathname) {
  return (
    TOURS.find(tr => tr.match?.(pathname)) ||
    TOURS.find(tr => tr.route === pathname) ||
    null
  )
}

export function tourById(id) {
  return TOURS.find(tr => tr.id === id) || null
}

/** The tours the guide can offer as a list — the ones it can navigate to. */
export const LINKABLE_TOURS = TOURS.filter(tr => tr.route)
