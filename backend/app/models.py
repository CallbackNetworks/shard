import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def now_utc():
    return datetime.now(UTC)


# ``Project`` was collapsed to a node-only entity in ADR-0033 Phase B (B6) — the last
# entity-backed type. A project is a ``Node(type="project")``: ``title`` = name and
# ``status`` are real hot columns; description/share_token/share_expires_at/
# allow_guest_notes/agent_instructions/repo_url/wip_limits live in the node's JSON
# ``data`` bag. Containment (tasks/labels/cycles) is expressed as ``contains`` edges
# and identity membership as ``owns`` edges. The dedicated ``projects`` table
# was dropped; reads go through ``graph.ProjectView`` and writes through
# ``graph.create_project``/``update_project``. With B6 done the graph mirror
# (``graph_sync``) was retired — every first-class entity is now node-only.


# ``Task`` was collapsed to a node-only entity in ADR-0033 Phase B (B5): a task is a
# ``Node(type="task")`` — hot columns (title/status/priority/start_date/due_date/
# position/is_pinned/created_at/updated_at) are real node columns; everything else
# (description/callback_token/webhook_secret/assignee/assigned_agent_key_id/
# reminder_sent_at/time_estimate/time_spent/progress_pct/agent_notes/external_*)
# lives in the node's JSON ``data`` bag. Containment (project/parent) is expressed
# purely as ``contains`` edges. The dedicated ``tasks`` table was dropped; reads go
# through ``graph.TaskView`` and writes through ``graph.create_task``/``update_task``.


class TaskPullRequest(Base):
    """Structured link between a task and an external pull request.

    Only lifecycle/review signals are stored — PR content (diff, review
    threads) stays external and is reached via pr_url (see ADR-0017).
    """

    __tablename__ = "task_pull_requests"
    __table_args__ = (UniqueConstraint("task_id", "repo", "pr_number", name="uq_task_pr"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True
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


# ``Label`` was collapsed to a node-only entity in ADR-0033 Phase B: a label is a
# ``Node(type="label")`` (name in ``title``; color/description/source in ``data``)
# scoped to its project by a ``contains`` edge. The dedicated ``labels`` table was
# dropped; see ``services/graph/labels.py``.
#
# A decision record used to be one of these, wearing ``data.type="decision"`` (ADR-0004).
# It is ``Node(type="decision")`` since ADR-0118, with ``supersedes``/``governs`` edges of
# its own; see ``services/graph/decision_records.py``.


# ``Cycle`` was collapsed to a node-only entity in ADR-0033 Phase B: a cycle is a
# ``Node(type="cycle")`` (name in ``title``; status/start_date real columns;
# end_date -> node ``due_date``; description in ``data``) scoped to its project by
# a ``contains`` edge. The dedicated ``cycles`` table was dropped; see the cycle
# helpers in ``services/graph.py``.


class Integration(Base):
    __tablename__ = "integrations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False, default="generic")
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    secret: Mapped[str | None] = mapped_column(String(512), nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # null = global
    events: Mapped[list] = mapped_column(JSON, default=list)
    # Which causes to accept (see NOTIFICATION_SOURCES). Null or empty means every
    # source, so integrations written before ADR-0048 keep their behaviour.
    sources: Mapped[list | None] = mapped_column(JSON, nullable=True)
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


# ``Identity`` was collapsed to a node-only entity in ADR-0033 Phase B: an identity
# is a ``Node(type="identity")`` (name in ``title``; color/description/avatar/
# share_token/share_pin_hash/share_expires_at/allow_guest_notes in ``data``).
# Identities are top-level (not project-scoped); the containers they own attach via
# ``owns`` edges (ADR-0078 — never ``contains``, which is where a node lives, not
# whose it is). The dedicated ``identities`` table was dropped; see the identity
# helpers in ``services/graph.py``.


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


class ActivityWatch(Base):
    """A curve a user registered on the activity ticker (ADR-0105).

    ``kind="node"`` watches one node's own activity (``target_id``); ``kind="node_type"``
    watches every node of a type (``target_type``). No column is added to ``activity_logs``
    itself — matching resolves against the live ``nodes`` table at read time, the same
    choice ``share_view_count`` made for its multi-key match (services/activity.py).
    """

    __tablename__ = "activity_watches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # "node" | "node_type"
    target_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    target_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # No plaintext column. Keys are matched by `key_hash` alone (external_api/auth.py),
    # and the raw value is shown once at creation and never stored — the `key` column
    # that used to sit here was already unused by every code path and NULL for every
    # key issued since hashing landed, but a column that can hold a credential is a
    # place one can come back.
    key_hash: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    key_last4: Mapped[str | None] = mapped_column(String(8), nullable=True)
    container_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # null = access everything;
    # otherwise a project or identity node (ADR-0107) — anything in its `contains` subtree
    scopes: Mapped[list] = mapped_column(JSON, default=lambda: ["read", "write"])  # read, write, admin
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # Nullable: a comment with task_id=None is a project-level guest note
    task_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=True, index=True
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


class RecurrenceRule(Base):
    """Defines how a template task should be cloned periodically."""

    __tablename__ = "recurrence_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    template_task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("nodes.id", ondelete="CASCADE"), unique=True, nullable=False
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
    # Token counts from the provider's own response (ADR-0100), null when the provider
    # didn't report them (StubProvider, or a row written before this column existed) —
    # never 0, which would misreport as "this reply cost nothing."
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    conversation: Mapped["AssistantConversation"] = relationship("AssistantConversation", back_populates="messages")


class ShareChatLog(Base):
    """One exchange with the public read-only Q&A assistant on a share page (ADR-0098).

    Deliberately not a row in ``AssistantConversation``/``AssistantMessage``: those model
    a stateful, owner-identified conversation thread, and an anonymous visitor's one-off
    exchange shares no real invariant with that besides "involves an LLM" — mixing them
    would mean every owner-facing conversation query needs a permanent filter. A flat log
    matches this app's existing shape for this kind of thing (``ActivityLog``,
    ``WebhookDelivery``): one row per event, queried by the node it happened on.
    """

    __tablename__ = "share_chat_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    node_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    ip_hash: Mapped[str] = mapped_column(String(32), nullable=False)
    # Same rule as AssistantMessage's columns (ADR-0100): null means unreported, not free.
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Attachment(Base):
    """File attached to a task."""

    __tablename__ = "attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[str] = mapped_column(String(36), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False, default="application/octet-stream")
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


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
        String(36), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True
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
    # SHA-256 of the inbound signature, for replay detection. Only body-bound schemes
    # produce one (GitHub / generic HMAC), so GitLab-token and pre-existing rows are
    # NULL and simply never match — absence must not look like a duplicate.
    signature_digest: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class SavedFilter(Base):
    """Persisted filter/view configuration for task lists."""

    __tablename__ = "saved_filters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # null = global
    filters: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)  # {status, priority, label_ids, ...}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


# ``Goal`` was collapsed to a node-only entity in ADR-0033 Phase B: a goal is a
# ``Node(type="goal")`` (title in ``title``; status a real column; target_date ->
# node ``due_date``; description in ``data``). A goal plays the ``container`` role
# (ADR-0041): the projects and tasks it groups are its outgoing ``contains``
# children (replacing the retired ``part_of`` edge). The dedicated ``goals`` table
# was dropped; see the goal helpers in ``services/graph.py``.


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
    __table_args__ = (
        UniqueConstraint("source_id", "target_id", "rel_type", name="uq_edge"),
        # The two hottest queries in the system are "who contains this" (parents_of,
        # ancestors_of, every access check) and "what does this contain"
        # (descendants_of, every rollup). Both filter on a node id *and* rel_type.
        # uq_edge leads with source_id so it cannot serve the target-side lookup at
        # all, and neither single-column index can avoid re-filtering by rel_type.
        Index("ix_edge_target_rel", "target_id", "rel_type"),
        Index("ix_edge_source_rel", "source_id", "rel_type"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    source_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # contains / owns / depends_on / labeled / in_cycle (what may sit at each end
    # of a given rel_type is declared on EdgeType and enforced in add_edge, ADR-0078)
    rel_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    # Relationships declared so the unit-of-work inserts referenced nodes before edges
    # (PostgreSQL enforces the FK within the flush).
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
    # Capability roles as a set (ADR-0040), stored as a JSON array. Replaces the four
    # former booleans (is_container/is_task_like/is_shareable/is_subscribable): a type
    # may carry several roles at once (project = {container, shareable, subscribable}).
    # ``container`` = plays the project role (its task-role ``contains`` children are
    # "its tasks"); ``task`` = plays the task/subtask role; ``shareable`` = can mint a
    # public share facade (share_token/PIN/expiry in node.data); ``subscribable`` = can
    # expose an iCal feed over its ``contains`` subtree. Adding a new capability is a
    # string in this set + a dispatcher rule — no schema change (ADR-0040).
    roles: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Which keys of a node's ``data`` belong to the user, and what each one holds
    # (ADR-0074). A JSON array of {key, label, kind, ...} specs. ``data`` is otherwise
    # a bag with no description — user fields, feature machinery (share_token,
    # callback_token, reminder_sent_at) and whatever an agent wrote once all sit in it
    # together, which is why nothing could offer a generic editor. This says which
    # subset is editable and how to draw it. Its own column rather than a corner of
    # ``data`` below, for the same reason ``roles`` got one: free-form JSON that
    # nothing describes is how credentials ended up being served (ADR-0059).
    fields: Mapped[list | None] = mapped_column(JSON, nullable=True)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # e.g. default hot-field hints
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    def has_role(self, role: str) -> bool:
        return role in (self.roles or [])


class EdgeType(Base):
    """Registry of relationship (edge) vocabulary, data-driven (see ADR-0033).

    Built-in relations (contains/owns/depends_on/labeled/in_cycle) are seeded
    with ``is_builtin=True``; users may invent their own (e.g. ``blocks``,
    ``relates_to``). ``is_containment`` marks the relations that participate in
    ``contains``-style traversal; ``is_symmetric`` marks undirected relations.
    ``key`` is the string written into ``edges.rel_type``.

    A relation declares what may sit at each end (ADR-0078): ``allowed_source``
    and ``allowed_target`` are ``{"types": [...], "roles": [...]}`` allow-lists
    (either key matches, ``NULL`` means unconstrained) enforced by
    ``graph.add_edge``, and ``description`` says when to reach for this relation
    rather than another. Before ADR-0078 the vocabulary named its relations and
    described none of them, so picking the wrong one wrote a silent no-op edge.
    """

    __tablename__ = "edge_types"

    key: Mapped[str] = mapped_column(String(30), primary_key=True)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_containment: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_symmetric: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allowed_source: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    allowed_target: Mapped[dict | None] = mapped_column(JSON, nullable=True)
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
    # How many of those runs changed anything. run_count alone reads as "this rule is
    # working" even when every action was a no-op or a skip (ADR-0053).
    effect_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
