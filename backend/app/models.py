import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def now_utc():
    return datetime.now(UTC)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(SAEnum("active", "archived", name="project_status"), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)
    share_token: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid.uuid4()))
    share_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    allow_guest_notes: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    agent_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    repo_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    wip_limits: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # {"todo": N, "in_progress": N, ...}

    # Task containment lives in graph ``contains`` edges now (ADR-0032); there is no
    # ``Project.tasks`` relationship. Deletion of contained tasks is handled by
    # ``graph.delete_project_and_tasks``.
    # Labels are node-only (ADR-0033 Phase B): a label is a ``Node(type="label")``
    # scoped to this project by a ``contains`` edge; use ``graph.labels_in_project``.
    cycles: Mapped[list["Cycle"]] = relationship("Cycle", back_populates="project", cascade="all, delete-orphan")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        SAEnum("todo", "in_progress", "done", "failed", name="task_status"), default="todo", index=True
    )
    priority: Mapped[str] = mapped_column(SAEnum("low", "medium", "high", name="task_priority"), default="medium")
    callback_token: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid.uuid4()))
    webhook_secret: Mapped[str | None] = mapped_column(String(128), nullable=True)
    assignee: Mapped[str | None] = mapped_column(String(255), nullable=True)
    assigned_agent_key_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True
    )
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    time_estimate: Mapped[int | None] = mapped_column(Integer, nullable=True)  # minutes
    time_spent: Mapped[int | None] = mapped_column(Integer, nullable=True)  # minutes
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    progress_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    agent_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_provider: Mapped[str | None] = mapped_column(String(20), nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    external_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    external_repo: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    # Containment (project and parent task) lives in graph ``contains`` edges now
    # (ADR-0032); there are no project/parent/subtasks relationships.
    comments: Mapped[list["Comment"]] = relationship("Comment", back_populates="task", cascade="all, delete-orphan")
    assigned_agent: Mapped["ApiKey | None"] = relationship("ApiKey", foreign_keys=[assigned_agent_key_id])
    pull_requests: Mapped[list["TaskPullRequest"]] = relationship(
        "TaskPullRequest", back_populates="task", cascade="all, delete-orphan"
    )

    def __init__(self, **kw):
        # ``project_id``/``parent_id`` are no longer columns (ADR-0032): accept them
        # as transient constructor hints that graph_sync turns into ``contains`` edges,
        # so callers can still write ``Task(project_id=..., parent_id=...)``.
        self._graph_project_id = kw.pop("project_id", None)
        self._graph_parent_id = kw.pop("parent_id", None)
        super().__init__(**kw)


class TaskPullRequest(Base):
    """Structured link between a task and an external pull request.

    Only lifecycle/review signals are stored — PR content (diff, review
    threads) stays external and is reached via pr_url (see ADR-0017).
    """

    __tablename__ = "task_pull_requests"
    __table_args__ = (UniqueConstraint("task_id", "repo", "pr_number", name="uq_task_pr"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False, default="github")
    repo: Mapped[str] = mapped_column(String(500), nullable=False)
    pr_number: Mapped[str] = mapped_column(String(20), nullable=False)
    pr_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    pr_title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    state: Mapped[str] = mapped_column(String(20), nullable=False, default="open")  # open / merged / closed
    # review_requested / approved / changes_requested / commented
    review_state: Mapped[str | None] = mapped_column(String(30), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    task: Mapped["Task"] = relationship("Task", back_populates="pull_requests")


# ``Label`` was collapsed to a node-only entity in ADR-0033 Phase B: a label is a
# ``Node(type="label")`` (name in ``title``; color/type/description/decision_status/
# source in ``data``) scoped to its project by a ``contains`` edge. The dedicated
# ``labels`` table was dropped; see ``services/graph.py`` label helpers.


class Cycle(Base):
    __tablename__ = "cycles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(SAEnum("draft", "active", "completed", name="cycle_status"), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    project: Mapped["Project"] = relationship("Project", back_populates="cycles")


class Integration(Base):
    __tablename__ = "integrations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False, default="generic")
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    secret: Mapped[str | None] = mapped_column(String(512), nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # null = global
    events: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    # email-specific fields
    email_to: Mapped[str | None] = mapped_column(Text, nullable=True)  # comma-separated recipients
    email_subject_prefix: Mapped[str | None] = mapped_column(String(255), nullable=True, default="[Shard]")
    # Phase 3: custom headers & auth
    custom_headers: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # {"X-Custom": "value"}
    auth_type: Mapped[str | None] = mapped_column(
        String(20), nullable=True, default="bearer"
    )  # bearer, basic, api_key, none
    auth_config: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # auth-type-specific config
    template_id: Mapped[str | None] = mapped_column(String(50), nullable=True)  # integration template used


class Identity(Base):
    __tablename__ = "identities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#5e6ad2")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar: Mapped[str | None] = mapped_column(String(10), nullable=True)  # emoji or single char
    share_token: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid.uuid4()))
    share_pin_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    share_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    allow_guest_notes: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    task_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    action: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # task.created, task.status_changed, task.deleted, project.created, project.archived, ...
    actor: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )  # who did it (assignee, "api", "webhook", "system")
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)  # human-readable description
    meta: Mapped[dict | None] = mapped_column(
        JSON, nullable=True
    )  # machine-readable context (old_status, new_status, etc.)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    key: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    key_hash: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    key_last4: Mapped[str | None] = mapped_column(String(8), nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # null = access all projects
    scopes: Mapped[list] = mapped_column(JSON, default=lambda: ["read", "write"])  # read, write, admin
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # Nullable: a comment with task_id=None is a project-level guest note
    task_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True, index=True
    )
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    author: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Set only for notes submitted by share-link visitors; None for owner/synced comments
    guest_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # External issue-comment id (GitHub/Gitea/GitLab) for bidirectional sync & echo prevention
    external_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    task: Mapped["Task"] = relationship("Task", back_populates="comments")


class RecurrenceRule(Base):
    """Defines how a template task should be cloned periodically."""

    __tablename__ = "recurrence_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    template_task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    frequency: Mapped[str] = mapped_column(
        SAEnum("daily", "weekly", "monthly", "interval", name="recurrence_frequency"), nullable=False
    )
    interval_value: Mapped[int] = mapped_column(Integer, default=1, nullable=False)  # every N days for "interval"
    day_of_week: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0-6 for weekly
    day_of_month: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-31 for monthly
    next_run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    template_task: Mapped["Task"] = relationship("Task", foreign_keys=[template_task_id])


class WebhookDelivery(Base):
    """Log of each outbound webhook dispatch attempt."""

    __tablename__ = "webhook_deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    integration_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    request_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    request_headers: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    attempt: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(
        SAEnum("pending", "success", "failed", "dead", name="delivery_status"),
        default="pending",
        nullable=False,
        index=True,
    )
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[str | None] = mapped_column(Text, nullable=True)  # first 2KB
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    integration: Mapped["Integration"] = relationship("Integration", foreign_keys=[integration_id])


class AssistantConversation(Base):
    __tablename__ = "assistant_conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="New conversation")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    messages: Mapped[list["AssistantMessage"]] = relationship(
        "AssistantMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="AssistantMessage.created_at",
    )


class AssistantMessage(Base):
    __tablename__ = "assistant_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("assistant_conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user | assistant | tool
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tool_calls: Mapped[list | None] = mapped_column(JSON, nullable=True)
    tool_call_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    conversation: Mapped["AssistantConversation"] = relationship("AssistantConversation", back_populates="messages")


class Attachment(Base):
    """File attached to a task."""

    __tablename__ = "attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[str] = mapped_column(String(36), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False, default="application/octet-stream")
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    task: Mapped["Task"] = relationship("Task", foreign_keys=[task_id])


class TaskTemplate(Base):
    """Reusable task template with optional subtask definitions."""

    __tablename__ = "task_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="medium")
    subtasks: Mapped[list] = mapped_column(JSON, default=list)  # [{"title": "...", "priority": "..."}]
    label_names: Mapped[list] = mapped_column(JSON, default=list)  # ["bug", "feature"]
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # null = global
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    link: Mapped[str | None] = mapped_column(String(512), nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    task_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)


class WebhookEvent(Base):
    """Record of each inbound CI/CD webhook received for a task (build history)."""

    __tablename__ = "webhook_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(50), nullable=False, default="generic")
    event_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    commit_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)
    branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    build_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    build_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    build_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    triggered_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    test_summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    raw_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    task: Mapped["Task"] = relationship("Task", foreign_keys=[task_id])


class SavedFilter(Base):
    """Persisted filter/view configuration for task lists."""

    __tablename__ = "saved_filters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # null = global
    filters: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)  # {status, priority, label_ids, ...}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Goal(Base):
    """High-level objective / OKR that groups multiple projects."""

    __tablename__ = "goals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        SAEnum("active", "completed", "cancelled", name="goal_status"), default="active"
    )
    target_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class UserPreference(Base):
    __tablename__ = "user_preferences"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict | list] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class Node(Base):
    """Unified graph node for first-class entities (see ADR-0032).

    Project / Task / Identity / Goal / Cycle / Label are all stored here,
    keeping their original UUIDs so peripheral tables (comments, attachments,
    activity logs) that reference those ids stay valid. Hot query fields are
    real indexed columns; type-specific long-tail fields live in ``data``.
    """

    __tablename__ = "nodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)  # project/task/identity/goal/cycle/label
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    priority: Mapped[str | None] = mapped_column(String(20), nullable=True)
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # type-specific fields not needing indexed query
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class Edge(Base):
    """Typed relationship between two nodes (see ADR-0032).

    The single relationship primitive replacing rigid container FKs
    (project_id, parent_id) and the association tables (task_dependencies,
    project_identities, goal_projects, task_labels, cycle_tasks). Canonical
    direction is source -> target; see the rel_type vocabulary in ADR-0032.
    """

    __tablename__ = "edges"
    __table_args__ = (UniqueConstraint("source_id", "target_id", "rel_type", name="uq_edge"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    source_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # contains / member_of / assigned_to / depends_on / labeled / in_cycle / part_of
    rel_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    # Relationships declared so the unit-of-work inserts referenced nodes before edges
    # (PostgreSQL enforces the FK within the flush; see graph_sync).
    source: Mapped["Node"] = relationship("Node", foreign_keys=[source_id])
    target: Mapped["Node"] = relationship("Node", foreign_keys=[target_id])


class NodeType(Base):
    """Registry of node-type vocabulary, data-driven rather than hardcoded (see ADR-0033).

    Built-in types (task/project/identity/goal/cycle/label) are seeded with
    ``is_builtin=True``; users may define their own types (stored node-only,
    pure ``Node`` + ``data``). ``key`` is the string written into ``nodes.type``.
    """

    __tablename__ = "node_types"

    key: Mapped[str] = mapped_column(String(30), primary_key=True)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(40), nullable=True)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Traversal roles (ADR-0033 A5): data-drives the leaf helpers in graph.py that
    # previously hardcoded ``n.type == NODE_TASK/PROJECT``. ``is_container`` = plays
    # the project role (its ``contains`` children that are task-like are "its tasks");
    # ``is_task_like`` = plays the task/subtask role. Seeded: project=container,
    # task=task_like. See ADR-0033.
    is_container: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_task_like: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # e.g. default hot-field hints
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class EdgeType(Base):
    """Registry of relationship (edge) vocabulary, data-driven (see ADR-0033).

    Built-in relations (contains/member_of/assigned_to/depends_on/labeled/
    in_cycle/part_of) are seeded with ``is_builtin=True``; users may invent their
    own (e.g. ``blocks``, ``relates_to``). ``is_containment`` marks the relations
    that participate in ``contains``-style traversal; ``is_symmetric`` marks
    undirected relations. ``key`` is the string written into ``edges.rel_type``.
    """

    __tablename__ = "edge_types"

    key: Mapped[str] = mapped_column(String(30), primary_key=True)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_containment: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_symmetric: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class GraphEvent(Base):
    """Append-only audit trail of graph mutations (see ADR-0033, provenance).

    Records who added/removed a node or edge and when. This is the deliberate
    audit-trail form of provenance (not bitemporal edges): live edges stay
    hard-deletable, while the event log allows reconstructing past state by
    replay if ever needed. Never updated in place; only inserted and read.
    """

    __tablename__ = "graph_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event: Mapped[str] = mapped_column(
        String(30), nullable=False, index=True
    )  # node_created/deleted, edge_added/removed
    node_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    source_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    target_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    rel_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    actor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)


class WorkflowRule(Base):
    """User-defined if-this-then-that automation rule."""

    __tablename__ = "workflow_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # null = global
    trigger: Mapped[str] = mapped_column(String(100), nullable=False)
    conditions: Mapped[list] = mapped_column(JSON, default=list)
    actions: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    run_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
