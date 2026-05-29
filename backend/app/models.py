import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
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

    tasks: Mapped[list["Task"]] = relationship(
        "Task", back_populates="project", cascade="all, delete-orphan", foreign_keys="Task.project_id"
    )
    labels: Mapped[list["Label"]] = relationship("Label", back_populates="project", cascade="all, delete-orphan")
    cycles: Mapped[list["Cycle"]] = relationship("Cycle", back_populates="project", cascade="all, delete-orphan")
    project_identities: Mapped[list["ProjectIdentity"]] = relationship(
        "ProjectIdentity", back_populates="project", cascade="all, delete-orphan"
    )


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        SAEnum("todo", "in_progress", "done", "failed", name="task_status"), default="todo", index=True
    )
    priority: Mapped[str] = mapped_column(SAEnum("low", "medium", "high", name="task_priority"), default="medium")
    callback_token: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid.uuid4()))
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    project: Mapped["Project"] = relationship("Project", back_populates="tasks", foreign_keys=[project_id])
    subtasks: Mapped[list["Task"]] = relationship(
        "Task", back_populates="parent", cascade="all, delete-orphan", foreign_keys="Task.parent_id"
    )
    parent: Mapped["Task | None"] = relationship(
        "Task", back_populates="subtasks", remote_side="Task.id", foreign_keys="Task.parent_id"
    )
    task_labels: Mapped[list["TaskLabel"]] = relationship(
        "TaskLabel", back_populates="task", cascade="all, delete-orphan"
    )
    cycle_tasks: Mapped[list["CycleTask"]] = relationship(
        "CycleTask", back_populates="task", cascade="all, delete-orphan"
    )
    comments: Mapped[list["Comment"]] = relationship("Comment", back_populates="task", cascade="all, delete-orphan")
    blocked_by_deps: Mapped[list["TaskDependency"]] = relationship(
        "TaskDependency",
        back_populates="task",
        cascade="all, delete-orphan",
        foreign_keys="TaskDependency.task_id",
    )
    blocking_deps: Mapped[list["TaskDependency"]] = relationship(
        "TaskDependency",
        back_populates="depends_on",
        cascade="all, delete-orphan",
        foreign_keys="TaskDependency.depends_on_id",
    )
    assigned_agent: Mapped["ApiKey | None"] = relationship("ApiKey", foreign_keys=[assigned_agent_key_id])


class Label(Base):
    __tablename__ = "labels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#5e6ad2")
    type: Mapped[str] = mapped_column(String(20), nullable=False, default="label")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    project: Mapped["Project"] = relationship("Project", back_populates="labels")
    task_labels: Mapped[list["TaskLabel"]] = relationship(
        "TaskLabel", back_populates="label", cascade="all, delete-orphan"
    )


class TaskLabel(Base):
    __tablename__ = "task_labels"

    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    label_id: Mapped[str] = mapped_column(String(36), ForeignKey("labels.id", ondelete="CASCADE"), primary_key=True)

    task: Mapped["Task"] = relationship("Task", back_populates="task_labels")
    label: Mapped["Label"] = relationship("Label", back_populates="task_labels")


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
    cycle_tasks: Mapped[list["CycleTask"]] = relationship(
        "CycleTask", back_populates="cycle", cascade="all, delete-orphan"
    )


class CycleTask(Base):
    __tablename__ = "cycle_tasks"

    cycle_id: Mapped[str] = mapped_column(String(36), ForeignKey("cycles.id", ondelete="CASCADE"), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)

    cycle: Mapped["Cycle"] = relationship("Cycle", back_populates="cycle_tasks")
    task: Mapped["Task"] = relationship("Task", back_populates="cycle_tasks")


class Integration(Base):
    __tablename__ = "integrations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(
        SAEnum("jenkins", "drone", "generic", "email", "webhook", name="integration_type"), nullable=False
    )
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    secret: Mapped[str | None] = mapped_column(String(512), nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # null = global
    events: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    # email-specific fields
    email_to: Mapped[str | None] = mapped_column(Text, nullable=True)  # comma-separated recipients
    email_subject_prefix: Mapped[str | None] = mapped_column(String(255), nullable=True, default="[TODO Platform]")


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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    project_identities: Mapped[list["ProjectIdentity"]] = relationship(
        "ProjectIdentity", back_populates="identity", cascade="all, delete-orphan"
    )


class ProjectIdentity(Base):
    __tablename__ = "project_identities"

    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    identity_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("identities.id", ondelete="CASCADE"), primary_key=True
    )

    project: Mapped["Project"] = relationship("Project", back_populates="project_identities")
    identity: Mapped["Identity"] = relationship("Identity", back_populates="project_identities")


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
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    author: Mapped[str | None] = mapped_column(String(255), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    task: Mapped["Task"] = relationship("Task", back_populates="comments")


class TaskDependency(Base):
    """task_id is BLOCKED BY depends_on_id (depends_on must be done first)."""

    __tablename__ = "task_dependencies"

    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    depends_on_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    task: Mapped["Task"] = relationship("Task", back_populates="blocked_by_deps", foreign_keys=[task_id])
    depends_on: Mapped["Task"] = relationship("Task", back_populates="blocking_deps", foreign_keys=[depends_on_id])


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
