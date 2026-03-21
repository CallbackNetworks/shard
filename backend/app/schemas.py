from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


# --- Identity ---

class IdentityCreate(BaseModel):
    name: str
    color: str = "#5e6ad2"
    description: str | None = None
    avatar: str | None = None


class IdentityUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    description: str | None = None
    avatar: str | None = None


class IdentityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    color: str
    description: str | None
    avatar: str | None
    created_at: datetime
    project_count: int = 0


# --- Label ---

class LabelCreate(BaseModel):
    name: str
    color: str = "#5e6ad2"


class LabelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    name: str
    color: str
    created_at: datetime


# --- Project ---

class ProjectCreate(BaseModel):
    name: str = Field(description="Project name")
    description: str | None = Field(None, description="Optional project description")


class ProjectUpdate(BaseModel):
    name: str | None = Field(None, description="New project name")
    description: str | None = Field(None, description="New project description")
    status: Literal["active", "archived"] | None = Field(None, description="Project status: 'active' or 'archived'")


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
    tasks: list["TaskOut"] = []
    labels: list[LabelOut] = []
    cycles: list["CycleOut"] = []
    identities: list[IdentityOut] = []


# --- Task ---

class TaskCreate(BaseModel):
    title: str = Field(description="Task title")
    description: str | None = Field(None, description="Optional task description")
    priority: Literal["low", "medium", "high"] = Field("medium", description="Task priority: low, medium, or high")
    assignee: str | None = Field(None, description="Name of the person assigned to this task")
    start_date: datetime | None = Field(None, description="Task start date (ISO 8601)")
    due_date: datetime | None = Field(None, description="Task due date (ISO 8601)")
    parent_id: str | None = Field(None, description="Parent task ID for subtasks")


class TaskUpdate(BaseModel):
    title: str | None = Field(None, description="New task title")
    description: str | None = Field(None, description="New task description")
    status: Literal["todo", "in_progress", "done", "failed"] | None = Field(None, description="Task status: todo, in_progress, done, or failed")
    priority: Literal["low", "medium", "high"] | None = Field(None, description="Task priority: low, medium, or high")
    assignee: str | None = Field(None, description="Name of the person assigned to this task")
    start_date: datetime | None = Field(None, description="Task start date (ISO 8601)")
    due_date: datetime | None = Field(None, description="Task due date (ISO 8601)")
    parent_id: str | None = Field(None, description="Parent task ID for subtasks")


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    parent_id: str | None = None
    title: str
    description: str | None
    status: str
    priority: str
    assignee: str | None = None
    callback_token: str
    start_date: datetime | None
    due_date: datetime | None
    created_at: datetime
    updated_at: datetime
    labels: list[LabelOut] = []
    subtask_count: int = 0


# --- Cycle ---

class CycleCreate(BaseModel):
    name: str
    description: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    status: Literal["draft", "active", "completed"] = "draft"


class CycleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    status: Literal["draft", "active", "completed"] | None = None


class CycleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    name: str
    description: str | None
    start_date: datetime | None
    end_date: datetime | None
    status: str
    created_at: datetime
    updated_at: datetime
    task_ids: list[str] = []
    total_tasks: int = 0
    done_tasks: int = 0


# --- Webhook callback ---

class WebhookCallback(BaseModel):
    status: Literal["todo", "in_progress", "done", "failed"] = Field(description="New task status from CI/CD pipeline")
    message: str | None = Field(None, description="Optional status message from CI/CD pipeline")


# --- Integration ---

class IntegrationCreate(BaseModel):
    name: str
    type: Literal["jenkins", "drone", "generic", "email"]
    url: str = ""
    secret: str | None = None
    project_id: str | None = None
    events: list[str] = ["task.done", "task.failed", "project.complete"]
    active: bool = True
    email_to: str | None = None
    email_subject_prefix: str | None = "[TODO Platform]"


class IntegrationUpdate(BaseModel):
    name: str | None = None
    type: Literal["jenkins", "drone", "generic", "email"] | None = None
    url: str | None = None
    secret: str | None = None
    project_id: str | None = None
    events: list[str] | None = None
    active: bool | None = None
    email_to: str | None = None
    email_subject_prefix: str | None = None


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
    email_to: str | None = None
    email_subject_prefix: str | None = None
    smtp_warning: str | None = None


# --- API Key ---

class ApiKeyCreate(BaseModel):
    name: str
    project_id: str | None = None
    scopes: list[Literal["read", "write", "admin"]] = ["read", "write"]


class ApiKeyUpdate(BaseModel):
    name: str | None = None
    project_id: str | None = None
    scopes: list[Literal["read", "write", "admin"]] | None = None
    active: bool | None = None


class ApiKeyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    key: str
    project_id: str | None
    scopes: list[str]
    active: bool
    last_used_at: datetime | None
    created_at: datetime


# --- Activity Log ---

class ActivityLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str | None
    task_id: str | None
    action: str
    actor: str | None
    detail: str | None
    meta: dict | None = None
    created_at: datetime


# --- External API response schemas ---

class ProjectStatsOut(BaseModel):
    project_id: str
    project_name: str
    total_tasks: int
    done_tasks: int
    progress: float = Field(description="Completion percentage (0-100)")
    by_status: dict[str, int] = Field(description="Task count grouped by status")
    by_priority: dict[str, int] = Field(description="Task count grouped by priority")
    overdue_tasks: int = Field(description="Number of tasks past due date that are not done/failed")


class EmailStatusOut(BaseModel):
    configured: bool = Field(description="Whether SMTP is configured")
    smtp_host: str | None
    smtp_port: int
    smtp_from: str | None


class EmailSendRequest(BaseModel):
    to: list[str] = Field(description="List of recipient email addresses")
    subject: str = Field(description="Email subject line")
    body: str = Field(description="Email body content")
    html: bool = Field(False, description="If true, body is treated as HTML; otherwise plain text")


class EmailSendOut(BaseModel):
    success: bool
    recipients: list[str]


class ActiveTaskSummary(BaseModel):
    id: str
    title: str
    status: str
    priority: str
    assignee: str | None
    due_date: str | None


class ProjectSummaryItem(BaseModel):
    id: str
    name: str
    status: str
    progress: str = Field(description="Completion percentage as string, e.g. '75.0%'")
    total_tasks: int
    done: int
    in_progress: int
    failed: int
    overdue: int
    next_due: str | None = Field(description="ISO 8601 date of next upcoming deadline")
    assignees: list[str]
    active_tasks: list[ActiveTaskSummary]


class IdentitySummaryItem(BaseModel):
    id: str
    name: str
    color: str
    avatar: str | None
    total_tasks: int
    done: int
    in_progress: int
    overdue: int
    projects: list[dict]


class ActivitySummaryItem(BaseModel):
    action: str
    detail: str | None
    actor: str | None
    when: str = Field(description="Human-readable time ago string, e.g. '5m ago'")
    timestamp: str | None


class SummaryOut(BaseModel):
    timestamp: str = Field(description="ISO 8601 timestamp of when this summary was generated")
    total_projects: int
    active_projects: int
    total_tasks: int
    total_done: int
    overall_progress: str = Field(description="Overall completion percentage as string, e.g. '60.0%'")
    overdue_tasks: int
    identities: list[IdentitySummaryItem]
    projects: list[ProjectSummaryItem]
    recent_activity: list[ActivitySummaryItem]


class ActivityEntryOut(BaseModel):
    id: str
    project_id: str | None
    task_id: str | None
    action: str
    actor: str | None
    detail: str | None
    meta: dict | None
    created_at: str | None
