import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from app.models import Task, Project, Integration

logger = logging.getLogger(__name__)


def _compute_progress(project: Project) -> tuple[int, int, float]:
    total = len(project.tasks)
    done = sum(1 for t in project.tasks if t.status == "done")
    progress = round(done / total * 100, 1) if total > 0 else 0.0
    return total, done, progress


def _build_headers(integration: Integration) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if integration.secret:
        headers["Authorization"] = f"Bearer {integration.secret}"
    if integration.type == "drone":
        headers["X-Drone-Event"] = "custom"
        headers["X-Drone-Source"] = "todo-platform"
    elif integration.type == "jenkins":
        headers["X-Jenkins-Source"] = "todo-platform"
    return headers


async def fire_notifications(db: Session, task: Task, event: str) -> None:
    project: Project = task.project
    total, done, progress = _compute_progress(project)

    payload = {
        "event": event,
        "project": {
            "id": project.id,
            "name": project.name,
            "status": project.status,
            "progress": progress,
            "total_tasks": total,
            "done_tasks": done,
        },
        "task": {
            "id": task.id,
            "title": task.title,
            "status": task.status,
            "priority": task.priority,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    integrations = (
        db.query(Integration)
        .filter(
            Integration.active == True,
            Integration.project_id.in_([project.id, None]),
        )
        .all()
    )

    matching = [i for i in integrations if event in i.events]
    if not matching:
        return

    async with httpx.AsyncClient(timeout=10) as client:
        for integration in matching:
            try:
                resp = await client.post(
                    integration.url,
                    json=payload,
                    headers=_build_headers(integration),
                )
                logger.info("Notified %s [%s] → %s", integration.name, integration.type, resp.status_code)
            except Exception as exc:
                logger.warning("Failed to notify %s: %s", integration.name, exc)


async def fire_test_notification(integration: Integration) -> dict:
    payload = {
        "event": "test",
        "message": "This is a test notification from the TODO platform.",
        "integration": {"id": integration.id, "name": integration.name, "type": integration.type},
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                integration.url,
                json=payload,
                headers=_build_headers(integration),
            )
        return {"success": True, "status_code": resp.status_code, "body": resp.text[:200]}
    except Exception as exc:
        return {"success": False, "error": str(exc)}
