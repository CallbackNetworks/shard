# ADR-0002: Code Quality Tools

## Status

Accepted

## Date

2026-05-29

## Context

The project had no code quality tooling — no linter, formatter, or type checker. This meant code style was inconsistent and common mistakes (unused imports, unsorted imports, ambiguous variables) went undetected.

For Python, the options considered were:
- **flake8 + black + isort**: Three separate tools, each with its own config.
- **ruff**: Single tool replacing all three, extremely fast (written in Rust), widely adopted in the FastAPI ecosystem.

For JavaScript/JSX:
- **ESLint**: The standard JavaScript linter, with flat config support (ESLint 9+).
- **Prettier**: Formatter only; not needed since the project uses inline styles (no CSS) and the codebase has a consistent existing style.

For type checking:
- **mypy** (Python) and **TypeScript** (frontend) were considered but deferred — the codebase is not annotated for mypy, and the frontend is pure JSX without TypeScript. Adding either would require significant upfront investment for incremental benefit.

## Decision

- **Python**: Use **ruff** for both linting and formatting. Configured with rules: E (pycodestyle errors), F (pyflakes), I (isort), W (warnings), UP (pyupgrade), B (bugbear). Ignoring B008 (FastAPI `Depends()` pattern), E402, E501, E711, E712 (SQLAlchemy filter patterns).
- **JavaScript**: Use **ESLint 9** with flat config, `eslint-plugin-react-hooks`, and `@eslint/js` recommended rules. `no-unused-vars` is set to warn (not error) to avoid blocking CI on unused imports that tree-shaking removes anyway.
- **Type checking**: Deferred. Can be introduced incrementally later.

Both tools run in CI and block merges on errors (ESLint allows up to 300 warnings).

## Consequences

- All Python code has consistent formatting and import ordering.
- Common JavaScript mistakes (missing hook deps, empty catch blocks) are caught automatically.
- The `no-unused-vars` warnings (279 at time of adoption) provide visibility into dead imports without blocking development. The warning cap (300) in CI prevents regression.
- No type safety beyond what Python's runtime and Pydantic provide. This is acceptable for a personal project but may need revisiting if the codebase grows.
