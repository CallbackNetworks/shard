# ADR-0012: Frontend Styling Strategy — CSS Modules over Inline Styles

## Status
Accepted

## Date
2026-07-06

## Context
The frontend originally styled everything with inline `style={{...}}` objects
plus a `GLOBAL_CSS` string injected from `App.jsx`. This kept the stack
dependency-free (no Tailwind, no CSS-in-JS library) but has accumulated real
costs as the UI grew:

- Inline styles cannot express pseudo-classes, media queries, or keyframes,
  which led to `onMouseEnter`/`onMouseLeave` handlers simulating `:hover` and
  a growing global CSS string for animations.
- Style objects are recreated on every render and bloat component files —
  the largest pages (`StructureMap.jsx`, `Dashboard.jsx`) exceed 1000 lines
  largely due to embedded styling.
- There is no single place to see or theme the visual system.

Organic drift has already begun: `GLOBAL_CSS` was replaced by
`src/styles/global.css` (~3600 lines), and three pages (`Dashboard`,
`ProjectDetail`, `Integrations`) import co-located `*.module.css` files.
Meanwhile 60+ files still use inline styles, and the project documentation
still claimed "all inline styles". A written decision is needed so new code
stops flip-flopping between approaches.

Adopting Tailwind or a CSS-in-JS runtime was considered but rejected: both add
build/runtime dependencies and a migration cliff, against the project's
preference for a small dependency surface.

## Decision
Standardize on a three-layer styling model, formalizing the drift that already
proved itself in practice:

1. **`src/styles/global.css`** — design tokens, resets, keyframe animations,
   and utility classes shared across pages. Anything referenced by more than
   one component belongs here.
2. **Co-located CSS Modules** (`Component.module.css`, imported as `s`) —
   the default for all component-scoped static styling in new or refactored
   components. Pseudo-classes and media queries live here instead of JS event
   handlers.
3. **Inline `style={{...}}`** — reserved for genuinely dynamic values
   (computed colors, positions, progress widths) and for legacy code not yet
   migrated.

Migration is opportunistic, not big-bang: when a component is significantly
edited or split, its static inline styles move to a CSS Module in the same
change. No dedicated migration project.

## Consequences
Positive:
- New components get real `:hover`/`:focus`/media-query support without JS
  workarounds, and page files shrink to logic plus markup.
- No new dependencies; Vite supports CSS Modules natively.
- The existing `DARK` theme constants remain usable for dynamic inline values,
  so the two systems interoperate during the long migration tail.

Negative:
- Two styling styles coexist indefinitely; readers must know the rule
  ("static → module, dynamic → inline") to know where to look.
- CSS Modules class names are opaque in DevTools without source maps.
- Opportunistic migration means some rarely-touched files may keep inline
  styles forever — accepted, since they also carry no ongoing cost.
