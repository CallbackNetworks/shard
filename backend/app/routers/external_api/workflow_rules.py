"""External API v1 — workflow rules (ADR-0085).

The automation layer, which until now an agent could trigger a thousand times by hand and
never once arrange to happen by itself. Same acts as the internal surface, same refusals —
both routers call ``services/rule_admin`` and neither writes an error response.

Start at ``GET /workflow-rules/vocabulary``: it is generated from what the engine enforces,
so anything it offers is something the engine understands. Composing a rule without it means
guessing at trigger names, condition fields and action types, and the failure mode of a
wrong guess is a rule that saves cleanly and never fires.

A container-scoped key (project or identity, ADR-0107) sees global rules
(``project_id: null``) because they apply to everything in its scope, but may only write
rules bound within it.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey
from app.routers.external_api.auth import _auth_errors, _get_api_key, _project_ids_in_scope, _require_scope
from app.schemas import WorkflowRuleCreate, WorkflowRuleOut, WorkflowRuleUpdate
from app.services import rule_admin

sub_router = APIRouter()


def _check_write_scope_project(db: Session, api_key: ApiKey, project_id: str | None) -> None:
    scoped_project_ids = _project_ids_in_scope(db, api_key)
    if scoped_project_ids is not None and project_id not in scoped_project_ids:
        raise HTTPException(status_code=403, detail="API key can only write rules within its scope")


@sub_router.get(
    "/workflow-rules",
    response_model=list[WorkflowRuleOut],
    summary="List workflow rules",
    description=(
        "Automation rules, newest first, each with `warnings` describing why it might never "
        "do anything — a label it references that no longer exists, an event nobody "
        "subscribes to. Warnings are computed on read because they are about the world, not "
        "the rule. Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_list_rules(
    project_id: str | None = Query(None),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    scoped_project_ids = _project_ids_in_scope(db, api_key)
    if project_id is not None:
        if scoped_project_ids is not None and project_id not in scoped_project_ids:
            raise HTTPException(status_code=403, detail="API key does not have access to this project")
        return rule_admin.list_rules(db, project_id=project_id)
    if scoped_project_ids is None:
        return rule_admin.list_rules(db)
    if len(scoped_project_ids) == 1:
        return rule_admin.list_rules(db, project_id=scoped_project_ids[0])
    allowed = set(scoped_project_ids)
    return [r for r in rule_admin.list_rules(db) if r.project_id is None or r.project_id in allowed]


@sub_router.get(
    "/workflow-rules/vocabulary",
    summary="Everything needed to compose a rule the engine will run",
    description=(
        "Triggers, which condition fields each trigger can carry, condition operators, "
        "action types, and the legal values for every action and condition field. Generated "
        "from the registries the write path enforces (ADR-0055, ADR-0056), so this is the "
        "one place that cannot drift from the engine. Call it before composing a rule. "
        "Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_rule_vocabulary(
    project_id: str | None = Query(None, description="Narrows label suggestions to one project"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    scoped_project_ids = _project_ids_in_scope(db, api_key)
    if project_id is not None:
        if scoped_project_ids is not None and project_id not in scoped_project_ids:
            raise HTTPException(status_code=403, detail="API key does not have access to this project")
        return rule_admin.vocabulary(db, project_id=project_id)
    single = scoped_project_ids[0] if scoped_project_ids and len(scoped_project_ids) == 1 else None
    return rule_admin.vocabulary(db, project_id=single)


@sub_router.post(
    "/workflow-rules",
    response_model=WorkflowRuleOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a workflow rule",
    description=(
        "Triggers are graph-shaped, not task-shaped: `node.created`, `node.updated`, "
        "`node.deleted`, `edge.added`, `edge.removed` (ADR-0049, ADR-0055). A rule whose "
        "conditions ask about something its trigger never carries is a 422, not a warning — "
        "it contradicts itself and could never fire. Rules never chain: writes a rule makes "
        "do not re-enter the engine (ADR-0048). Requires `write` scope."
    ),
    responses=_auth_errors,
)
def api_create_rule(body: WorkflowRuleCreate, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "write")
    _check_write_scope_project(db, api_key, body.project_id)
    return rule_admin.create(db, body)


@sub_router.get(
    "/workflow-rules/{rule_id}",
    response_model=WorkflowRuleOut,
    summary="Get one workflow rule",
    responses=_auth_errors,
)
def api_get_rule(rule_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    rule = rule_admin.get(db, rule_id)
    scoped_project_ids = _project_ids_in_scope(db, api_key)
    if scoped_project_ids is not None and rule.project_id is not None and rule.project_id not in scoped_project_ids:
        raise HTTPException(status_code=403, detail="API key does not have access to this rule")
    return rule


@sub_router.patch(
    "/workflow-rules/{rule_id}",
    response_model=WorkflowRuleOut,
    summary="Update a workflow rule",
    description=(
        "Partial update. The trigger/condition agreement is re-checked against the *merged* "
        "result, because changing only the trigger can strand conditions that were legal "
        "under the old one. Requires `write` scope."
    ),
    responses=_auth_errors,
)
def api_update_rule(
    rule_id: str,
    body: WorkflowRuleUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_write_scope_project(db, api_key, rule_admin.load(db, rule_id).project_id)
    return rule_admin.update(db, rule_id, body)


@sub_router.delete(
    "/workflow-rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a workflow rule",
    responses=_auth_errors,
)
def api_delete_rule(rule_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "write")
    _check_write_scope_project(db, api_key, rule_admin.load(db, rule_id).project_id)
    rule_admin.delete(db, rule_id)


@sub_router.post(
    "/workflow-rules/{rule_id}/test",
    summary="Dry-run a rule against one node",
    description=(
        "Reports `would_fire`, each condition's verdict, and what each action *would* do — "
        "put through the engine's own prediction, so it cannot claim an effect the engine "
        "would not produce (ADR-0054). Conditions about the change that fires the rule have "
        "no answer against a bare subject and report `null` rather than `false`. Requires "
        "`read` scope: nothing is written."
    ),
    responses=_auth_errors,
)
def api_test_rule(
    rule_id: str,
    node_id: str | None = Query(None),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    return rule_admin.dry_run(db, rule_id, node_id)
