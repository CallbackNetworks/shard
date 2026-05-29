# ADR-0004: Decision Records as Enhanced Labels

## Status
Accepted

## Date
2026-05-29

## Context
Users frequently forget past decisions and timelines. Querying an AI about historical decisions is expensive (token cost per query). The platform needed a way to capture and persist decisions so users can browse and search them for free after the initial capture.

Several approaches were considered:
1. **Full standalone model** — dedicated `Decision` table with its own relations, graph visualization, and timeline view. High complexity, many new models/endpoints.
2. **Enhanced Label approach** — extend the existing `Label` model with decision-specific fields (`type`, `description`, `decision_status`, `source`). Reuses 90% of existing infrastructure (Label CRUD, TaskLabel associations, LabelChip rendering).
3. **External file-based** — store decisions as markdown files. Poor searchability, no task linkage.

## Decision
Chose the **Enhanced Label approach** (option 2). Decisions are labels with `type="decision"` and additional metadata fields. This reuses the existing Label model, TaskLabel join table, label API endpoints, and LabelChip UI component.

Key reasons:
- Minimal new code: only one new lightweight router (`decisions.py`) and one new page (`Decisions.jsx`)
- Task association is free via existing `TaskLabel` infrastructure
- AI tools can create decision labels and tag tasks in the same way they manage regular labels
- The one-time AI analysis cost captures decisions permanently; users browse for free afterward

Trade-offs accepted:
- No decision-to-decision relationship graph (can be added later with a separate relation model)
- Labels are project-scoped, so decisions cannot span multiple projects
- No independent compliance status tracking

## Consequences
- **Positive**: Fast to implement, low maintenance surface, familiar UX (labels are already understood by users), AI integration straightforward via existing tool dispatch pattern.
- **Positive**: Decision descriptions stored as Markdown with ADR-style sections (Context/Decision/Consequences), exportable as standalone `.md` files.
- **Negative**: If the decision system grows beyond ~50 decisions per project, the flat list UI may need pagination or search. The label table will grow with mixed-type rows.
- **Future**: If decision-to-decision relationships become needed, a `DecisionRelation` model can be added without changing the core label-based approach.
