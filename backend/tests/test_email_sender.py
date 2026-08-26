"""Email: the one notification channel whose failure is invisible to the sender.

A webhook at least records a delivery row (ADR-0085). Email returns a bool nobody
reads — ``send_email`` swallows every SMTP and socket error and answers False — so the
only thing standing between "notifications work" and "notifications silently stopped"
is that these branches behave. The module sat at 26%.

Two properties are worth stating before the tests. First, the SMTP settings are read at
**import** time into module globals, so changing the environment afterwards does not
move them: the tests patch the module attributes, which is also what a deployment has to
respect — the values must be in the environment before the process starts. Second,
``send_email`` is synchronous, so every caller has to hand it to a thread; that is
enforced elsewhere (scheduler and notifier), not here.
"""

import smtplib
from unittest.mock import MagicMock, patch

import pytest

from app.services import email_sender
from app.services.email_sender import build_notification_email, is_configured, send_email


@pytest.fixture()
def smtp_configured(monkeypatch):
    """A configured sender. Patches module globals, not the environment — see the docstring."""
    monkeypatch.setattr(email_sender, "SMTP_HOST", "smtp.example.invalid")
    monkeypatch.setattr(email_sender, "SMTP_PORT", 587)
    monkeypatch.setattr(email_sender, "SMTP_FROM", "shard@example.invalid")
    monkeypatch.setattr(email_sender, "SMTP_USER", "")
    monkeypatch.setattr(email_sender, "SMTP_PASS", "")
    monkeypatch.setattr(email_sender, "SMTP_USE_TLS", True)


class TestIsConfigured:
    """Host and from-address are the two that decide; the rest are optional."""

    def test_both_present(self, smtp_configured):
        assert is_configured() is True

    def test_no_host(self, smtp_configured, monkeypatch):
        monkeypatch.setattr(email_sender, "SMTP_HOST", "")
        assert is_configured() is False

    def test_no_from_address(self, smtp_configured, monkeypatch):
        monkeypatch.setattr(email_sender, "SMTP_FROM", "")
        assert is_configured() is False

    def test_credentials_are_not_required(self, smtp_configured, monkeypatch):
        """An internal relay may take no auth at all."""
        monkeypatch.setattr(email_sender, "SMTP_USER", "")
        monkeypatch.setattr(email_sender, "SMTP_PASS", "")
        assert is_configured() is True


class TestSendEmail:
    def test_unconfigured_returns_false_without_connecting(self, monkeypatch):
        monkeypatch.setattr(email_sender, "SMTP_HOST", "")
        with patch("smtplib.SMTP") as smtp:
            assert send_email(["a@example.invalid"], "s", "<p>b</p>") is False
        smtp.assert_not_called(), "an unconfigured sender must not open a socket"

    def test_a_successful_send_reports_true(self, smtp_configured):
        with patch("smtplib.SMTP") as smtp:
            assert send_email(["a@example.invalid"], "Subject", "<p>body</p>") is True
        smtp.return_value.sendmail.assert_called_once()
        smtp.return_value.quit.assert_called_once()

    def test_tls_is_started_when_enabled(self, smtp_configured):
        with patch("smtplib.SMTP") as smtp:
            send_email(["a@example.invalid"], "s", "<p>b</p>")
        smtp.return_value.starttls.assert_called_once()

    def test_tls_is_not_started_when_disabled(self, smtp_configured, monkeypatch):
        monkeypatch.setattr(email_sender, "SMTP_USE_TLS", False)
        with patch("smtplib.SMTP") as smtp:
            send_email(["a@example.invalid"], "s", "<p>b</p>")
        smtp.return_value.starttls.assert_not_called()

    def test_login_only_happens_with_both_halves_of_a_credential(self, smtp_configured, monkeypatch):
        monkeypatch.setattr(email_sender, "SMTP_USER", "user")
        monkeypatch.setattr(email_sender, "SMTP_PASS", "")
        with patch("smtplib.SMTP") as smtp:
            send_email(["a@example.invalid"], "s", "<p>b</p>")
        smtp.return_value.login.assert_not_called(), "half a credential is not a credential"

    def test_login_happens_when_both_are_present(self, smtp_configured, monkeypatch):
        monkeypatch.setattr(email_sender, "SMTP_USER", "user")
        monkeypatch.setattr(email_sender, "SMTP_PASS", "secret")
        with patch("smtplib.SMTP") as smtp:
            send_email(["a@example.invalid"], "s", "<p>b</p>")
        smtp.return_value.login.assert_called_once_with("user", "secret")

    def test_every_recipient_is_addressed(self, smtp_configured):
        recipients = ["a@example.invalid", "b@example.invalid"]
        with patch("smtplib.SMTP") as smtp:
            send_email(recipients, "s", "<p>b</p>")
        sender, to, raw = smtp.return_value.sendmail.call_args[0]
        assert to == recipients
        assert "a@example.invalid, b@example.invalid" in raw

    def test_the_plain_text_alternative_is_attached_when_given(self, smtp_configured):
        with patch("smtplib.SMTP") as smtp:
            send_email(["a@example.invalid"], "s", "<p>html</p>", "plain words")
        raw = smtp.return_value.sendmail.call_args[0][2]
        assert "text/plain" in raw
        assert "text/html" in raw

    def test_html_only_when_no_text_alternative(self, smtp_configured):
        with patch("smtplib.SMTP") as smtp:
            send_email(["a@example.invalid"], "s", "<p>html</p>")
        raw = smtp.return_value.sendmail.call_args[0][2]
        assert "text/html" in raw

    @pytest.mark.parametrize(
        "error",
        [
            smtplib.SMTPAuthenticationError(535, b"bad credentials"),
            smtplib.SMTPRecipientsRefused({}),
            smtplib.SMTPServerDisconnected("gone"),
            OSError("connection refused"),
            TimeoutError("timed out"),
        ],
    )
    def test_a_failure_is_reported_not_raised(self, smtp_configured, error):
        """A notification that cannot be delivered must not take the caller down with it."""
        with patch("smtplib.SMTP", side_effect=error):
            assert send_email(["a@example.invalid"], "s", "<p>b</p>") is False

    def test_a_failure_partway_through_is_also_caught(self, smtp_configured):
        server = MagicMock()
        server.sendmail.side_effect = smtplib.SMTPException("rejected after connect")
        with patch("smtplib.SMTP", return_value=server):
            assert send_email(["a@example.invalid"], "s", "<p>b</p>") is False


class TestBuildNotificationEmail:
    def _payload(self, **over):
        base = {
            "project": {"name": "Billing", "progress": 40, "done_tasks": 2, "total_tasks": 5},
            "task": {"title": "Ship it", "status": "done", "priority": "high"},
            "timestamp": "2026-08-26T00:00:00Z",
        }
        base.update(over)
        return base

    def test_the_subject_carries_prefix_label_and_task(self):
        subject, _ = build_notification_email("task.done", self._payload())
        assert subject == "[Shard] Task Completed: Ship it"

    def test_a_custom_prefix_is_used(self):
        subject, _ = build_notification_email("task.done", self._payload(), "[Ops]")
        assert subject.startswith("[Ops] ")

    def test_the_project_names_the_subject_when_there_is_no_task(self):
        subject, _ = build_notification_email("project.complete", self._payload(task={}))
        assert subject == "[Shard] Project Completed: Billing"

    def test_an_unknown_event_is_used_verbatim_rather_than_dropped(self):
        """A new event must still produce a sendable subject, not a blank one."""
        subject, _ = build_notification_email("task.something_new", self._payload(task={}, project={}))
        assert subject == "[Shard] task.something_new"

    @pytest.mark.parametrize(
        "event,label",
        [
            ("task.done", "Task Completed"),
            ("task.failed", "Task Failed"),
            ("task.due_soon", "Task Due Soon"),
            ("task.overdue", "Task Overdue"),
            ("test", "Test Notification"),
        ],
    )
    def test_each_known_event_has_a_readable_label(self, event, label):
        subject, html = build_notification_email(event, self._payload(task={}, project={}))
        assert label in subject
        assert label in html

    def test_the_project_block_is_omitted_when_there_is_no_project(self):
        _, html = build_notification_email("task.done", self._payload(project={}))
        assert "Progress:" not in html

    def test_the_task_block_is_omitted_when_there_is_no_task(self):
        _, html = build_notification_email("project.complete", self._payload(task={}))
        assert "Priority:" not in html

    def test_the_message_block_appears_only_when_a_message_is_given(self):
        _, without = build_notification_email("task.done", self._payload())
        _, with_message = build_notification_email("task.done", self._payload(message="build 41 failed"))
        assert "build 41 failed" not in without
        assert "build 41 failed" in with_message

    @pytest.mark.parametrize(
        "status,colour",
        [("done", "#22c55e"), ("failed", "#ef4444"), ("in_progress", "#3b82f6"), ("todo", "#9ca3af")],
    )
    def test_the_status_badge_is_coloured_by_status(self, status, colour):
        _, html = build_notification_email("task.done", self._payload(task={"title": "t", "status": status}))
        assert colour in html

    def test_an_unknown_status_gets_a_neutral_colour_rather_than_none(self):
        _, html = build_notification_email("task.done", self._payload(task={"title": "t", "status": "weird"}))
        assert "#6b7280" in html

    def test_missing_fields_render_a_placeholder_rather_than_the_word_none(self):
        _, html = build_notification_email("task.done", {"task": {"title": "Bare"}})
        assert "None" not in html

    def test_an_empty_payload_still_produces_a_sendable_email(self):
        subject, html = build_notification_email("test", {})
        assert subject
        assert "Sent by Shard" in html
