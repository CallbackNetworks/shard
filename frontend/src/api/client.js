import axios from 'axios'

const api = axios.create({ baseURL: '' })

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

// Integrations
export const getIntegrations = () => api.get('/integrations').then(r => r.data)
export const createIntegration = (data) => api.post('/integrations', data).then(r => r.data)
export const updateIntegration = (id, data) => api.patch(`/integrations/${id}`, data).then(r => r.data)
export const deleteIntegration = (id) => api.delete(`/integrations/${id}`)
export const testIntegration = (id) => api.post(`/integrations/${id}/test`).then(r => r.data)
