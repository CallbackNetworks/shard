# ADR-0031: Kinetic Typography System and Runtime-Switchable Display Font

## Status
Accepted

## Date
2026-07-14

## Context
The frontend has always leaned on a "kinetic typography" visual language —
heavy uppercase display type, oversized watermark words, high weight contrast,
and cut/punch/marquee text animations (the `kt-` class prefix, `--kt-*` tokens,
and `@keyframes kinetic*` families). But this language was never written down
(ADR-0012 only covers the CSS Modules strategy), and two concrete weaknesses
undercut it:

1. **The display font was unreliable.** `--kt-display` resolved to `Impact`, a
   system font absent on most Linux and some mobile platforms, silently
   degrading headings to thin `Arial Narrow`. Meanwhile `Bebas Neue` was loaded
   in `index.html` but never referenced — a wasted download.
2. **Weight contrast was under-delivered.** Inter was loaded only up to 800, yet
   33 call sites requested `font-weight: 900`, so the heaviest intended weight
   silently capped at 800. With `font-synthesis-weight: none` set globally, no
   weight is ever faux-rendered, so headings could look flatter than designed.

We wanted a heavier, guaranteed, coherent display treatment — and, because taste
here is genuinely subjective, the ability for the user to switch the display
font without a rebuild.

## Decision
Codify the kinetic typography system and make the display font a runtime
preference:

- **Display face → Anton (default), loaded via webfont.** `--kt-display` now
  resolves to `'Anton', 'Bebas Neue', 'Impact', 'Arial Narrow', sans-serif`.
  Anton is a black condensed face that delivers the intended heavy kinetic look
  and renders identically on every platform. `Impact` is demoted to a fallback.
- **Full Inter weight range.** `index.html` loads Inter `300–900`, so the
  existing `900` usages are honest and a real black weight is available. A
  `WEIGHT` token (`regular…black`) in `constants/theme.js` names the scale so new
  code stops hardcoding magic numbers.
- **Runtime-switchable display font.** The display face is a `displayFont` UI
  preference (`anton | bebas | impact`), reusing the existing `uiPrefs`
  mechanism that already powers accent color — `applyUiPrefs` writes the chosen
  stack to `--kt-display`, so every heading, watermark, and inline `FONT.display`
  usage recolors instantly. It persists in `localStorage` and mirrors to the
  backend `user-preferences` key for cross-device sync. A `Segmented` picker in
  Settings previews each option in its own face.
- `FONT.display` in `theme.js` now resolves through `var(--kt-display, …)` so
  inline styles follow the switch identically to CSS classes.

Weight contrast is delivered at the shared-primitive level (display headings,
`.kt-label`, stat numbers, buttons) rather than by editing individual screens,
keeping the change token-driven and consistent with ADR-0012.

## Consequences
**Positive:** Headings are heavy, guaranteed, and consistent across platforms;
no wasted font download. The heaviest weights are real. The display font is a
one-click, cross-device preference with a live preview, resolving a subjective
choice without forking the design or shipping a rebuild. The kinetic system is
now documented as a first-class design language.

**Negative / trade-offs:** Three display faces (Anton, Bebas Neue, plus the
Inter body) are now fetched from Google Fonts, a modest extra download and a
third-party dependency on the font CDN. Weight remains applied ad-hoc via inline
`fontWeight` in many components; the new `WEIGHT` token is the migration target
but existing call sites are not all converted in this change.
