import axios from 'axios'
import { globalAddToast } from '../context/ToastContext'

// Internal API is namespaced under /api (ADR-0036) so backend paths never collide
// with SPA page routes. Public share calls below use plain axios and stay at root.
const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use(config => {
  const token = localStorage.getItem('auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/**
 * Parse Pydantic 422 validation errors into a readable message.
 */
export function parse422(err) {
  const detail = err.response?.data?.detail
  if (!Array.isArray(detail)) {
    if (typeof detail === 'string') return detail
    return err.response?.data?.message || err.message || 'Validation error'
  }
  return detail
    .map(d => {
      const field = (d.loc || []).filter(l => l !== 'body').join('.')
      return field ? `${field}: ${d.msg}` : d.msg
    })
    .join('; ')
}

api.interceptors.response.use(null, err => {
  if (err.response?.status === 401 && window.location.pathname !== '/' && window.location.pathname !== '/login') {
    const isBackgroundRefetch = err.config?._isBackgroundRefetch
    if (!isBackgroundRefetch) {
      localStorage.removeItem('auth_token')
      window.location.href = '/login'
    }
  }
  // Show toast for 422 validation errors and 4xx/5xx server errors
  if (err.response && !err.config?._isBackgroundRefetch && !err.config?._silent) {
    const status = err.response.status
    if (status === 422) {
      globalAddToast(parse422(err), 'error')
    } else if (status >= 400 && status !== 401) {
      const msg = err.response.data?.detail || err.response.data?.message || `Error ${status}`
      globalAddToast(typeof msg === 'string' ? msg : JSON.stringify(msg), 'error')
    }
  }
  return Promise.reject(err)
})

// Projects — reads stay on /projects (enriched); writes go through the node surface
// (ADR-0043): a project is a container node. name -> title; the rest folds into data.
export const getProjects = () => api.get('/projects').then(r => r.data)
export const createProject = ({ name, status = 'active', ...rest }) =>
  createNode({ type: 'project', title: name, status, data: rest })
export const updateProject = (id, { name, status, ...rest }) =>
  updateNode(id, {
    ...(name !== undefined ? { title: name } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(Object.keys(rest).length ? { data: rest } : {}),
  })
export const deleteProject = (id) => deleteNode(id)
export const getProject = (id) => api.get(`/projects/${id}`).then(r => r.data)
export const getIcalToken = () => api.get('/settings/ical-token').then(r => r.data)
export const rotateGlobalIcalToken = () => api.post('/settings/ical-token/rotate').then(r => r.data)

// Tasks. Writes go through the single graph write surface /nodes (ADR-0040):
// container_id files the task under its project; parent_id (in data) nests a
// subtask; the response is the enriched TaskOut shape. Reads and sub-resources
// (reorder, memberships, external issue, ...) keep their dedicated routes.
export const createTask = (projectId, data) => api.post('/nodes', { type: 'task', container_id: projectId, ...data }).then(r => r.data)
export const updateTask = (projectId, taskId, data) => api.patch(`/nodes/${taskId}`, data).then(r => r.data)
export const deleteTask = (projectId, taskId) => api.delete(`/nodes/${taskId}`)
export const createExternalIssue = (projectId, taskId, provider) => api.post(`/projects/${projectId}/tasks/${taskId}/create-external-issue`, provider ? { provider } : {}).then(r => r.data)
export const regenerateToken = (projectId, taskId) => api.post(`/projects/${projectId}/tasks/${taskId}/regenerate-token`).then(r => r.data)
export const reorderTasks = (projectId, taskIds) => api.post(`/projects/${projectId}/tasks/reorder`, { task_ids: taskIds })
// Cross-project membership (ADR-0032): a task can belong to multiple projects via contains edges.
export const addTaskMembership = (projectId, taskId, targetProjectId) =>
  api.post(`/projects/${projectId}/tasks/${taskId}/memberships/${targetProjectId}`).then(r => r.data)
export const removeTaskMembership = (projectId, taskId, targetProjectId) =>
  api.delete(`/projects/${projectId}/tasks/${taskId}/memberships/${targetProjectId}`)

// Labels — reads/assignment stay on /projects; label entity writes go through the
// node surface (ADR-0043): a label is a container-scoped node (project contains label).
export const createLabel = (projectId, { name, ...rest }) =>
  createNode({ type: 'label', container_id: projectId, title: name, data: rest })
export const updateLabel = (projectId, labelId, { name, ...rest }) =>
  updateNode(labelId, {
    ...(name !== undefined ? { title: name } : {}),
    ...(Object.keys(rest).length ? { data: rest } : {}),
  })
export const deleteLabel = (projectId, labelId) => deleteNode(labelId)
export const addLabelToTask = (projectId, taskId, labelId) =>
  api.post(`/projects/${projectId}/tasks/${taskId}/labels/${labelId}`).then(r => r.data)

// Cycles — reads/linking/duplicate stay on /projects; cycle entity writes go through
// the node surface (ADR-0043): a cycle is a container-scoped node; end_date -> due_date.
export const getCycles = (projectId) => api.get(`/projects/${projectId}/cycles`).then(r => r.data)
export const createCycle = (projectId, { name, status = 'draft', start_date, end_date, ...rest }) =>
  createNode({
    type: 'cycle', container_id: projectId, title: name, status,
    ...(start_date !== undefined ? { start_date } : {}),
    ...(end_date !== undefined ? { due_date: end_date } : {}),
    data: rest,
  })
export const updateCycle = (projectId, cycleId, { name, status, start_date, end_date, ...rest }) =>
  updateNode(cycleId, {
    ...(name !== undefined ? { title: name } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(start_date !== undefined ? { start_date } : {}),
    ...(end_date !== undefined ? { due_date: end_date } : {}),
    ...(Object.keys(rest).length ? { data: rest } : {}),
  })
export const deleteCycle = (projectId, cycleId) => deleteNode(cycleId)
export const addTaskToCycle = (projectId, cycleId, taskId) =>
  api.post(`/projects/${projectId}/cycles/${cycleId}/tasks/${taskId}`).then(r => r.data)
export const removeTaskFromCycle = (projectId, cycleId, taskId) =>
  api.delete(`/projects/${projectId}/cycles/${cycleId}/tasks/${taskId}`)
export const duplicateCycle = (projectId, cycleId) =>
  api.post(`/projects/${projectId}/cycles/${cycleId}/duplicate`).then(r => r.data)
export const compareCycles = (projectId, cycleId, compareWithId) =>
  api.get(`/projects/${projectId}/cycles/${cycleId}/compare`, { params: { compare_with: compareWithId } }).then(r => r.data)

// Integrations
export const getIntegrations = () => api.get('/integrations').then(r => r.data)
export const createIntegration = (data) => api.post('/integrations', data).then(r => r.data)
export const updateIntegration = (id, data) => api.patch(`/integrations/${id}`, data).then(r => r.data)
export const deleteIntegration = (id) => api.delete(`/integrations/${id}`)
export const testIntegration = (id) => api.post(`/integrations/${id}/test`).then(r => r.data)

// API Keys
export const getApiKeys = () => api.get('/api-keys').then(r => r.data)
export const createApiKey = (data) => api.post('/api-keys', data).then(r => r.data)
export const updateApiKey = (id, data) => api.patch(`/api-keys/${id}`, data).then(r => r.data)
export const deleteApiKey = (id) => api.delete(`/api-keys/${id}`)
export const getAgentSummary = () => api.get('/api-keys/agents/summary').then(r => r.data)

// Identities — reads stay on /identities (enriched: project_count, share state,
// hub stats); writes go through the generic node/edge surface (ADR-0041 B). An
// identity is a shareable node; the write core seeds its share_token on create,
// and project links are `identity -> project` `member_of` edges.
export const getIdentities = () => api.get('/identities').then(r => r.data)
export const createIdentity = ({ name, ...rest }) => createNode({ type: 'identity', title: name, data: rest })
export const updateIdentity = (id, { name, ...rest }) => {
  const patch = {}
  if (name !== undefined) patch.title = name
  if (Object.keys(rest).length) patch.data = rest
  return updateNode(id, patch)
}
export const deleteIdentity = (id) => deleteNode(id)
export const linkProjectIdentity = (identityId, projectId) => attachNodeEdge(identityId, { target_id: projectId, rel_type: 'member_of' })
export const unlinkProjectIdentity = (identityId, projectId) => detachNodeEdge(identityId, projectId, 'member_of')
export const getIdentityHubStats = () => api.get('/identities/hub-stats').then(r => r.data)

// Activity
export const getActivity = (params = {}) => api.get('/activity', { params }).then(r => r.data)

// Comments
export const getComments = (projectId, taskId) =>
  api.get(`/projects/${projectId}/tasks/${taskId}/comments`).then(r => r.data)
export const createComment = (projectId, taskId, data) =>
  api.post(`/projects/${projectId}/tasks/${taskId}/comments`, data).then(r => r.data)
export const deleteComment = (projectId, taskId, commentId) =>
  api.delete(`/projects/${projectId}/tasks/${taskId}/comments/${commentId}`)

// Task dependencies
export const addDependency = (projectId, taskId, dependsOnId) =>
  api.post(`/projects/${projectId}/tasks/${taskId}/dependencies/${dependsOnId}`).then(r => r.data)
export const removeDependency = (projectId, taskId, dependsOnId) =>
  api.delete(`/projects/${projectId}/tasks/${taskId}/dependencies/${dependsOnId}`)

// Search
export const search = (q, projectId) =>
  api.get('/search', { params: { q, ...(projectId ? { project_id: projectId } : {}) } }).then(r => r.data)

// Workflow Rules
export const getWorkflowRules = (projectId) =>
  api.get('/workflow-rules', { params: projectId ? { project_id: projectId } : {} }).then(r => r.data)
export const createWorkflowRule = (data) => api.post('/workflow-rules', data).then(r => r.data)
export const updateWorkflowRule = (id, data) => api.patch(`/workflow-rules/${id}`, data).then(r => r.data)
export const deleteWorkflowRule = (id) => api.delete(`/workflow-rules/${id}`)
// Dry-run against any node, not only a task (ADR-0049/0054): the answer for a non-task
// subject — every task-only action skipped — is exactly what the user needs to see.
export const testWorkflowRule = (ruleId, nodeId) =>
  api.post(`/workflow-rules/${ruleId}/test`, null, { params: { node_id: nodeId } }).then(r => r.data)
// Triggers, condition fields/ops and action types, served by the engine so the UI keeps
// no copy of any of them (ADR-0048, ADR-0049)
export const getWorkflowRuleVocabulary = (projectId) =>
  api.get('/workflow-rules/vocabulary', { params: projectId ? { project_id: projectId } : {} }).then(r => r.data)

// Notifications
export const getNotifications = (params = {}) => api.get('/notifications', { params }).then(r => r.data)
export const getUnreadCount = () => api.get('/notifications/unread-count').then(r => r.data)
export const markNotificationRead = (id) => api.patch(`/notifications/${id}/read`).then(r => r.data)
export const markAllNotificationsRead = () => api.post('/notifications/mark-all-read')
export const dismissNotification = (id) => api.delete(`/notifications/${id}`)

// Webhook delivery logs
export const getAllDeliveries = (params = {}) =>
  api.get('/deliveries', { params }).then(r => r.data)
export const getDeliveries = (integrationId, params = {}) =>
  api.get(`/integrations/${integrationId}/deliveries`, { params }).then(r => r.data)
export const retryDelivery = (deliveryId) =>
  api.post(`/deliveries/${deliveryId}/retry`).then(r => r.data)
export const purgeDeliveries = (olderThanDays = 30) =>
  api.delete('/deliveries', { params: { older_than_days: olderThanDays } })
export const bulkRetryDeliveries = (integrationId) =>
  api.post(`/integrations/${integrationId}/retry-all`).then(r => r.data)
export const getIntegrationHealth = (integrationId) =>
  api.get(`/integrations/${integrationId}/health`).then(r => r.data)

// Subscribable event types, served by the notifier so the UI keeps no copy (ADR-0047)
export const getIntegrationEvents = () =>
  api.get('/integrations/events').then(r => r.data)

// Which causes an integration can narrow to (ADR-0048); empty selection means all.
export const getIntegrationSources = () =>
  api.get('/integrations/sources').then(r => r.data)

// Integration templates
export const getIntegrationTemplates = () =>
  api.get('/integrations/templates').then(r => r.data)
export const getIntegrationTemplate = (templateId) =>
  api.get(`/integrations/templates/${templateId}`).then(r => r.data)

// Webhook events (build history)
export const getWebhookEvents = (taskId, params = {}) =>
  api.get(`/webhook/events/${taskId}`, { params }).then(r => r.data)

// CI/CD pipeline triggers

// Recurrence
export const setRecurrence = (projectId, taskId, data) =>
  api.post(`/projects/${projectId}/tasks/${taskId}/recurrence`, data).then(r => r.data)
export const updateRecurrence = (projectId, taskId, data) =>
  api.patch(`/projects/${projectId}/tasks/${taskId}/recurrence`, data).then(r => r.data)
export const removeRecurrence = (projectId, taskId) =>
  api.delete(`/projects/${projectId}/tasks/${taskId}/recurrence`)

// Attachments
export const getAttachments = (projectId, taskId) =>
  api.get(`/projects/${projectId}/tasks/${taskId}/attachments`).then(r => r.data)
export const uploadAttachment = (projectId, taskId, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/projects/${projectId}/tasks/${taskId}/attachments`, form).then(r => r.data)
}
export const deleteAttachment = (projectId, taskId, attachmentId) =>
  api.delete(`/projects/${projectId}/tasks/${taskId}/attachments/${attachmentId}`)
export const getAttachmentUrl = (projectId, taskId, attachmentId) =>
  `/projects/${projectId}/tasks/${taskId}/attachments/${attachmentId}/download`

// Templates
export const getTemplates = (projectId) =>
  api.get('/templates', { params: projectId ? { project_id: projectId } : {} }).then(r => r.data)
export const createTemplate = (data) => api.post('/templates', data).then(r => r.data)
export const updateTemplate = (id, data) => api.patch(`/templates/${id}`, data).then(r => r.data)
export const deleteTemplate = (id) => api.delete(`/templates/${id}`)

// Decisions
export const getDecisions = (params = {}) => api.get('/decisions', { params }).then(r => r.data)
export const exportDecision = (id) => api.get(`/decisions/${id}/export`).then(r => r.data)

// Goals — reads stay on /goals (enriched: per-project breakdown + subtree progress);
// writes go through the generic node/edge surface (ADR-0041 step c). A goal is a
// container node, and its linked projects are `goal -> project` `contains` edges.
export const getGoals = (params = {}) => api.get('/goals', { params }).then(r => r.data)

// Current project links of a goal: outgoing `contains` edges whose target is a project.
const goalProjectIds = async (goalId) =>
  (await getNodeEdges(goalId))
    .filter(e => e.source_id === goalId && e.rel_type === 'contains' && e.target?.type === 'project')
    .map(e => e.target_id)

export const createGoal = async ({ title, description = null, target_date = null, project_ids = [] }) => {
  const node = await createNode({ type: 'goal', title, status: 'active', due_date: target_date, data: { description } })
  for (const pid of project_ids) await attachNodeEdge(node.id, { target_id: pid, rel_type: 'contains' })
  return node
}

export const updateGoal = async (id, { project_ids, target_date, description, ...rest }) => {
  const patch = { ...rest }
  if (target_date !== undefined) patch.due_date = target_date
  if (description !== undefined) patch.data = { description }
  const node = Object.keys(patch).length ? await updateNode(id, patch) : null
  if (project_ids !== undefined) {
    // Reconcile the goal -> project `contains` edges to match the requested set,
    // leaving any tasks the goal holds directly untouched.
    const current = await goalProjectIds(id)
    const next = new Set(project_ids)
    const currentSet = new Set(current)
    for (const pid of current) if (!next.has(pid)) await detachNodeEdge(id, pid, 'contains')
    for (const pid of project_ids) if (!currentSet.has(pid)) await attachNodeEdge(id, { target_id: pid, rel_type: 'contains' })
  }
  return node
}

export const deleteGoal = (id) => deleteNode(id)

// Saved Filters
export const getSavedFilters = (projectId) =>
  api.get('/saved-filters', { params: projectId ? { project_id: projectId } : {} }).then(r => r.data)
export const createSavedFilter = (data) => api.post('/saved-filters', data).then(r => r.data)

// Bulk Operations
export const bulkUpdateTasks = (projectId, data) =>
  api.post(`/projects/${projectId}/tasks/bulk-update`, data).then(r => r.data)

// Import / Export
export const exportTasks = (projectId, format = 'json') =>
  api.get(`/projects/${projectId}/tasks/export`, { params: { format } }).then(r => r.data)
export const importTasks = (projectId, data) =>
  api.post(`/projects/${projectId}/tasks/import`, data).then(r => r.data)

// Settings
export const getSettings = () => api.get('/settings').then(r => r.data)
export const updateSystemSettings = (data) => api.put('/settings/system', data).then(r => r.data)
export const changePassword = (data) => api.post('/settings/change-password', data).then(r => r.data)
export const getPreference = (key) => api.get(`/settings/preferences/${key}`).then(r => r.data)
export const setPreference = (key, value) => api.put(`/settings/preferences/${key}`, { value }).then(r => r.data)

// Backup
export const getBackupStatus = () => api.get('/backup/status').then(r => r.data)
export const runBackup = () => api.post('/backup/run').then(r => r.data)
export const exportBackup = () => api.get('/backup/export', { responseType: 'blob' })
export const downloadBackupFile = (filename) => api.get(`/backup/download/${filename}`, { responseType: 'blob' })
export const restoreBackupFile = (file) => {
  const form = new FormData()
  form.append('file', file)
  form.append('confirm', 'replace')
  return api.post('/backup/restore', form).then(r => r.data)
}
export const restoreServerBackup = (filename) => {
  const form = new FormData()
  form.append('confirm', 'replace')
  return api.post(`/backup/restore/${filename}`, form).then(r => r.data)
}

// Analytics
export const getAnalyticsOverview = () => api.get('/analytics/overview').then(r => r.data)
export const getAnalyticsHeatmap = (params = {}) => api.get('/analytics/heatmap', { params }).then(r => r.data)
export const getAnalyticsBurndown = (cycleId) => api.get('/analytics/burndown', { params: { cycle_id: cycleId } }).then(r => r.data)
export const getCycleBurndown = (cycleId) => api.get('/analytics/cycle-burndown', { params: { cycle_id: cycleId } }).then(r => r.data)
export const getAnalyticsVelocity = (projectId) => api.get('/analytics/velocity', { params: { project_id: projectId } }).then(r => r.data)
export const getAnalyticsStatusTrend = (projectId, days) => api.get('/analytics/status-trend', { params: { project_id: projectId, days } }).then(r => r.data)
export const getEstimationCalibration = (params = {}) => api.get('/analytics/estimation-calibration', { params }).then(r => r.data)
export const getEstimateSuggestion = (rawEstimate, projectId) => api.get('/analytics/estimate-suggestion', { params: { raw_estimate: rawEstimate, project_id: projectId } }).then(r => r.data)

// Share (public, no auth — uses plain axios to avoid the auth interceptor)
export const getShareData = (token, scope = 'identity') =>
  axios.get(`/share/${scope}/${token}`, { withCredentials: true }).then(r => r.data)
export const postShareProjectNote = (scope, token, payload) =>
  axios.post(`/share/${scope}/${token}/notes`, payload, { withCredentials: true }).then(r => r.data)
export const postShareTaskNote = (scope, token, taskId, payload) =>
  axios.post(`/share/${scope}/${token}/tasks/${taskId}/notes`, payload, { withCredentials: true }).then(r => r.data)
// Identity share facade → generic shareable-node endpoints (ADR-0041 B).
export const rotateShareToken = (identityId) => api.post(`/nodes/${identityId}/share/rotate-token`).then(r => r.data)

// Share PIN & expiry management (authenticated)
export const setSharePin = (identityId, pin) => api.post(`/nodes/${identityId}/share/set-pin`, { pin }).then(r => r.data)
export const clearSharePin = (identityId) => api.delete(`/nodes/${identityId}/share/pin`).then(r => r.data)
export const setShareExpiry = (identityId, expiresAt) => api.post(`/nodes/${identityId}/share/set-expiry`, { expires_at: expiresAt }).then(r => r.data)
export const getShareViewCount = (identityId) => api.get(`/identities/${identityId}/share-views`).then(r => r.data)
export const setProjectShareExpiry = (projectId, expiresAt) => api.post(`/projects/${projectId}/set-expiry`, { expires_at: expiresAt }).then(r => r.data)
export const getProjectShareViewCount = (projectId) => api.get(`/projects/${projectId}/share-views`).then(r => r.data)

// Graph type registries (ADR-0033)
export const getNodeTypes = () => api.get('/graph-types/nodes').then(r => r.data)
export const createNodeType = (data) => api.post('/graph-types/nodes', data).then(r => r.data)
export const updateNodeType = (key, data) => api.patch(`/graph-types/nodes/${key}`, data).then(r => r.data)
export const deleteNodeType = (key) => api.delete(`/graph-types/nodes/${key}`)

// Generic node share facade (ADR-0039)
export const rotateNodeShareToken = (id) => api.post(`/nodes/${id}/share/rotate-token`).then(r => r.data)
export const setNodeSharePin = (id, pin) => api.post(`/nodes/${id}/share/set-pin`, { pin }).then(r => r.data)
export const clearNodeSharePin = (id) => api.delete(`/nodes/${id}/share/pin`).then(r => r.data)
export const setNodeShareExpiry = (id, expires_at) => api.post(`/nodes/${id}/share/set-expiry`, { expires_at }).then(r => r.data)
export const getEdgeTypes = () => api.get('/graph-types/edges').then(r => r.data)
export const createEdgeType = (data) => api.post('/graph-types/edges', data).then(r => r.data)
export const deleteEdgeType = (key) => api.delete(`/graph-types/edges/${key}`)

// Generic graph nodes (ADR-0033)
export const getNodes = (type, query) => {
  const params = {}
  if (type) params.type = type
  if (query) params.query = query
  return api.get('/nodes', { params }).then(r => r.data)
}
export const getNode = (id) => api.get(`/nodes/${id}`).then(r => r.data)
export const getNodeEvents = (id) => api.get(`/nodes/${id}/events`).then(r => r.data)
export const getContainedTasks = (id) => api.get(`/nodes/${id}/contained-tasks`).then(r => r.data)
export const getGraphMap = ({ types, includeData } = {}) => {
  const params = {}
  if (types?.length) params.types = types.join(',')
  if (includeData) params.include = 'data'
  return api.get('/graph/map', { params }).then(r => r.data)
}
export const createNode = (data) => api.post('/nodes', data).then(r => r.data)
export const updateNode = (id, data) => api.patch(`/nodes/${id}`, data).then(r => r.data)
export const deleteNode = (id) => api.delete(`/nodes/${id}`)
export const getNodeEdges = (id) => api.get(`/nodes/${id}/edges`).then(r => r.data)
export const attachNodeEdge = (id, data) => api.post(`/nodes/${id}/edges`, data).then(r => r.data)
export const detachNodeEdge = (id, targetId, relType) =>
  api.delete(`/nodes/${id}/edges`, { params: { target_id: targetId, rel_type: relType } })

// Unfiled tasks (zero project membership; ADR-0032/0033)
export const getUnfiledTasks = () => api.get('/tasks/unfiled').then(r => r.data)
export const fileTaskIntoProject = (taskId, projectId) => api.post(`/tasks/${taskId}/memberships/${projectId}`).then(r => r.data)
