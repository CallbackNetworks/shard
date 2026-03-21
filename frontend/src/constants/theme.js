export const BRAND = '#5e6ad2'

export const STATUS_COLS = [
  { key: 'todo',        label: 'Todo',        color: '#94a3b8' },
  { key: 'in_progress', label: 'In Progress', color: '#3b82f6' },
  { key: 'done',        label: 'Done',        color: '#22c55e' },
  { key: 'failed',      label: 'Failed',      color: '#ef4444' },
]

export const STATUS_MAP = Object.fromEntries(STATUS_COLS.map(s => [s.key, s]))

export const PRIORITY = {
  high:   { label: 'High',   color: '#ef4444', bg: '#fef2f2', icon: '▲' },
  medium: { label: 'Medium', color: '#f59e0b', bg: '#fffbeb', icon: '■' },
  low:    { label: 'Low',    color: '#94a3b8', bg: '#f8fafc', icon: '▼' },
}

export const LABEL_PALETTE = [
  '#5e6ad2', '#22c55e', '#ef4444', '#f59e0b', '#3b82f6',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316',
]
