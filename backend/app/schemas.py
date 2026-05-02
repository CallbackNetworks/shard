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
    share_token: str | None = None
    share_pin_set: bool = False
    share_expires_at: datetime | None = None
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
    time_estimate: int | None = Field(None, ge=0, description="Estimated time in minutes")
    time_spent: int | None = Field(None, ge=0, description="Time spent in minutes")


class TaskUpdate(BaseModel):
    title: str | None = Field(None, description="New task title")
    description: str | None = Field(None, description="New task description")
    status: Literal["todo", "in_progress", "done", "failed"] | None = Field(None, description="Task status: todo, in_progress, done, or failed")
    priority: Literal["low", "medium", "high"] | None = Field(None, description="Task priority: low, medium, or high")
    assignee: str | None = Field(None, description="Name of the person assigned to this task")
    start_date: datetime | None = Field(None, description="Task start date (ISO 8601)")
    due_date: datetime | None = Field(None, description="Task due date (ISO 8601)")
    parent_id: str | None = Field(None, description="Parent task ID for subtasks")
    time_estimate: int | None = Field(None, ge=0, description="Estimated time in minutes")
    time_spent: int | None = Field(None, ge=0, description="Time spent in minutes")


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
    time_estimate: int | None = None
    time_spent: int | None = None
    created_at: datetime
    updated_at: datetime
    labels: list[LabelOut] = []
    subtask_count: int = 0
    comment_count: int = 0
    blocked_by: list[str] = []   # task IDs this task depends on (must complete first)
    blocking: list[str] = []     # task IDs that depend on this task
    recurrence: "RecurrenceRuleOut | None" = None


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
    type: Literal["jenkins", "drone", "generic", "email", "webhook"]
    url: str = ""
    secret: str | None = None
    project_id: str | None = None
    events: list[str] = ["task.done", "task.failed", "project.complete"]
    active: bool = True
    email_to: str | None = None
    email_subject_prefix: str | None = "[TODO Platform]"


class IntegrationUpdate(BaseModel):
    name: str | None = None
    type: Literal["jenkins", "drone", "generic", "email", "webhook"] | None = None
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


# --- Comment ---

class CommentCreate(BaseModel):
    author: str | None = Field(None, description="Author name (optional)")
    body: str = Field(description="Comment body (supports Markdown)")


class CommentUpdate(BaseModel):
    body: str = Field(description="Updated comment body")


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    task_id: str
    project_id: str | None
    author: str | None
    body: str
    created_at: datetime
    updated_at: datetime


# --- Recurrence ---

class RecurrenceRuleCreate(BaseModel):
    frequency: Literal["daily", "weekly", "monthly", "interval"]
    interval_value: int = Field(1, ge=1, description="Every N days (used when frequency=interval)")
    day_of_week: int | None = Field(None, ge=0, le=6, description="0=Mon…6=Sun (weekly only)")
    day_of_month: int | None = Field(None, ge=1, le=31, description="Day of month (monthly only)")
    next_run_at: datetime = Field(description="When to first spawn the next task")
    end_date: datetime | None = None
    active: bool = True


class RecurrenceRuleUpdate(BaseModel):
    frequency: Literal["daily", "weekly", "monthly", "interval"] | None = None
    interval_value: int | None = Field(None, ge=1)
    day_of_week: int | None = Field(None, ge=0, le=6)
    day_of_month: int | None = Field(None, ge=1, le=31)
    next_run_at: datetime | None = None
    end_date: datetime | None = None
    active: bool | None = None


class RecurrenceRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    template_task_id: str
    frequency: str
    interval_value: int
    day_of_week: int | None
    day_of_month: int | None
    next_run_at: datetime
    last_run_at: datetime | None
    end_date: datetime | None
    active: bool
    created_at: datetime


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


# --- Assistant ---

class AssistantMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    role: str
    content: str
    tool_calls: list | None = None
    created_at: datetime


class AssistantConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[AssistantMessageOut] = []


class AssistantConversationSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    created_at: datetime
    updated_at: datetime


class AssistantSendMessage(BaseModel):
    content: str


# --- Attachment ---

class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    task_id: str
    project_id: str
    filename: str
    content_type: str
    size: int
    created_at: datetime


# --- Task Templates ---

class TaskTemplateCreate(BaseModel):
    name: str
    description: str | None = None
    priority: Literal["low", "medium", "high"] = "medium"
    subtasks: list[dict] = []
    label_names: list[str] = []
    project_id: str | None = None


class TaskTemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    priority: Literal["low", "medium", "high"] | None = None
    subtasks: list[dict] | None = None
    label_names: list[str] | None = None
    project_id: str | None = None


class TaskTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None
    priority: str
    subtasks: list[dict]
    label_names: list[str]
    project_id: str | None
    created_at: datetime


# --- Workflow Rules ---

class WorkflowCondition(BaseModel):
    field: str  # priority, status, title_contains, has_label, assignee
    op: str     # eq, neq, contains, in
    value: str | list[str]


class WorkflowAction(BaseModel):
    type: str   # set_status, set_priority, set_assignee, add_label, remove_label, add_comment, fire_event
    value: str


class WorkflowRuleCreate(BaseModel):
    name: str
    project_id: str | None = None
    trigger: Literal[
        "task.created",
        "task.status_changed",
        "task.label_added",
        "task.priority_changed"
    ]
    conditions: list[WorkflowCondition] = []
    actions: list[WorkflowAction] = Field(min_length=1)
    active: bool = True


class WorkflowRuleUpdate(BaseModel):
    name: str | None = None
    project_id: str | None = None
    trigger: str | None = None
    conditions: list[WorkflowCondition] | None = None
    actions: list[WorkflowAction] | None = None
    active: bool | None = None


class WorkflowRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    project_id: str | None
    trigger: str
    conditions: list
    actions: list
    active: bool
    run_count: int
    last_run_at: datetime | None
    created_at: datetime


# --- Webhook Delivery ---

class WebhookDeliveryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    integration_id: str
    event: str
    payload: dict
    request_url: str
    request_headers: dict
    attempt: int
    status: str
    status_code: int | None
    response_body: str | None
    error: str | None
    next_retry_at: datetime | None
    delivered_at: datetime | None
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
