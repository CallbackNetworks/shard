/**
 * Colour helpers that survive a themed token.
 *
 * The palette in `constants/theme.js` resolves through CSS custom properties
 * (ADR-0088) so a status keeps its meaning and its contrast in both themes.
 * That makes the old `color + '33'` hex-suffix trick unusable — appending two
 * characters to `var(--kt-status-done, #34d399)` produces a value the browser
 * drops silently, so the border or fill simply stops rendering.
 *
 * `color-mix()` takes the computed value instead of the source text, so it
 * works for a raw hex, an `rgba()` and a `var()` reference alike.
 */
export function alpha(color, percent) {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}
