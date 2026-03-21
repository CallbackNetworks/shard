from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Project, Label, Cycle
from app.schemas import ProjectCreate, ProjectUpdate, ProjectOut, TaskOut, LabelOut, CycleOut, IdentityOut
from app.services.activity import log_activity

router = APIRouter(prefix="/projects", tags=["projects"])


def _enrich_task(task) -> TaskOut:
    out = TaskOut.model_validate(task)
    out.labels = [LabelOut.model_validate(tl.label) for tl in task.task_labels if tl.label is not None]
    out.subtask_count = len(task.subtasks)
    return out


def _enrich(project: Project) -> ProjectOut:
    # Only top-level tasks (no parent) for progress counting
    top_tasks = [t for t in project.tasks if t.parent_id is None]
    total = len(top_tasks)
    done = sum(1 for t in top_tasks if t.status == "done")
    progress = round(done / total * 100, 1) if total > 0 else 0.0
    out = ProjectOut.model_validate(project)
    out.total_tasks = total
    out.done_tasks = done
    out.progress = progress
    out.tasks = [_enrich_task(t) for t in project.tasks]
    out.labels = [LabelOut.model_validate(lb) for lb in project.labels]

    # Enrich cycles
    enriched_cycles = []
    for cycle in project.cycles:
        task_ids = [ct.task_id for ct in cycle.cycle_tasks]
        tasks = [ct.task for ct in cycle.cycle_tasks if ct.task is not None]
        c_total = len(tasks)
        c_done = sum(1 for t in tasks if t.status == "done")
        cout = CycleOut.model_validate(cycle)
        cout.task_ids = task_ids
        cout.total_tasks = c_total
        cout.done_tasks = c_done
        enriched_cycles.append(cout)
    out.cycles = enriched_cycles

    # Enrich identities
    out.identities = [
        IdentityOut(
            id=pi.identity.id,
            name=pi.identity.name,
            color=pi.identity.color,
            description=pi.identity.description,
            avatar=pi.identity.avatar,
            created_at=pi.identity.created_at,
            project_count=len(pi.identity.project_identities),
        )
        for pi in project.project_identities
        if pi.identity is not None
    ]

    return out


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(Project).order_by(Project.created_at.desc()).all()
    return [_enrich(p) for p in projects]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    project = Project(**body.model_dump())
    db.add(project)
    db.flush()
    log_activity(
        db, "project.created",
        project_id=project.id,
        detail=f'Project "{project.name}" created',
    )
    db.commit()
    db.refresh(project)
    return _enrich(project)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _enrich(project)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: str, body: ProjectUpdate, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    changes = body.model_dump(exclude_none=True)
    old_status = project.status
    for field, value in changes.items():
        setattr(project, field, value)
    if "status" in changes and changes["status"] != old_status:
        log_activity(
            db, f'project.{changes["status"]}',
            project_id=project_id,
            detail=f'Project "{project.name}" changed to {changes["status"]}',
            meta={"old_status": old_status, "new_status": changes["status"]},
        )
    db.commit()
    db.refresh(project)
    return _enrich(project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    log_activity(
        db, "project.deleted",
        project_id=project_id,
        detail=f'Project "{project.name}" deleted',
    )
    db.delete(project)
    db.commit()
