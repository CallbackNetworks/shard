from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.routers.deps import get_goal_or_404
from app.schemas import GoalOut, GoalProjectOut
from app.services import graph

# Reads only. A goal is a ``container``-role node (ADR-0041), so its create/update/
# delete go through the single graph write surface ``/api/nodes`` (+ the role-driven
# dispatcher) exactly like any other node; project links are ``contains`` edges managed
# via ``/api/nodes/{id}/edges``. This router keeps the enriched goal read shape
# (per-project breakdown + task-weighted subtree progress) that ``GoalOut`` callers rely on.
router = APIRouter(prefix="/goals", tags=["goals"])


def _project_progress(db: Session, project_id: str) -> float:
    """Progress for one project in a goal's breakdown — the shared subtree rule (ADR-0065).

    The goal total above it already counts its whole subtree; a per-project row that
    counted only direct children would contradict the total on the same page.
    """
    return graph.container_subtree_stats(db, project_id).progress


def _enrich_goal(goal: graph.GoalView, db: Session) -> GoalOut:
    """Build GoalOut: per-project breakdown + task-weighted subtree progress (ADR-0041)."""
    projects: list[GoalProjectOut] = []
    for proj in graph.projects_for_goal(db, goal.id):
        prog = _project_progress(db, proj.id)
        projects.append(GoalProjectOut(project_id=proj.id, project_name=proj.name, progress=prog))

    out = GoalOut.model_validate(goal)
    out.projects = projects
    out.progress = graph.goal_subtree_progress(db, goal.id)
    return out


@router.get("", response_model=list[GoalOut])
def list_goals(
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
):
    goals = graph.all_goals(db, status=status_filter)
    return [_enrich_goal(g, db) for g in goals]


@router.get("/{goal_id}", response_model=GoalOut)
def get_goal(goal_id: str, db: Session = Depends(get_db)):
    goal = get_goal_or_404(goal_id, db)
    return _enrich_goal(goal, db)
