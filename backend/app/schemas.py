import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# --- Identity ---


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
    allow_guest_notes: bool = False
    created_at: datetime
    project_count: int = 0


# --- Label ---


class LabelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    name: str
    color: str
    type: str = "label"
    description: str | None = None
    decision_status: str | None = None
    source: str | None = None
    created_at: datetime


# --- Project ---


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None
    status: str
    share_token: str | None = None
    share_expires_at: datetime | None = None
    allow_guest_notes: bool = False
    repo_url: str | None = None
    wip_limits: dict | None = None
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


class _TaskTitleMixin:
    @field_validator("title")
    @classmethod
    def title_not_blank(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("Title must not be blank")
        return v.strip() if v is not None else v


class TaskCreate(_TaskTitleMixin, BaseModel):
    title: str = Field(min_length=1, max_length=500, description="Task title")
    description: str | None = Field(None, description="Optional task description")
    priority: Literal["low", "medium", "high"] = Field("medium", description="Task priority: low, medium, or high")
    assignee: str | None = Field(None, description="Name of the person assigned to this task")
    assigned_agent_key_id: str | None = Field(None, description="API key ID of the agent to assign this task to")
    start_date: datetime | None = Field(None, description="Task start date (ISO 8601)")
    due_date: datetime | None = Field(None, description="Task due date (ISO 8601)")
    parent_id: str | None = Field(None, description="Parent task ID for subtasks")
    time_estimate: int | None = Field(None, ge=0, description="Estimated time in minutes")
    time_spent: int | None = Field(None, ge=0, description="Time spent in minutes")
    is_pinned: bool = False


class TaskPullRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    provider: str
    repo: str
    pr_number: str
    pr_url: str
    pr_title: str
    branch: str | None = None
    state: str
    review_state: str | None = None
    updated_at: datetime


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: str = "task"  # "task" or a user-defined task-like node type (ADR-0035)
    project_id: str | None = None  # compat: first/nearest project via contains edges (ADR-0032)
    project_ids: list[str] = []  # every literal project this task belongs to (ADR-0032)
    container_ids: list[str] = []  # every container (incl. custom types) via contains edges (ADR-0034)
    parent_id: str | None = None
    title: str
    description: str | None
    status: str
    priority: str
    assignee: str | None = None
    assigned_agent_key_id: str | None = None
    assigned_agent_name: str | None = None
    callback_token: str | None = None  # ADR-0035: task-like custom nodes may lack one
    webhook_secret: str | None = None
    start_date: datetime | None
    due_date: datetime | None
    time_estimate: int | None = None
    time_spent: int | None = None
    is_pinned: bool = False
    position: int = 0
    progress_pct: int | None = None
    agent_notes: str | None = None
    external_provider: str | None = None
    external_id: str | None = None
    external_url: str | None = None
    external_repo: str | None = None
    created_at: datetime
    updated_at: datetime
    labels: list[LabelOut] = []
    subtask_count: int = 0
    comment_count: int = 0
    blocked_by: list[str] = []  # task IDs this task depends on (must complete first)
    blocking: list[str] = []  # task IDs that depend on this task
    pull_requests: list[TaskPullRequestOut] = []
    recurrence: "RecurrenceRuleOut | None" = None


class TaskWithSubtasksOut(TaskOut):
    subtasks: list[TaskOut] = []


class TaskProgressUpdate(BaseModel):
    progress_pct: int | None = Field(None, ge=0, le=100, description="Progress percentage (0-100)")
    agent_notes: str | None = Field(None, description="Agent status notes (markdown)")
    comment: str | None = Field(None, description="Optional comment to add to the task")


# --- Cycle ---


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


class WebhookEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    task_id: str
    provider: str
    event_type: str | None
    status: str
    message: str | None
    commit_sha: str | None
    branch: str | None
    build_url: str | None
    build_number: str | None
    build_duration_ms: int | None
    triggered_by: str | None
    test_summary: dict | None
    created_at: datetime


# --- Integration ---


class IntegrationCreate(BaseModel):
    name: str
    type: Literal["jenkins", "drone", "generic", "email", "webhook", "github", "gitlab", "bitbucket", "circleci"]
    url: str = ""
    secret: str | None = None
    project_id: str | None = None
    events: list[str] = ["task.done", "task.failed", "project.complete"]
    active: bool = True
    email_to: str | None = None
    email_subject_prefix: str | None = "[Shard]"
    custom_headers: dict | None = None
    auth_type: Literal["bearer", "basic", "api_key", "none"] | None = "bearer"
    auth_config: dict | None = None
    template_id: str | None = None


class IntegrationUpdate(BaseModel):
    name: str | None = None
    type: (
        Literal["jenkins", "drone", "generic", "email", "webhook", "github", "gitlab", "bitbucket", "circleci"] | None
    ) = None
    url: str | None = None
    secret: str | None = None
    project_id: str | None = None
    events: list[str] | None = None
    active: bool | None = None
    email_to: str | None = None
    email_subject_prefix: str | None = None
    custom_headers: dict | None = None
    auth_type: Literal["bearer", "basic", "api_key", "none"] | None = None
    auth_config: dict | None = None
    template_id: str | None = None


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
    custom_headers: dict | None = None
    auth_type: str | None = None
    auth_config: dict | None = None
    template_id: str | None = None
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
    task_id: str | None
    project_id: str | None
    author: str | None
    guest_name: str | None = None
    body: str
    external_id: str | None = None
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
    key_preview: str = ""  # "tdp_****xxxx" — masked after creation
    project_id: str | None
    scopes: list[str]
    active: bool
    last_used_at: datetime | None
    created_at: datetime

    @classmethod
    def from_model(cls, m: object) -> "ApiKeyOut":
        last4 = getattr(m, "key_last4", None) or ""
        prefix = (getattr(m, "key", None) or "tdp_")[:4]
        preview = f"{prefix}_****{last4}" if last4 else "****"
        return cls(
            id=m.id,
            name=m.name,
            key_preview=preview,
            project_id=m.project_id,
            scopes=m.scopes,
            active=m.active,
            last_used_at=m.last_used_at,
            created_at=m.created_at,
        )


class ApiKeyCreateOut(ApiKeyOut):
    key: str = ""  # full key shown once at creation


# --- Agent Task Summary ---


class AgentTaskSummary(BaseModel):
    agent_id: str
    agent_name: str
    project_id: str | None
    active: bool
    last_used_at: datetime | None
    task_counts: dict  # {"todo": N, "in_progress": N, "done": N, "failed": N}
    tasks: list[TaskOut] = []


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


class ReorderRequest(BaseModel):
    task_ids: list[str]


# --- Notifications ---


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: str
    message: str
    read: bool
    link: str | None
    project_id: str | None
    task_id: str | None
    created_at: datetime


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


def _reject_unknown(name: str, value: str, allowed: set[str]) -> str:
    if value not in allowed:
        raise ValueError(f"unknown {name} {value!r}; expected one of {', '.join(sorted(allowed))}")
    return value


class WorkflowCondition(BaseModel):
    field: str
    op: str
    value: str | list[str]

    # The engine treats an unknown field or op as "condition not met" and says nothing,
    # so a typo produces a rule that looks fine and never fires. Reject it on write.
    # Imported lazily: the engine pulls in the service layer, which imports this module.
    @field_validator("field")
    @classmethod
    def _known_field(cls, v: str) -> str:
        from app.services.rules_engine import CONDITION_FIELDS

        return _reject_unknown("condition field", v, CONDITION_FIELDS)

    @field_validator("op")
    @classmethod
    def _known_op(cls, v: str) -> str:
        from app.services.rules_engine import CONDITION_OPS

        return _reject_unknown("condition op", v, CONDITION_OPS)


class WorkflowAction(BaseModel):
    type: str
    value: str

    @field_validator("type")
    @classmethod
    def _known_type(cls, v: str) -> str:
        from app.services.rules_engine import ACTION_TYPES

        return _reject_unknown("action type", v, ACTION_TYPES)


def _check_trigger(v: str | None) -> str | None:
    from app.services.rules_engine import SUPPORTED_TRIGGERS

    return v if v is None else _reject_unknown("trigger", v, SUPPORTED_TRIGGERS)


class WorkflowRuleCreate(BaseModel):
    name: str
    project_id: str | None = None
    trigger: str
    conditions: list[WorkflowCondition] = []
    actions: list[WorkflowAction] = Field(min_length=1)
    active: bool = True

    @field_validator("trigger")
    @classmethod
    def _known_trigger(cls, v: str) -> str:
        return _check_trigger(v)


class WorkflowRuleUpdate(BaseModel):
    name: str | None = None
    project_id: str | None = None
    trigger: str | None = None

    @field_validator("trigger")
    @classmethod
    def _known_trigger(cls, v: str | None) -> str | None:
        return _check_trigger(v)

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
    todo: int = 0
    overdue: int
    next_due: str | None = Field(description="ISO 8601 date of next upcoming deadline")
    assignees: list[str]
    active_tasks: list[ActiveTaskSummary]
    todo_tasks: list[ActiveTaskSummary] = []


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


class AgentProjectTaskInfo(BaseModel):
    id: str
    title: str
    status: str
    priority: str
    due_date: datetime | None = None


class AgentProjectInfo(BaseModel):
    id: str
    name: str
    status: str
    repo_url: str | None = None
    agent_instructions: str | None = None
    label_names: list[str] = []
    active_tasks: list[AgentProjectTaskInfo] = []


class AgentContextOut(BaseModel):
    platform: str = "Shard"
    version: str = "1.0.0"
    capabilities: list[str]
    instructions: str | None = Field(None, description="Global agent instructions from platform config")
    conventions: dict
    projects: list[AgentProjectInfo]
    quick_start: str


class ActivityEntryOut(BaseModel):
    id: str
    project_id: str | None
    task_id: str | None
    action: str
    actor: str | None
    detail: str | None
    meta: dict | None
    created_at: str | None


# --- Saved Filters ---


class SavedFilterCreate(BaseModel):
    name: str
    project_id: str | None = None
    filters: dict = Field(
        description="Filter criteria: {status[], priority[], label_ids[], assignee, due_before, due_after}"
    )


class SavedFilterUpdate(BaseModel):
    name: str | None = None
    filters: dict | None = None


class SavedFilterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    project_id: str | None
    filters: dict
    created_at: datetime


# --- Goals / OKR ---


class GoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    description: str | None
    status: str
    target_date: datetime | None
    created_at: datetime
    updated_at: datetime
    projects: list["GoalProjectOut"] = []
    progress: float = 0.0


class GoalProjectOut(BaseModel):
    project_id: str
    project_name: str
    progress: float = 0.0


# --- Bulk Actions ---


class BulkTaskUpdate(BaseModel):
    task_ids: list[str] = Field(min_length=1)
    status: Literal["todo", "in_progress", "done", "failed"] | None = None
    priority: Literal["low", "medium", "high"] | None = None
    assignee: str | None = None
    add_label_ids: list[str] = []
    remove_label_ids: list[str] = []
    is_pinned: bool | None = None


class BulkActionResult(BaseModel):
    updated: int
    task_ids: list[str]


# --- Import/Export ---


class TaskImportItem(_TaskTitleMixin, BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str | None = None
    status: Literal["todo", "in_progress", "done", "failed"] = "todo"
    priority: Literal["low", "medium", "high"] = "medium"
    assignee: str | None = None
    due_date: datetime | None = None
    start_date: datetime | None = None
    time_estimate: int | None = None
    time_spent: int | None = None
    subtasks: list["TaskImportItem"] = []


class TaskImportRequest(BaseModel):
    tasks: list[TaskImportItem]


class TaskImportResult(BaseModel):
    imported: int
    task_ids: list[str]


# --- Identity Hub Stats ---


class IdentityHubProject(BaseModel):
    id: str
    name: str
    status: str
    total_tasks: int = 0
    done: int = 0
    in_progress: int = 0
    todo: int = 0
    failed: int = 0
    overdue: int = 0


class IdentityHubDailyActivity(BaseModel):
    date: str
    count: int


class IdentityHubItem(BaseModel):
    id: str
    name: str
    color: str
    avatar: str | None
    total_tasks: int = 0
    done: int = 0
    in_progress: int = 0
    todo: int = 0
    failed: int = 0
    overdue: int = 0
    projects: list[IdentityHubProject] = []
    daily_activity: list[IdentityHubDailyActivity] = []


class IdentityHubTotals(BaseModel):
    total_tasks: int = 0
    done: int = 0
    in_progress: int = 0
    todo: int = 0
    failed: int = 0
    overdue: int = 0


class IdentityHubOut(BaseModel):
    identities: list[IdentityHubItem]
    totals: IdentityHubTotals


# --- Graph type registries (ADR-0033) ---


def _validate_type_key(value: str) -> str:
    key = value.strip().lower()
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,29}", key):
        raise ValueError("key must be 1-30 chars, lowercase letter first, then letters/digits/underscore")
    return key


class NodeTypeCreate(BaseModel):
    key: str
    label: str
    icon: str | None = None
    color: str | None = None
    # ADR-0040: capabilities are a roles set (container/task/shareable/subscribable),
    # replacing the four former booleans.
    roles: list[str] | None = None
    data: dict | None = None

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        return _validate_type_key(v)


class NodeTypeUpdate(BaseModel):
    label: str | None = None
    icon: str | None = None
    color: str | None = None
    # ADR-0040: ``roles`` replaces the set outright. Built-in types reject container/
    # task changes (router guard).
    roles: list[str] | None = None
    data: dict | None = None


class NodeTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    label: str
    icon: str | None = None
    color: str | None = None
    is_builtin: bool
    roles: list[str] = []
    data: dict | None = None
    usage_count: int = 0

    @field_validator("roles", mode="before")
    @classmethod
    def _roles_default(cls, v):
        return v or []


class EdgeTypeCreate(BaseModel):
    key: str
    label: str
    is_containment: bool = False
    is_symmetric: bool = False
    data: dict | None = None

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        return _validate_type_key(v)


class EdgeTypeUpdate(BaseModel):
    label: str | None = None
    is_containment: bool | None = None
    is_symmetric: bool | None = None
    data: dict | None = None


class EdgeTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    label: str
    is_builtin: bool
    is_containment: bool
    is_symmetric: bool
    data: dict | None = None
    usage_count: int = 0


# --- Generic graph nodes / edges (ADR-0033) ---


class NodeCreate(BaseModel):
    # Extra fields are allowed and folded into ``data`` by the endpoint (ADR-0040):
    # a task written here may carry description/assignee/... flat, like the retired
    # TaskCreate surface, without enumerating every task-role field here.
    model_config = ConfigDict(extra="allow")

    type: str
    title: str = ""
    status: str | None = None
    priority: str | None = None
    start_date: datetime | None = None
    due_date: datetime | None = None
    position: int = 0
    is_pinned: bool = False
    data: dict | None = None
    # ADR-0040 single write surface: optional containment established atomically on
    # create. ``container_id`` files the node under a container (project/custom) and
    # ``parent_id`` under a parent task — both as ``contains`` edges.
    container_id: str | None = None
    parent_id: str | None = None


class NodeUpdate(BaseModel):
    # Extra fields fold into ``data`` (ADR-0040), mirroring NodeCreate.
    model_config = ConfigDict(extra="allow")

    title: str | None = None
    status: str | None = None
    priority: str | None = None
    start_date: datetime | None = None
    due_date: datetime | None = None
    position: int | None = None
    is_pinned: bool | None = None
    data: dict | None = None
    # ADR-0040: re-parenting a task is a graph move (swap the incoming task->task
    # ``contains`` edge), not a column write.
    parent_id: str | None = None


class NodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: str
    title: str
    status: str | None = None
    priority: str | None = None
    start_date: datetime | None = None
    due_date: datetime | None = None
    position: int = 0
    is_pinned: bool = False
    data: dict | None = None
    created_at: datetime
    updated_at: datetime


class NodeRef(BaseModel):
    """Lightweight summary of an edge endpoint, embedded to spare clients an N+1."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    type: str
    title: str
    status: str | None = None


class EdgeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_id: str
    target_id: str
    rel_type: str
    position: int = 0
    data: dict | None = None
    created_at: datetime
    source: NodeRef | None = None
    target: NodeRef | None = None


class EdgeCreate(BaseModel):
    target_id: str
    rel_type: str
    position: int = 0
    data: dict | None = None


class GraphEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event: str
    node_id: str | None = None
    source_id: str | None = None
    target_id: str | None = None
    rel_type: str | None = None
    actor: str | None = None
    data: dict | None = None
    created_at: datetime
