from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Goal, GoalProject, Project, Task
from app.routers.deps import get_goal_or_404
from app.schemas import GoalCreate, GoalOut, GoalProjectOut, GoalUpdate
from app.services import graph
from app.services.activity import log_activity
from app.services.ws_manager import ws_manager

router = APIRouter(prefix="/goals", tags=["goals"])


def _project_progress(db: Session, project_id: str) -> float:
    """Compute progress for a single project (top-level tasks only)."""
    total = db.query(Task).filter(Task.project_id == project_id, Task.parent_id.is_(None)).count()
    if total == 0:
        return 0.0
    done = db.query(Task).filter(Task.project_id == project_id, Task.parent_id.is_(None), Task.status == "done").count()
    return round(done / total * 100, 1)


def _enrich_goal(goal: Goal, db: Session) -> GoalOut:
    """Build GoalOut with computed progress from linked projects."""
    projects: list[GoalProjectOut] = []
    for gp in goal.goal_projects:
        proj = gp.project
        if proj is None:
            continue
        prog = _project_progress(db, proj.id)
        projects.append(GoalProjectOut(project_id=proj.id, project_name=proj.name, progress=prog))

    overall = round(sum(p.progress for p in projects) / len(projects), 1) if projects else 0.0

    out = GoalOut.model_validate(goal)
    out.projects = projects
    out.progress = overall
    return out


@router.get("", response_model=list[GoalOut])
def list_goals(
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
):
    query = db.query(Goal)
    if status_filter:
        query = query.filter(Goal.status == status_filter)
    goals = query.order_by(Goal.created_at.desc()).all()
    return [_enrich_goal(g, db) for g in goals]


@router.get("/{goal_id}", response_model=GoalOut)
def get_goal(goal_id: str, db: Session = Depends(get_db)):
    goal = get_goal_or_404(goal_id, db)
    return _enrich_goal(goal, db)


@router.post("", response_model=GoalOut, status_code=status.HTTP_201_CREATED)
async def create_goal(body: GoalCreate, db: Session = Depends(get_db)):
    goal = Goal(
        title=body.title,
        description=body.description,
        target_date=body.target_date,
    )
    db.add(goal)
    db.flush()

    for pid in body.project_ids:
        project = db.query(Project).filter(Project.id == pid).first()
        if not project:
            raise HTTPException(status_code=404, detail=f"Project {pid} not found")
        db.add(GoalProject(goal_id=goal.id, project_id=pid))

    log_activity(
        db,
        "goal.created",
        detail=f'Goal "{goal.title}" created',
    )
    db.commit()
    db.refresh(goal)
    await ws_manager.broadcast("goal.created", {"goal_id": goal.id})
    return _enrich_goal(goal, db)


@router.patch("/{goal_id}", response_model=GoalOut)
async def update_goal(goal_id: str, body: GoalUpdate, db: Session = Depends(get_db)):
    goal = get_goal_or_404(goal_id, db)

    changes = body.model_dump(exclude_none=True)
    project_ids = changes.pop("project_ids", None)

    for field, value in changes.items():
        setattr(goal, field, value)

    if project_ids is not None:
        # Replace linked projects (bulk delete bypasses graph_sync; clear part_of edges too)
        db.query(GoalProject).filter(GoalProject.goal_id == goal_id).delete()
        graph.remove_edges(db, target_id=goal_id, rel_type=graph.REL_PART_OF)
        for pid in project_ids:
            project = db.query(Project).filter(Project.id == pid).first()
            if not project:
                raise HTTPException(status_code=404, detail=f"Project {pid} not found")
            db.add(GoalProject(goal_id=goal_id, project_id=pid))

    log_activity(
        db,
        "goal.updated",
        detail=f'Goal "{goal.title}" updated',
    )
    db.commit()
    db.refresh(goal)
    await ws_manager.broadcast("goal.updated", {"goal_id": goal_id})
    return _enrich_goal(goal, db)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_goal(goal_id: str, db: Session = Depends(get_db)):
    goal = get_goal_or_404(goal_id, db)
    log_activity(
        db,
        "goal.deleted",
        detail=f'Goal "{goal.title}" deleted',
    )
    db.delete(goal)
    db.commit()
    await ws_manager.broadcast("goal.deleted", {"goal_id": goal_id})
