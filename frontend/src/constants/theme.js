// Accent colors resolve to CSS variables so the user-selected accent (see
// utils/uiPrefs.js) recolors every inline usage at once. Fallbacks preserve
// the original amber brand when no accent is applied.
// --kt-hit is theme-aware (dark amber in light mode for contrast on white).
export const BRAND = 'var(--kt-hit, #facc15)'
export const BRAND_2 = 'var(--accent-2, #eab308)'

// Status, priority and the brand accent are three separate colour families and
// none of them shares a hue with another (ADR-0088). in_progress used to be the
// brand amber #facc15 — the same value as PRIORITY.high and every CTA — so one
// yellow in a task row carried three unrelated meanings.
//
// Like DARK below, these resolve through the theme-aware --kt-* variables (both
// themes are declared in global.css) so a value stays legible on white. The
// literal fallbacks are the dark-mode shades. `var()` resolves in SVG
// presentation attributes too, which is how the charts consume them.
export const STATUS_COLOR = {
  todo: 'var(--kt-status-todo, #9ca3af)',
  in_progress: 'var(--kt-status-progress, #60a5fa)',
  done: 'var(--kt-status-done, #34d399)',
  failed: 'var(--kt-status-failed, #fb7185)',
}

export const STATUS_BG = {
  todo: 'var(--kt-status-todo-bg, rgba(156,163,175,0.14))',
  in_progress: 'var(--kt-status-progress-bg, rgba(96,165,250,0.14))',
  done: 'var(--kt-status-done-bg, rgba(52,211,153,0.14))',
  failed: 'var(--kt-status-failed-bg, rgba(251,113,133,0.14))',
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
  warning:   'var(--kt-warning, #f59e0b)',
  warningBg: 'var(--kt-warning-bg, rgba(245,158,11,0.12))',
  success:   STATUS_COLOR.done,
  successBg: STATUS_BG.done,
  info:      'var(--kt-info, #60a5fa)',
  infoBg:    'var(--kt-info-bg, rgba(96,165,250,0.12))',
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
  { key: 'todo',        label: 'Todo',        labelKey: 'todo',       color: STATUS_COLOR.todo, bg: STATUS_BG.todo },
  { key: 'in_progress', label: 'In Progress', labelKey: 'inProgress', color: STATUS_COLOR.in_progress, bg: STATUS_BG.in_progress },
  { key: 'done',        label: 'Done',        labelKey: 'done',       color: STATUS_COLOR.done, bg: STATUS_BG.done },
  { key: 'failed',      label: 'Failed',      labelKey: 'failed',     color: STATUS_COLOR.failed, bg: STATUS_BG.failed },
]

export const STATUS_MAP = Object.fromEntries(STATUS_COLS.map(s => [s.key, s]))

// Priority is ordinal, so it is drawn as a ramp rather than three equal hues:
// `weight` picks the chip treatment (solid / outline / ghost) and the ▲■▼ icon
// carries the order without colour at all. high #facc15 and medium #f59e0b were
// adjacent ambers — the two were not tellable apart in a row.
// `labelKey` is the translation key; `label` stays as the fallback for the few
// callers that build a chart series outside a component and have no `t`.
export const PRIORITY = {
  high:   { label: 'High',   labelKey: 'high',   color: 'var(--kt-prio-high, #fb923c)',   bg: 'var(--kt-prio-high-bg, rgba(251,146,60,0.16))',    icon: '▲', weight: 'solid' },
  medium: { label: 'Medium', labelKey: 'medium', color: 'var(--kt-prio-medium, #9ca3af)', bg: 'var(--kt-prio-medium-bg, rgba(156,163,175,0.10))', icon: '■', weight: 'outline' },
  low:    { label: 'Low',    labelKey: 'low',    color: 'var(--kt-prio-low, #6b7280)',    bg: 'var(--kt-prio-low-bg, rgba(107,114,128,0.08))',    icon: '▼', weight: 'ghost' },
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
  warning:   'var(--kt-warning, #b45309)',
  warningBg: 'var(--kt-warning-bg, rgba(180,83,9,0.10))',
  success:   STATUS_COLOR.done,
  successBg: STATUS_BG.done,
  info:      'var(--kt-info, #1d4ed8)',
  infoBg:    'var(--kt-info-bg, rgba(29,78,216,0.10))',
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
  active:    { bg: STATUS_BG.in_progress, color: STATUS_COLOR.in_progress },
  completed: { bg: STATUS_BG.done,        color: STATUS_COLOR.done },
  cancelled: { bg: STATUS_BG.todo,        color: STATUS_COLOR.todo },
}

// ADR decision status chips (Decisions page).
export const DECISION_STATUS_COLORS = {
  proposed:   { bg: STATUS_BG.in_progress, color: STATUS_COLOR.in_progress, border: `1px dashed ${STATUS_COLOR.in_progress}` },
  accepted:   { bg: STATUS_BG.done,        color: STATUS_COLOR.done,        border: `1px solid ${STATUS_COLOR.done}` },
  deprecated: { bg: STATUS_BG.todo,        color: STATUS_COLOR.todo,        border: `1px solid ${STATUS_COLOR.todo}` },
  superseded: { bg: STATUS_BG.todo,        color: STATUS_COLOR.todo,        border: `1px dashed ${STATUS_COLOR.todo}` },
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
