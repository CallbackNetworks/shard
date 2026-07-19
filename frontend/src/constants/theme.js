// Accent colors resolve to CSS variables so the user-selected accent (see
// utils/uiPrefs.js) recolors every inline usage at once. Fallbacks preserve
// the original amber brand when no accent is applied.
// --kt-hit is theme-aware (dark amber in light mode for contrast on white).
export const BRAND = 'var(--kt-hit, #facc15)'
export const BRAND_2 = 'var(--accent-2, #eab308)'

export const STATUS_COLOR = {
  todo: '#737373',
  in_progress: '#facc15',
  done: '#34d399',
  failed: '#fb7185',
}

export const STATUS_BG = {
  todo: 'rgba(115,115,115,0.14)',
  in_progress: 'rgba(250,204,21,0.12)',
  done: 'rgba(52,211,153,0.12)',
  failed: 'rgba(251,113,133,0.12)',
}

export const SHADOW_SM = '0 1px 2px rgba(0,0,0,0.3)'
export const SHADOW_LG = '0 4px 12px rgba(0,0,0,0.4)'
export const INSET_SHADOW = 'inset 0 1px 2px rgba(0,0,0,0.2)'

// Despite the name, DARK now resolves through the theme-aware --kt-* CSS
// variables so every inline usage follows light/dark mode automatically.
// The raw dark values live in global.css :root; light values in the
// [data-theme="light"] block.
export const DARK = {
  bg:        'var(--kt-bg, #171717)',
  bgAlt:     'var(--kt-bg, #141414)',
  surface:   'var(--kt-surface, #1f1f1f)',
  elevated:  'var(--kt-elev, #262626)',
  overlay:   'var(--kt-elev, #303030)',
  text:      'var(--kt-ink, #ffffff)',
  textMid:   'var(--kt-muted, #9ca3af)',
  textDim:   'var(--kt-faint, #6b7280)',
  textFaint: 'rgba(var(--kt-ink-rgb, 255, 255, 255), 0.15)',
  border:    'var(--kt-line, #3a3a3a)',
  borderMid: 'var(--kt-line, #525252)',
  borderStrong: 'var(--kt-faint, #737373)',
  hover:     'var(--kt-hover, rgba(255,255,255,0.05))',
  active:    'rgba(var(--kt-ink-rgb, 255, 255, 255), 0.08)',
  danger:    STATUS_COLOR.failed,
  dangerBg:  STATUS_BG.failed,
  warning:   '#f59e0b',
  warningBg: 'rgba(245,158,11,0.12)',
  success:   STATUS_COLOR.done,
  successBg: STATUS_BG.done,
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
  family: "'Inter', 'Arial Narrow', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  // Resolves through --kt-display so the runtime `displayFont` UI pref recolors
  // every inline usage at once (see utils/uiPrefs.js), mirroring the accent system.
  display: "var(--kt-display, 'Anton', 'Bebas Neue', 'Impact', 'Arial Narrow', sans-serif)",
  mono: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  xs: 10,
  sm: 11,
  md: 13,
  lg: 15,
  xl: 18,
  xxl: 24,
}

// Kinetic weight scale. Inter is loaded at 300–900; 800/900 read as "black" for
// the heavy, high-contrast headings and labels the design leans on.
export const WEIGHT = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  heavy: 800,
  black: 900,
}

export const RADIUS = {
  sm: 0,
  md: 0,
  lg: 0,
  xl: 0,
  full: 0,
}

export const STATUS_COLS = [
  { key: 'todo',        label: 'Todo',        color: STATUS_COLOR.todo, bg: STATUS_BG.todo },
  { key: 'in_progress', label: 'In Progress', color: STATUS_COLOR.in_progress, bg: STATUS_BG.in_progress },
  { key: 'done',        label: 'Done',        color: STATUS_COLOR.done, bg: STATUS_BG.done },
  { key: 'failed',      label: 'Failed',      color: STATUS_COLOR.failed, bg: STATUS_BG.failed },
]

export const STATUS_MAP = Object.fromEntries(STATUS_COLS.map(s => [s.key, s]))

export const PRIORITY = {
  high:   { label: 'High',   color: '#facc15', bg: 'rgba(250,204,21,0.12)', icon: '▲' },
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
  danger:    STATUS_COLOR.failed,
  dangerBg:  STATUS_BG.failed,
  warning:   '#d97706',
  warningBg: 'rgba(217,119,6,0.08)',
  success:   STATUS_COLOR.done,
  successBg: STATUS_BG.done,
  info:      '#2563eb',
  infoBg:    'rgba(37,99,235,0.08)',
}

export const FORM_INPUT = {
  background: 'var(--kt-elev, #262626)',
  border: '1px solid var(--kt-line, #3a3a3a)',
  borderRadius: 0,
  padding: '7px 10px',
  fontSize: 13,
  outline: 'none',
  color: 'var(--kt-ink, #ffffff)',
  fontFamily: FONT.family,
}

export const LABEL_PALETTE = [
  '#facc15', '#3b82f6', '#eab308', '#f59e0b', '#6b7280',
  '#a3a3a3', '#d4d4d4', '#06b6d4', '#ca8a04', '#f97316',
]

// ── Domain status color maps ─────────────────────────────────────────────
// Single source of truth for per-domain status chips; pages must import these
// rather than redefining local maps.

// Goal status chips (Goals page).
export const GOAL_STATUS_COLORS = {
  active:    { bg: 'rgba(250,204,21,0.14)', color: BRAND },
  completed: { bg: 'rgba(250,204,21,0.12)', color: BRAND },
  cancelled: { bg: 'rgba(250,204,21,0.12)', color: DARK.danger },
}

// ADR decision status chips (Decisions page).
export const DECISION_STATUS_COLORS = {
  proposed: { bg: 'rgba(250,204,21,0.15)', color: BRAND, border: `1px dashed ${BRAND}` },
  accepted: { bg: 'rgba(250,204,21,0.12)', color: BRAND, border: `1px solid ${BRAND}` },
  deprecated: { bg: 'rgba(148,163,184,0.12)', color: '#94a3b8', border: '1px solid #94a3b8' },
  superseded: { bg: 'rgba(250,204,21,0.12)', color: BRAND, border: `1px solid ${BRAND}` },
}

// Webhook delivery status chips/dots (Integrations page).
export const DELIVERY_STATUS_COLORS = {
  success: { bg: STATUS_BG.done, color: STATUS_COLOR.done, dot: STATUS_COLOR.done },
  failed:  { bg: STATUS_BG.failed, color: STATUS_COLOR.failed, dot: STATUS_COLOR.failed },
  dead:    { bg: STATUS_BG.failed, color: STATUS_COLOR.failed, dot: STATUS_COLOR.failed },
  pending: { bg: STATUS_BG.in_progress, color: STATUS_COLOR.in_progress, dot: STATUS_COLOR.in_progress },
}

// Webhook delivery text colors (WebhookLogs page renders `dead` muted, not red).
export const DELIVERY_STATUS_TEXT = {
  success: STATUS_COLOR.done,
  failed: STATUS_COLOR.failed,
  dead: '#6b7280',
  pending: STATUS_COLOR.in_progress,
}
