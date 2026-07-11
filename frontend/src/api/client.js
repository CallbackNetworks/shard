import axios from 'axios'
import { globalAddToast } from '../context/ToastContext'

const api = axios.create({ baseURL: '' })

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

// Helper to mark background requests (used by React Query refetch)
export const markBackground = (config) => ({ ...config, _isBackgroundRefetch: true })

// Projects
export const getProjects = () => api.get('/projects').then(r => r.data)
export const createProject = (data) => api.post('/projects', data).then(r => r.data)
export const updateProject = (id, data) => api.patch(`/projects/${id}`, data).then(r => r.data)
export const deleteProject = (id) => api.delete(`/projects/${id}`)
export const getProject = (id) => api.get(`/projects/${id}`).then(r => r.data)
export const getIcalToken = () => api.get('/settings/ical-token').then(r => r.data)
export const rotateGlobalIcalToken = () => api.post('/settings/ical-token/rotate').then(r => r.data)

// Tasks
export const getTasks = (projectId) => api.get(`/projects/${projectId}/tasks`).then(r => r.data)
export const createTask = (projectId, data) => api.post(`/projects/${projectId}/tasks`, data).then(r => r.data)
export const updateTask = (projectId, taskId, data) => api.patch(`/projects/${projectId}/tasks/${taskId}`, data).then(r => r.data)
export const deleteTask = (projectId, taskId) => api.delete(`/projects/${projectId}/tasks/${taskId}`)
export const createExternalIssue = (projectId, taskId, provider) => api.post(`/projects/${projectId}/tasks/${taskId}/create-external-issue`, provider ? { provider } : {}).then(r => r.data)
export const regenerateToken = (projectId, taskId) => api.post(`/projects/${projectId}/tasks/${taskId}/regenerate-token`).then(r => r.data)
export const reorderTasks = (projectId, taskIds) => api.post(`/projects/${projectId}/tasks/reorder`, { task_ids: taskIds })

// Labels
export const getLabels = (projectId) => api.get(`/projects/${projectId}/labels`).then(r => r.data)
export const createLabel = (projectId, data) => api.post(`/projects/${projectId}/labels`, data).then(r => r.data)
export const updateLabel = (projectId, labelId, data) => api.patch(`/projects/${projectId}/labels/${labelId}`, data).then(r => r.data)
export const deleteLabel = (projectId, labelId) => api.delete(`/projects/${projectId}/labels/${labelId}`)
export const addLabelToTask = (projectId, taskId, labelId) =>
  api.post(`/projects/${projectId}/tasks/${taskId}/labels/${labelId}`).then(r => r.data)
export const removeLabelFromTask = (projectId, taskId, labelId) =>
  api.delete(`/projects/${projectId}/tasks/${taskId}/labels/${labelId}`)

// Cycles
export const getCycles = (projectId) => api.get(`/projects/${projectId}/cycles`).then(r => r.data)
export const createCycle = (projectId, data) => api.post(`/projects/${projectId}/cycles`, data).then(r => r.data)
export const updateCycle = (projectId, cycleId, data) => api.patch(`/projects/${projectId}/cycles/${cycleId}`, data).then(r => r.data)
export const deleteCycle = (projectId, cycleId) => api.delete(`/projects/${projectId}/cycles/${cycleId}`)
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

// Identities
export const getIdentities = () => api.get('/identities').then(r => r.data)
export const createIdentity = (data) => api.post('/identities', data).then(r => r.data)
export const updateIdentity = (id, data) => api.patch(`/identities/${id}`, data).then(r => r.data)
export const deleteIdentity = (id) => api.delete(`/identities/${id}`)
export const getIdentityProjects = (identityId) => api.get(`/identities/${identityId}/projects`).then(r => r.data)
export const linkProjectIdentity = (identityId, projectId) => api.post(`/identities/${identityId}/projects/${projectId}`).then(r => r.data)
export const unlinkProjectIdentity = (identityId, projectId) => api.delete(`/identities/${identityId}/projects/${projectId}`)
export const getIdentityHubStats = () => api.get('/identities/hub-stats').then(r => r.data)

// Activity
export const getActivity = (params = {}) => api.get('/activity', { params }).then(r => r.data)

// Comments
export const getComments = (projectId, taskId) =>
  api.get(`/projects/${projectId}/tasks/${taskId}/comments`).then(r => r.data)
export const createComment = (projectId, taskId, data) =>
  api.post(`/projects/${projectId}/tasks/${taskId}/comments`, data).then(r => r.data)
export const updateComment = (projectId, taskId, commentId, data) =>
  api.patch(`/projects/${projectId}/tasks/${taskId}/comments/${commentId}`, data).then(r => r.data)
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
export const testWorkflowRule = (ruleId, taskId) =>
  api.post(`/workflow-rules/${ruleId}/test`, null, { params: { task_id: taskId } }).then(r => r.data)

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
export const getDelivery = (deliveryId) =>
  api.get(`/deliveries/${deliveryId}`).then(r => r.data)
export const retryDelivery = (deliveryId) =>
  api.post(`/deliveries/${deliveryId}/retry`).then(r => r.data)
export const purgeDeliveries = (olderThanDays = 30) =>
  api.delete('/deliveries', { params: { older_than_days: olderThanDays } })
export const bulkRetryDeliveries = (integrationId) =>
  api.post(`/integrations/${integrationId}/retry-all`).then(r => r.data)
export const getIntegrationHealth = (integrationId) =>
  api.get(`/integrations/${integrationId}/health`).then(r => r.data)

// Integration templates
export const getIntegrationTemplates = () =>
  api.get('/integrations/templates').then(r => r.data)
export const getIntegrationTemplate = (templateId) =>
  api.get(`/integrations/templates/${templateId}`).then(r => r.data)

// Webhook events (build history)
export const getWebhookEvents = (taskId, params = {}) =>
  api.get(`/webhook/events/${taskId}`, { params }).then(r => r.data)

// CI/CD pipeline triggers
export const triggerGitHubWorkflow = (data) => api.post('/cicd/trigger/github', data).then(r => r.data)
export const triggerGitLabPipeline = (data) => api.post('/cicd/trigger/gitlab', data).then(r => r.data)
export const triggerJenkinsBuild = (data) => api.post('/cicd/trigger/jenkins', data).then(r => r.data)
export const triggerGenericPipeline = (data) => api.post('/cicd/trigger/generic', data).then(r => r.data)

// Recurrence
export const getRecurrence = (projectId, taskId) =>
  api.get(`/projects/${projectId}/tasks/${taskId}/recurrence`).then(r => r.data)
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
export const getDecision = (id) => api.get(`/decisions/${id}`).then(r => r.data)
export const exportDecision = (id) => api.get(`/decisions/${id}/export`).then(r => r.data)

// Goals
export const getGoals = (params = {}) => api.get('/goals', { params }).then(r => r.data)
export const getGoal = (id) => api.get(`/goals/${id}`).then(r => r.data)
export const createGoal = (data) => api.post('/goals', data).then(r => r.data)
export const updateGoal = (id, data) => api.patch(`/goals/${id}`, data).then(r => r.data)
export const deleteGoal = (id) => api.delete(`/goals/${id}`)

// Saved Filters
export const getSavedFilters = (projectId) =>
  api.get('/saved-filters', { params: projectId ? { project_id: projectId } : {} }).then(r => r.data)
export const createSavedFilter = (data) => api.post('/saved-filters', data).then(r => r.data)
export const updateSavedFilter = (id, data) => api.patch(`/saved-filters/${id}`, data).then(r => r.data)
export const deleteSavedFilter = (id) => api.delete(`/saved-filters/${id}`)

// Bulk Operations
export const bulkUpdateTasks = (projectId, data) =>
  api.post(`/projects/${projectId}/tasks/bulk-update`, data).then(r => r.data)

// Import / Export
export const exportTasks = (projectId, format = 'json') =>
  api.get(`/projects/${projectId}/tasks/export`, { params: { format } }).then(r => r.data)
export const exportTasksCsv = (projectId) =>
  api.get(`/projects/${projectId}/tasks/export`, { params: { format: 'csv' }, responseType: 'blob' })
export const importTasks = (projectId, data) =>
  api.post(`/projects/${projectId}/tasks/import`, data).then(r => r.data)

// Settings
export const getSettings = () => api.get('/settings').then(r => r.data)
export const updateSystemSettings = (data) => api.put('/settings/system', data).then(r => r.data)
export const changePassword = (data) => api.post('/settings/change-password', data).then(r => r.data)
export const getDashboardWidgets = () => api.get('/settings/dashboard-widgets').then(r => r.data)
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
export const getAnalyticsVelocity = (projectId) => api.get('/analytics/velocity', { params: { project_id: projectId } }).then(r => r.data)
export const getAnalyticsStatusTrend = (projectId, days) => api.get('/analytics/status-trend', { params: { project_id: projectId, days } }).then(r => r.data)
export const getEstimationCalibration = (params = {}) => api.get('/analytics/estimation-calibration', { params }).then(r => r.data)

// Share (public, no auth — uses plain axios to avoid the auth interceptor)
export const getShareData = (token, scope = 'identity') =>
  axios.get(`/share/${scope}/${token}`, { withCredentials: true }).then(r => r.data)
export const postShareProjectNote = (scope, token, payload) =>
  axios.post(`/share/${scope}/${token}/notes`, payload, { withCredentials: true }).then(r => r.data)
export const postShareTaskNote = (scope, token, taskId, payload) =>
  axios.post(`/share/${scope}/${token}/tasks/${taskId}/notes`, payload, { withCredentials: true }).then(r => r.data)
export const rotateShareToken = (identityId) => api.post(`/identities/${identityId}/rotate-share-token`).then(r => r.data)

// Share PIN & expiry management (authenticated)
export const setSharePin = (identityId, pin) => api.post(`/identities/${identityId}/set-pin`, { pin }).then(r => r.data)
export const clearSharePin = (identityId) => api.delete(`/identities/${identityId}/pin`).then(r => r.data)
export const setShareExpiry = (identityId, expiresAt) => api.post(`/identities/${identityId}/set-expiry`, { expires_at: expiresAt }).then(r => r.data)
export const getShareViewCount = (identityId) => api.get(`/identities/${identityId}/share-views`).then(r => r.data)
export const setProjectShareExpiry = (projectId, expiresAt) => api.post(`/projects/${projectId}/set-expiry`, { expires_at: expiresAt }).then(r => r.data)
export const getProjectShareViewCount = (projectId) => api.get(`/projects/${projectId}/share-views`).then(r => r.data)
