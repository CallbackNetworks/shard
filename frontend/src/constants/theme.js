// ── Brand colors ──
export const BRAND = '#00f0ff'
export const BRAND_2 = '#00c8d6'

// ── Shadows ──
export const SHADOW_SM = '0 0 8px rgba(0,240,255,0.15), 0 0 2px rgba(0,240,255,0.3)'
export const SHADOW_LG = '0 0 20px rgba(0,240,255,0.12), 0 0 4px rgba(0,240,255,0.25)'
export const INSET_SHADOW = 'inset 0 0 8px rgba(0,240,255,0.06), 0 0 1px rgba(0,240,255,0.3)'

// ── Color palette ──
export const DARK = {
  bg:        '#0a0c10',
  bgAlt:     '#0d0f14',
  surface:   '#111318',
  elevated:  '#161920',
  overlay:   '#1c1f28',
  text:      '#e0e6f0',
  textMid:   '#7a8599',
  textDim:   '#3d4556',
  textFaint: 'rgba(224,230,240,0.15)',
  border:    'rgba(0,240,255,0.12)',
  borderMid: 'rgba(0,240,255,0.2)',
  borderStrong: 'rgba(0,240,255,0.35)',
  hover:     'rgba(0,240,255,0.06)',
  active:    'rgba(0,240,255,0.1)',
  danger:    '#ff2d55',
  dangerBg:  'rgba(255,45,85,0.12)',
  warning:   '#ffb800',
  warningBg: 'rgba(255,184,0,0.12)',
  success:   '#00ff41',
  successBg: 'rgba(0,255,65,0.12)',
  info:      '#00f0ff',
  infoBg:    'rgba(0,240,255,0.12)',
}

// ── Spacing scale (px) ──
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
}

// ── Typography ──
export const FONT = {
  family: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
  mono: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  xs: 10,
  sm: 11,
  md: 13,
  lg: 15,
  xl: 18,
  xxl: 24,
}

// ── Border radius ──
export const RADIUS = {
  sm: 1,
  md: 2,
  lg: 2,
  xl: 3,
  full: 2,
}

// ── Status definitions ──
export const STATUS_COLS = [
  { key: 'todo',        label: 'Todo',        color: '#7a8599' },
  { key: 'in_progress', label: 'In Progress', color: '#00f0ff' },
  { key: 'done',        label: 'Done',        color: '#00ff41' },
  { key: 'failed',      label: 'Failed',      color: '#ff2d55' },
]

export const STATUS_MAP = Object.fromEntries(STATUS_COLS.map(s => [s.key, s]))

// ── Priority definitions ──
export const PRIORITY = {
  high:   { label: 'High',   color: '#ff2d55', bg: 'rgba(255,45,85,0.12)', icon: '▲' },
  medium: { label: 'Medium', color: '#ffb800', bg: 'rgba(255,184,0,0.12)', icon: '■' },
  low:    { label: 'Low',    color: '#7a8599', bg: 'rgba(122,133,153,0.12)', icon: '▼' },
}

// ── Light mode palette ──
export const LIGHT = {
  bg:        '#e8eaf0',
  bgAlt:     '#f0f2f6',
  surface:   '#f5f7fa',
  elevated:  '#ffffff',
  overlay:   '#e0e3ea',
  text:      '#0a0c10',
  textMid:   '#4a5568',
  textDim:   '#8a94a6',
  textFaint: 'rgba(10,12,16,0.15)',
  border:    'rgba(0,180,200,0.15)',
  borderMid: 'rgba(0,180,200,0.25)',
  borderStrong: 'rgba(0,180,200,0.4)',
  hover:     'rgba(0,180,200,0.06)',
  active:    'rgba(0,180,200,0.1)',
  danger:    '#dc2626',
  dangerBg:  'rgba(220,38,38,0.1)',
  warning:   '#d97706',
  warningBg: 'rgba(217,119,6,0.1)',
  success:   '#059669',
  successBg: 'rgba(5,150,105,0.1)',
  info:      '#0891b2',
  infoBg:    'rgba(8,145,178,0.1)',
}

// ── Form input ──
export const FORM_INPUT = {
  background: DARK.elevated,
  border: `1px solid ${DARK.border}`,
  borderRadius: 2,
  padding: '7px 10px',
  fontSize: 13,
  outline: 'none',
  color: DARK.text,
  fontFamily: FONT.family,
  boxShadow: INSET_SHADOW,
}

// ── Label color palette ──
export const LABEL_PALETTE = [
  '#00f0ff', '#ff2d55', '#ffb800', '#00ff41', '#7a8599',
  '#00c8d6', '#ff6b35', '#ffd700', '#87ceeb', '#c084fc',
]
