"""What belongs in a rule's *value* box (ADR-0056).

``rules_engine`` says which triggers, condition fields and action types exist. It never
said what their *values* may be, so the editor rendered one free text box for all of
them: "set_priority" and "fire_event" and "add_label" all asked the user to type a bare
string, and switching the action type left the previous string sitting there. Half of
those strings are rejected at write time, the other half are accepted and match nothing.

This module answers the missing half. Every action type and every condition field maps
to one of three kinds:

``enum``
    The engine rejects anything else. The editor must render a picker, and a value
    outside the list is not a preference — it is a rule that cannot work.
``suggest``
    Open, but there is something real to offer: the labels that exist, the events that
    can be subscribed to, the node types that are registered. A value outside the list
    is legal (the label may be created tomorrow — see ``rule_warnings``), so the editor
    offers the list without enforcing it.
``free``
    A comment body, a person's name. Nothing to offer; a plain box is the honest control.

Each spec also says *who coined* the values it carries, in ``vocabulary``. The engine
names things for itself — ``in_progress``, ``changed_field``, ``member_of`` — and the
editor is free to show those as words; a label, an event or an assignee is the user's own
string and must be shown back exactly as typed. Only the server knows which is which, and
saying so here is what keeps a condition field added tomorrow from arriving on the wrong
side of that line (ADR-0058).

Derived at read time from the same constants the engine evaluates against, so a value
this serves is by construction one the engine understands.
"""

from sqlalchemy.orm import Session

from app.models import EdgeType, Node, NodeType
from app.schemas import NodeUpdate
from app.services import graph
from app.services.event_catalog import subscribable_events
from app.services.notifier import subscriber_counts
from app.services.rules_engine import (
    ACTION_TYPES,
    ACTION_VALUE_ENUMS,
    CONDITION_FIELDS,
    EDGE_SIDES,
)

KIND_ENUM = "enum"
KIND_SUGGEST = "suggest"
KIND_FREE = "free"


def _spec(kind: str, options=None, *, vocabulary: bool | None = None, **extra) -> dict:
    """One value slot. ``vocabulary`` says the options are names the product coined, so a
    reader may render them as words; it defaults to true for a closed set, because the
    engine is the only thing that can define one."""
    spec: dict = {
        "kind": kind,
        "options": list(options or []),
        "vocabulary": kind == KIND_ENUM if vocabulary is None else vocabulary,
    }
    spec.update(extra)
    return spec


def _node_type_keys(db: Session) -> list[str]:
    """Every registered node type key, built-ins first — the ``type`` vocabulary."""
    types = db.query(NodeType).order_by(NodeType.is_builtin.desc(), NodeType.key).all()
    return [nt.key for nt in types]


def _edge_type_keys(db: Session) -> list[str]:
    """Registered relationship keys. Suggestions, not an enum: ``edges.rel_type`` is a
    plain string column and nothing validates a write against the registry, so a rule may
    legitimately name a relation that only some other writer creates."""
    types = db.query(EdgeType).order_by(EdgeType.is_builtin.desc(), EdgeType.key).all()
    return [et.key for et in types]


def _distinct(db: Session, column) -> list[str]:
    return sorted({value for (value,) in db.query(column).distinct().all() if value})


def _changed_field_names() -> list[str]:
    """Field names a write can move, so ``changed_field`` can be picked instead of typed.

    Derived from the write schema and the task data surface rather than listed here: a
    field added to either shows up on its own, which is the whole reason the editor reads
    a served vocabulary instead of keeping its own copy.
    """
    return sorted(set(NodeUpdate.model_fields) | set(graph._TASK_DATA_SCALARS))


def action_value_specs(db: Session, *, project_id: str | None = None) -> dict[str, dict]:
    """One spec per action type. Every entry of ``ACTION_TYPES`` is present; a test pins
    that, because an action with no spec falls back to a free box — the state this whole
    module exists to remove."""
    labels = graph.label_names(db, project_id=project_id)
    events = subscribable_events(db)
    specs = {
        "set_assignee": _spec(KIND_FREE),
        "add_comment": _spec(KIND_FREE),
        "add_label": _spec(KIND_SUGGEST, labels),
        "remove_label": _spec(KIND_SUGGEST, labels),
        # The one action whose effect lands on another page: it delivers to whatever
        # integrations subscribe, and with nobody subscribed it is a button that reaches
        # no one and never says so. The count travels with the vocabulary so the editor
        # can say who would receive it while the rule is still being written.
        "fire_event": _spec(
            KIND_SUGGEST,
            events,
            subscribers=subscriber_counts(db, events, source="rule"),
        ),
    }
    for atype, values in ACTION_VALUE_ENUMS.items():
        specs[atype] = _spec(KIND_ENUM, values)
    return {atype: specs[atype] for atype in sorted(ACTION_TYPES) if atype in specs}


def condition_value_specs(db: Session, *, project_id: str | None = None) -> dict[str, dict]:
    """One spec per condition field. Conditions are *compared*, never written, so the
    engine validates none of their values — which makes the offered list the only thing
    standing between the user and a condition that quietly matches nothing."""
    node_types = _node_type_keys(db)
    specs = {
        # Wider than the action enums on purpose: a condition may name a status no task
        # action can write, because a rule can trigger on a project ("archived") too.
        "status": _spec(
            KIND_SUGGEST,
            sorted(set(ACTION_VALUE_ENUMS["set_status"]) | set(_distinct(db, Node.status))),
            vocabulary=True,
        ),
        "priority": _spec(
            KIND_SUGGEST,
            sorted(set(ACTION_VALUE_ENUMS["set_priority"]) | set(_distinct(db, Node.priority))),
            vocabulary=True,
        ),
        "assignee": _spec(KIND_FREE),
        "title_contains": _spec(KIND_FREE),
        "has_label": _spec(KIND_SUGGEST, graph.label_names(db, project_id=project_id)),
        "type": _spec(KIND_ENUM, node_types),
        "has_role": _spec(KIND_ENUM, graph.ROLES),
        # Open sets, but every name in them was coined by the engine, not by the user:
        # a schema field and a relationship key, not a label somebody typed.
        "changed_field": _spec(KIND_SUGGEST, _changed_field_names(), vocabulary=True),
        "edge_type": _spec(KIND_SUGGEST, _edge_type_keys(db), vocabulary=True),
        "edge_side": _spec(KIND_ENUM, EDGE_SIDES),
        "other_type": _spec(KIND_ENUM, node_types),
    }
    return {field: specs[field] for field in sorted(CONDITION_FIELDS) if field in specs}
