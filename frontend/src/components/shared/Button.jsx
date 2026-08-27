/**
 * The pill buttons that inline panels use to confirm and cancel.
 *
 * Deliberately *not* a wrapper for every `<button>` in the app. `global.css` already
 * styles the bare element and 38 buttons take a `kt-btn` variant on top of it, so a
 * component that re-styled all 348 would change how most of them look for no
 * correctness gain. What had actually drifted is much smaller and much more specific:
 * 24 buttons redefine their appearance inline, and among them the same confirm pill
 * appears in four files with four different paddings — 4px 14px, 5px 14px, 5px 16px,
 * 4px 16px — and two different font sizes, while every other property matches. Four
 * copies of one button is how a button ends up with four sizes.
 *
 * Colour stays a prop because it is genuinely per-use: green confirms a comment,
 * amber adds a dependency, indigo adds a membership. Everything that was *accidentally*
 * different — the padding, the radius, the weight, the letter-spacing — is not.
 */
import { DARK } from '../../constants/theme'

const BASE = {
  border: 'none',
  borderRadius: 9999,
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  padding: '5px 16px',
}

const VARIANTS = {
  // The affirmative action of an inline panel: post, save, add.
  confirm: { ...BASE, color: '#000' },
  // Its neighbour. Bordered rather than filled so the pair reads as one decision
  // with a default, not two equal options.
  cancel: {
    ...BASE,
    border: '1px solid rgba(var(--kt-ink-rgb), 0.15)',
    background: 'transparent',
    color: DARK.text,
  },
}

export default function Button({
  variant = 'confirm',
  tone = DARK.success,
  disabled = false,
  style,
  children,
  ...props
}) {
  const base = VARIANTS[variant] || VARIANTS.confirm
  return (
    <button
      disabled={disabled}
      style={{
        ...base,
        ...(variant === 'confirm' ? { background: tone } : null),
        // Disabled is dimmed rather than recoloured, so the button keeps its meaning
        // while it is unavailable.
        ...(disabled ? { opacity: 0.4, cursor: 'not-allowed' } : null),
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  )
}
