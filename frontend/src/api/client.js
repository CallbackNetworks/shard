import axios from 'axios'

const api = axios.create({ baseURL: '' })

api.interceptors.request.use(config => {
  const token = localStorage.getItem('auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(null, err => {
  if (err.response?.status === 401 && window.location.pathname !== '/' && window.location.pathname !== '/login') {
    localStorage.removeItem('auth_token')
    window.location.href = '/login'
  }
  return Promise.reject(err)
})

// Projects
export const getProjects = () => api.get('/projects').then(r => r.data)
export const createProject = (data) => api.post('/projects', data).then(r => r.data)
export const updateProject = (id, data) => api.patch(`/projects/${id}`, data).then(r => r.data)
export const deleteProject = (id) => api.delete(`/projects/${id}`)
export const getProject = (id) => api.get(`/projects/${id}`).then(r => r.data)

// Tasks
export const getTasks = (projectId) => api.get(`/projects/${projectId}/tasks`).then(r => r.data)
export const createTask = (projectId, data) => api.post(`/projects/${projectId}/tasks`, data).then(r => r.data)
export const updateTask = (projectId, taskId, data) => api.patch(`/projects/${projectId}/tasks/${taskId}`, data).then(r => r.data)
export const deleteTask = (projectId, taskId) => api.delete(`/projects/${projectId}/tasks/${taskId}`)
export const regenerateToken = (projectId, taskId) => api.post(`/projects/${projectId}/tasks/${taskId}/regenerate-token`).then(r => r.data)

// Labels
export const getLabels = (projectId) => api.get(`/projects/${projectId}/labels`).then(r => r.data)
export const createLabel = (projectId, data) => api.post(`/projects/${projectId}/labels`, data).then(r => r.data)
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

// Identities
export const getIdentities = () => api.get('/identities').then(r => r.data)
export const createIdentity = (data) => api.post('/identities', data).then(r => r.data)
export const updateIdentity = (id, data) => api.patch(`/identities/${id}`, data).then(r => r.data)
export const deleteIdentity = (id) => api.delete(`/identities/${id}`)
export const getIdentityProjects = (identityId) => api.get(`/identities/${identityId}/projects`).then(r => r.data)
export const linkProjectIdentity = (identityId, projectId) => api.post(`/identities/${identityId}/projects/${projectId}`).then(r => r.data)
export const unlinkProjectIdentity = (identityId, projectId) => api.delete(`/identities/${identityId}/projects/${projectId}`)

// Activity
export const getActivity = (params = {}) => api.get('/activity', { params }).then(r => r.data)
