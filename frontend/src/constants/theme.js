export const BRAND = '#ef4444'
export const BRAND_2 = '#dc2626'

export const SHADOW_SM = '0 1px 2px rgba(0,0,0,0.3)'
export const SHADOW_LG = '0 4px 12px rgba(0,0,0,0.4)'
export const INSET_SHADOW = 'inset 0 1px 2px rgba(0,0,0,0.2)'

export const DARK = {
  bg:        '#000000',
  bgAlt:     '#000000',
  surface:   '#111111',
  elevated:  '#1a1a1a',
  overlay:   '#222222',
  text:      '#ffffff',
  textMid:   '#9ca3af',
  textDim:   '#4b5563',
  textFaint: 'rgba(255,255,255,0.15)',
  border:    '#1f2937',
  borderMid: '#374151',
  borderStrong: '#4b5563',
  hover:     'rgba(255,255,255,0.05)',
  active:    'rgba(255,255,255,0.08)',
  danger:    '#ef4444',
  dangerBg:  'rgba(239,68,68,0.12)',
  warning:   '#f59e0b',
  warningBg: 'rgba(245,158,11,0.12)',
  success:   '#10b981',
  successBg: 'rgba(16,185,129,0.12)',
  info:      '#3b82f6',
  infoBg:    'rgba(59,130,246,0.12)',
}

export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
}

export const FONT = {
  family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  display: "'Bebas Neue', 'Impact', sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  xs: 10,
  sm: 11,
  md: 13,
  lg: 15,
  xl: 18,
  xxl: 24,
}

export const RADIUS = {
  sm: 0,
  md: 0,
  lg: 0,
  xl: 0,
  full: 0,
}

export const STATUS_COLS = [
  { key: 'todo',        label: 'Todo',        color: '#6b7280' },
  { key: 'in_progress', label: 'In Progress', color: '#3b82f6' },
  { key: 'done',        label: 'Done',        color: '#10b981' },
  { key: 'failed',      label: 'Failed',      color: '#ef4444' },
]

export const STATUS_MAP = Object.fromEntries(STATUS_COLS.map(s => [s.key, s]))

export const PRIORITY = {
  high:   { label: 'High',   color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '▲' },
  medium: { label: 'Medium', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '■' },
  low:    { label: 'Low',    color: '#6b7280', bg: 'rgba(107,114,128,0.12)', icon: '▼' },
}

export const LIGHT = {
  bg:        '#ffffff',
  bgAlt:     '#fafafa',
  surface:   '#ffffff',
  elevated:  '#f3f4f6',
  overlay:   '#e5e7eb',
  text:      '#000000',
  textMid:   '#4b5563',
  textDim:   '#9ca3af',
  textFaint: 'rgba(0,0,0,0.15)',
  border:    '#e5e7eb',
  borderMid: '#d1d5db',
  borderStrong: '#9ca3af',
  hover:     'rgba(0,0,0,0.03)',
  active:    'rgba(0,0,0,0.06)',
  danger:    '#dc2626',
  dangerBg:  'rgba(220,38,38,0.08)',
  warning:   '#d97706',
  warningBg: 'rgba(217,119,6,0.08)',
  success:   '#059669',
  successBg: 'rgba(5,150,105,0.08)',
  info:      '#2563eb',
  infoBg:    'rgba(37,99,235,0.08)',
}

export const FORM_INPUT = {
  background: '#111111',
  border: '1px solid #1f2937',
  borderRadius: 0,
  padding: '7px 10px',
  fontSize: 13,
  outline: 'none',
  color: '#ffffff',
  fontFamily: FONT.family,
}

export const LABEL_PALETTE = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#6b7280',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316',
]
