"""Inbound CI/CD callback credentials, for every door that hands them out (ADR-0084).

A node that receives build results needs two things: a ``callback_token``, which is the
address ``/webhook/callback/{token}``, and a ``webhook_secret``, which signs what arrives
there. Since ADR-0060 the callback refuses unsigned requests, so the pair is not optional
decoration — without it, no CI provider can be pointed at this node at all.

ADR-0059 keeps both out of every node payload, which means revealing them has to be its
own deliberate, logged request. That request existed only on the internal ``/api`` surface,
behind the SPA's password gate, so configuring CI was something a person did in a browser
and nothing else could do — while ``/api/v1/subscriptions`` had long since accepted that an
agent registers its own *outbound* callbacks. This module is the half that was missing:
the reveal/rotate logic in one place, so ``/api/nodes/{id}/webhook`` and
``/api/v1/nodes/{id}/webhook`` are the same act performed through two doors rather than two
implementations that will drift (the shape of defect ADR-0070→0073 was the bill for).

Each door keeps what is genuinely its own: 404, and who is allowed to ask. The type rule
and the logging live here, and ``reveal``/``rotate`` write their own activity row, so a
third door cannot be added that quietly hands out a credential without recording it.
"""

import uuid

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models import Node
from app.services import graph
from app.services.activity import log_activity


class WebhookCredentialError(Exception):
    """A node whose type does not receive callbacks was asked for credentials."""


class WebhookConfigOut(BaseModel):
    """Everything needed to configure a CI provider, and nothing that reads back later."""

    callback_token: str
    secret: str
    path: str


def ensure_webhookable(db: Session, node: Node) -> None:
    """Raise unless this node's type is one that receives callbacks (ADR-0082)."""
    if node.type not in graph.webhookable_type_keys(db):
        raise WebhookCredentialError("node type does not receive webhook callbacks")


def _config(db: Session, node: Node) -> WebhookConfigOut:
    data = node.data or {}
    token = data.get("callback_token")
    secret = data.get("webhook_secret")
    if not token or not secret:
        # Tasks always get both at creation (_apply_task_data_defaults); a container
        # never has, so this is where it first gets them.
        token = token or str(uuid.uuid4())
        secret = secret or graph.new_webhook_secret()
        graph.update_node(db, node.id, callback_token=token, webhook_secret=secret)
        db.flush()
    # A path, not a URL: behind a reverse proxy the server's own idea of its origin is
    # whatever the last hop told it, while the client asking already knows the real one.
    return WebhookConfigOut(callback_token=token, secret=secret, path=f"/webhook/callback/{token}")


def _log(db: Session, node: Node, verb: str, actor: str) -> None:
    """Log a reveal/rotate against the right scope: a task's own row, or the
    container it is (there is no task to point at)."""
    is_task = node.type in graph.task_type_keys(db)
    log_activity(
        db,
        f"task.webhook_secret_{verb}" if is_task else f"project.webhook_secret_{verb}",
        project_id=graph.project_id_of_task(db, node.id) if is_task else node.id,
        task_id=node.id if is_task else None,
        actor=actor,
        detail=f'Webhook credentials {verb} for "{node.title}"',
        meta={"title": node.title},
    )


def reveal(db: Session, node: Node, *, actor: str) -> WebhookConfigOut:
    """Read the callback credentials, provisioning them on first ask. Does not commit.

    A separate request rather than a field on the node, so that reading the secret is
    something somebody did at a moment that can be pointed at, instead of something that
    rode along in every list response.
    """
    ensure_webhookable(db, node)
    config = _config(db, node)
    _log(db, node, "revealed", actor)
    return config


def rotate(db: Session, node: Node, *, actor: str) -> WebhookConfigOut:
    """Issue a new signing key. Callbacks signed with the old one stop being accepted."""
    ensure_webhookable(db, node)
    graph.update_node(db, node.id, webhook_secret=graph.new_webhook_secret())
    _log(db, node, "rotated", actor)
    db.flush()
    db.refresh(node)
    return _config(db, node)
