import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, Boolean, DateTime, ForeignKey, JSON, Enum as SAEnum, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


def now_utc():
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(SAEnum("active", "archived", name="project_status"), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="project", cascade="all, delete-orphan",
                                               foreign_keys="Task.project_id")
    labels: Mapped[list["Label"]] = relationship("Label", back_populates="project", cascade="all, delete-orphan")
    cycles: Mapped[list["Cycle"]] = relationship("Cycle", back_populates="project", cascade="all, delete-orphan")
    project_identities: Mapped[list["ProjectIdentity"]] = relationship("ProjectIdentity", back_populates="project",
                                                                        cascade="all, delete-orphan")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        SAEnum("todo", "in_progress", "done", "failed", name="task_status"), default="todo"
    )
    priority: Mapped[str] = mapped_column(
        SAEnum("low", "medium", "high", name="task_priority"), default="medium"
    )
    callback_token: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid.uuid4()))
    assignee: Mapped[str | None] = mapped_column(String(255), nullable=True)
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    project: Mapped["Project"] = relationship("Project", back_populates="tasks", foreign_keys=[project_id])
    subtasks: Mapped[list["Task"]] = relationship("Task", back_populates="parent",
                                                   cascade="all, delete-orphan", foreign_keys="Task.parent_id")
    parent: Mapped["Task | None"] = relationship("Task", back_populates="subtasks",
                                                  remote_side="Task.id", foreign_keys="Task.parent_id")
    task_labels: Mapped[list["TaskLabel"]] = relationship("TaskLabel", back_populates="task",
                                                           cascade="all, delete-orphan")
    cycle_tasks: Mapped[list["CycleTask"]] = relationship("CycleTask", back_populates="task",
                                                           cascade="all, delete-orphan")


class Label(Base):
    __tablename__ = "labels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#5e6ad2")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    project: Mapped["Project"] = relationship("Project", back_populates="labels")
    task_labels: Mapped[list["TaskLabel"]] = relationship("TaskLabel", back_populates="label",
                                                           cascade="all, delete-orphan")


class TaskLabel(Base):
    __tablename__ = "task_labels"

    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    label_id: Mapped[str] = mapped_column(String(36), ForeignKey("labels.id", ondelete="CASCADE"), primary_key=True)

    task: Mapped["Task"] = relationship("Task", back_populates="task_labels")
    label: Mapped["Label"] = relationship("Label", back_populates="task_labels")


class Cycle(Base):
    __tablename__ = "cycles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(
        SAEnum("draft", "active", "completed", name="cycle_status"), default="draft"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    project: Mapped["Project"] = relationship("Project", back_populates="cycles")
    cycle_tasks: Mapped[list["CycleTask"]] = relationship("CycleTask", back_populates="cycle",
                                                           cascade="all, delete-orphan")


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
    type: Mapped[str] = mapped_column(SAEnum("jenkins", "drone", "generic", "email", name="integration_type"), nullable=False)
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    project_identities: Mapped[list["ProjectIdentity"]] = relationship("ProjectIdentity", back_populates="identity",
                                                                        cascade="all, delete-orphan")


class ProjectIdentity(Base):
    __tablename__ = "project_identities"

    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    identity_id: Mapped[str] = mapped_column(String(36), ForeignKey("identities.id", ondelete="CASCADE"), primary_key=True)

    project: Mapped["Project"] = relationship("Project", back_populates="project_identities")
    identity: Mapped["Identity"] = relationship("Identity", back_populates="project_identities")


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    task_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(50), nullable=False)  # task.created, task.status_changed, task.deleted, project.created, project.archived, ...
    actor: Mapped[str | None] = mapped_column(String(255), nullable=True)  # who did it (assignee, "api", "webhook", "system")
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)  # human-readable description
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # machine-readable context (old_status, new_status, etc.)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # null = access all projects
    scopes: Mapped[list] = mapped_column(JSON, default=lambda: ["read", "write"])  # read, write, admin
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
