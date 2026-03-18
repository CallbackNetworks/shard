from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict


# --- Project ---

class ProjectCreate(BaseModel):
    name: str
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: Literal["active", "archived"] | None = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None
    status: str
    created_at: datetime
    updated_at: datetime
    progress: float = 0.0
    total_tasks: int = 0
    done_tasks: int = 0


# --- Task ---

class TaskCreate(BaseModel):
    title: str
    description: str | None = None
    priority: Literal["low", "medium", "high"] = "medium"


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: Literal["todo", "in_progress", "done", "failed"] | None = None
    priority: Literal["low", "medium", "high"] | None = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    title: str
    description: str | None
    status: str
    priority: str
    callback_token: str
    created_at: datetime
    updated_at: datetime


# --- Webhook callback ---

class WebhookCallback(BaseModel):
    status: Literal["todo", "in_progress", "done", "failed"]
    message: str | None = None


# --- Integration ---

class IntegrationCreate(BaseModel):
    name: str
    type: Literal["jenkins", "drone", "generic"]
    url: str
    secret: str | None = None
    project_id: str | None = None
    events: list[str] = ["task.done", "task.failed", "project.complete"]
    active: bool = True


class IntegrationUpdate(BaseModel):
    name: str | None = None
    type: Literal["jenkins", "drone", "generic"] | None = None
    url: str | None = None
    secret: str | None = None
    project_id: str | None = None
    events: list[str] | None = None
    active: bool | None = None


class IntegrationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    type: str
    url: str
    secret: str | None
    project_id: str | None
    events: list[str]
    active: bool
    created_at: datetime
