// ── Brand colors ──
export const BRAND = '#1ed760'
export const BRAND_2 = '#1db954'

// ── Shadows ──
export const SHADOW_SM = 'rgba(0,0,0,0.3) 0px 8px 8px'
export const SHADOW_LG = 'rgba(0,0,0,0.5) 0px 8px 24px'
export const INSET_SHADOW = 'rgb(18,18,18) 0px 1px 0px, rgb(124,124,124) 0px 0px 0px 1px inset'

// ── Color palette ──
export const DARK = {
  bg:        '#07080f',
  bgAlt:     '#121212',
  surface:   '#181818',
  elevated:  '#1f1f1f',
  overlay:   '#252525',
  text:      '#ffffff',
  textMid:   '#b3b3b3',
  textDim:   '#4d4d4d',
  textFaint: 'rgba(255,255,255,0.25)',
  border:    'rgba(255,255,255,0.08)',
  borderMid: 'rgba(255,255,255,0.12)',
  borderStrong: 'rgba(255,255,255,0.2)',
  hover:     'rgba(255,255,255,0.05)',
  active:    'rgba(255,255,255,0.08)',
  danger:    '#f3727f',
  dangerBg:  'rgba(243,114,127,0.12)',
  warning:   '#ffa42b',
  warningBg: 'rgba(255,164,43,0.12)',
  success:   '#1ed760',
  successBg: 'rgba(30,215,96,0.12)',
  info:      '#539df5',
  infoBg:    'rgba(83,157,245,0.12)',
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
  family: "'SpotifyMixUI', 'Helvetica Neue', helvetica, arial, sans-serif",
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
  sm: 4,
  md: 8,
  lg: 10,
  xl: 12,
  full: 9999,
}

// ── Status definitions ──
export const STATUS_COLS = [
  { key: 'todo',        label: 'Todo',        color: 'rgba(255,255,255,0.3)' },
  { key: 'in_progress', label: 'In Progress', color: '#539df5' },
  { key: 'done',        label: 'Done',        color: '#1ed760' },
  { key: 'failed',      label: 'Failed',      color: '#f3727f' },
]

export const STATUS_MAP = Object.fromEntries(STATUS_COLS.map(s => [s.key, s]))

// ── Priority definitions ──
export const PRIORITY = {
  high:   { label: 'High',   color: '#f3727f', bg: 'rgba(243,114,127,0.12)', icon: '▲' },
  medium: { label: 'Medium', color: '#ffa42b', bg: 'rgba(255,164,43,0.12)',  icon: '■' },
  low:    { label: 'Low',    color: '#b3b3b3', bg: 'rgba(179,179,179,0.12)', icon: '▼' },
}

// ── Button presets ──
export const BTN_PRIMARY = {
  background: BRAND,
  color: '#000',
  border: 'none',
  borderRadius: RADIUS.full,
  padding: `${SPACE.sm + 2}px ${SPACE.xl}px`,
  fontSize: FONT.md,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '1.4px',
  cursor: 'pointer',
}

export const BTN_GHOST = {
  background: 'transparent',
  color: DARK.text,
  border: `1px solid ${DARK.borderMid}`,
  borderRadius: RADIUS.full,
  padding: `${SPACE.sm + 2}px ${SPACE.xl - 2}px`,
  fontSize: FONT.md,
  fontWeight: 700,
  cursor: 'pointer',
}

export const BTN_SM = {
  background: DARK.active,
  color: DARK.text,
  border: `1px solid ${DARK.border}`,
  borderRadius: RADIUS.md,
  padding: `${SPACE.xs + 2}px ${SPACE.md}px`,
  fontSize: FONT.md,
  cursor: 'pointer',
}

export const BTN_ICON = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '2px 5px',
  borderRadius: RADIUS.sm,
  display: 'flex',
  alignItems: 'center',
}

// ── Input preset ──
export const INPUT = {
  padding: `${SPACE.xs + 2}px ${SPACE.sm + 2}px`,
  border: `1px solid ${DARK.border}`,
  borderRadius: RADIUS.md - 2,
  fontSize: FONT.md,
  background: DARK.hover,
  color: DARK.text,
  outline: 'none',
}

// ── Badge preset ──
export const BADGE = {
  fontSize: FONT.xs,
  padding: '2px 8px',
  borderRadius: RADIUS.full,
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

// ── Panel preset ──
export const PANEL = {
  borderBottom: `1px solid ${DARK.border}`,
  background: 'rgba(255,255,255,0.02)',
}

// ── Label color palette ──
export const LABEL_PALETTE = [
  '#1ed760', '#f3727f', '#ffa42b', '#539df5', '#b3b3b3',
  '#1db954', '#ff6b35', '#ffd700', '#87ceeb', '#dda0dd',
]
