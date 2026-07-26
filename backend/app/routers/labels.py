from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.routers.deps import get_label_or_404, get_task_or_404
from app.routers.deps import get_project_or_404 as _get_project_or_404
from app.routers.issue_sync import sync_labels_to_external
from app.schemas import LabelOut
from app.services import graph

router = APIRouter(prefix="/projects/{project_id}/labels", tags=["labels"])


@router.get("", response_model=list[LabelOut])
def list_labels(project_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    return graph.labels_in_project(db, project_id)


# Label create/update/delete retired (ADR-0043): a label is a node — create via
# POST /api/nodes (type "label", container_id = project) + update/delete via
# /api/nodes/{id}. Listing and the task↔label assignment below stay.


# Task-label endpoints (nested under tasks)
task_label_router = APIRouter(
    prefix="/projects/{project_id}/tasks/{task_id}/labels",
    tags=["labels"],
)


@task_label_router.post("/{label_id}", response_model=LabelOut, status_code=status.HTTP_201_CREATED)
async def add_label_to_task(project_id: str, task_id: str, label_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    task = get_task_or_404(task_id, db, project_id=project_id)
    label = get_label_or_404(label_id, db, project_id=project_id)
    if label_id not in graph.label_ids_for_task(db, task_id):
        graph.set_label(db, task_id, label_id)
        db.commit()
        if task.external_provider:
            await sync_labels_to_external(task, db)
    return label


@task_label_router.delete("/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_label_from_task(project_id: str, task_id: str, label_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    task = get_task_or_404(task_id, db, project_id=project_id)
    if not graph.unset_label(db, task_id, label_id):
        raise HTTPException(status_code=404, detail="Label not assigned to task")
    db.commit()
    if task.external_provider:
        await sync_labels_to_external(task, db)
