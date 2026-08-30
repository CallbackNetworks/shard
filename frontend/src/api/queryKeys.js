/**
 * The one place a React Query cache key is spelled.
 *
 * There were 61 distinct key names across 289 sites, every one an inline array
 * literal. That is fine until it is not: `['projects']` appeared in ten files and
 * `['project', id]` in another six, so a typo produces a *second cache entry* rather
 * than an error — the query runs, returns data, and simply never shares or
 * invalidates with the one the rest of the app is using. Nothing fails; a screen just
 * stops updating. `Analytics.jsx` also set a different `staleTime` on `['projects']`
 * than the nine other consumers, which is the same divergence one step further along.
 *
 * Every entry takes rest arguments and drops trailing `undefined`, so `qk.goals()` is
 * `['goals']` and `qk.goals('active')` is `['goals', 'active']`. That is deliberate
 * rather than lax: React Query matches keys by prefix, so invalidating `qk.goals()`
 * already invalidates every `qk.goals(x)`, and a factory that demanded the argument
 * would make the broad invalidation impossible to express.
 *
 * `src/__tests__/queryKeys.test.js` fails on a raw `queryKey: ['...']` literal
 * anywhere in the app, so a 62nd key has to arrive here.
 */

const key = (name) => (...args) => [name, ...args.filter((a) => a !== undefined)]

export const qk = {
  activity: key('activity'),
  activityWatches: key('activity-watches'),
  agentActivity: key('agent-activity'),
  agentSummary: key('agent-summary'),
  allDeliveries: key('all-deliveries'),
  analyticsBurndown: key('analytics-burndown'),
  analyticsCalibration: key('analytics-calibration'),
  analyticsHeatmap: key('analytics-heatmap'),
  analyticsOverview: key('analytics-overview'),
  analyticsTrend: key('analytics-trend'),
  analyticsVelocity: key('analytics-velocity'),
  ancestry: key('ancestry'),
  apiKeys: key('api-keys'),
  assistantConv: key('assistant-conv'),
  assistantConversations: key('assistant-conversations'),
  backupStatus: key('backup-status'),
  comments: key('comments'),
  containedTasks: key('contained-tasks'),
  containerSubtree: key('container-subtree'),
  cyclesAll: key('cycles-all'),
  decisions: key('decisions'),
  deliveries: key('deliveries'),
  edgeTypes: key('edge-types'),
  focusTargets: key('focus-targets'),
  globalActivityTicker: key('global-activity-ticker'),
  goals: key('goals'),
  governingDecisions: key('governing-decisions'),
  graphMap: key('graph-map'),
  icalToken: key('ical-token'),
  identities: key('identities'),
  identityHubStats: key('identity-hub-stats'),
  integrationEvents: key('integration-events'),
  integrationHealth: key('integration-health'),
  integrationSources: key('integration-sources'),
  integrationTemplate: key('integration-template'),
  integrationTemplates: key('integration-templates'),
  integrations: key('integrations'),
  fieldVocabulary: key('field-vocabulary'),
  node: key('node'),
  nodeEdges: key('node-edges'),
  nodeEvents: key('node-events'),
  nodeSearch: key('node-search'),
  nodeShareChatLog: key('node-share-chat-log'),
  nodeShareViews: key('node-share-views'),
  nodeTypes: key('node-types'),
  nodes: key('nodes'),
  notificationCount: key('notification-count'),
  notifications: key('notifications'),
  paletteNodes: key('palette-nodes'),
  paletteSearch: key('palette-search'),
  preference: key('preference'),
  project: key('project'),
  projects: key('projects'),
  ruleSubjectSearch: key('rule-subject-search'),
  savedFilters: key('saved-filters'),
  settings: key('settings'),
  share: key('share'),
  templates: key('templates'),
  unfiledTasks: key('unfiled-tasks'),
  webhookConfig: key('webhook-config'),
  webhookEvents: key('webhook-events'),
  workflowRuleVocabulary: key('workflow-rule-vocabulary'),
  workflowRules: key('workflow-rules'),
}
