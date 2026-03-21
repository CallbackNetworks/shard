import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM = os.getenv("SMTP_FROM", "")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"


def is_configured() -> bool:
    return bool(SMTP_HOST and SMTP_FROM)


def send_email(to_addresses: list[str], subject: str, html_body: str, text_body: str = "") -> bool:
    if not is_configured():
        logger.warning("SMTP not configured — skipping email")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = ", ".join(to_addresses)

    if text_body:
        msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    try:
        if SMTP_USE_TLS:
            server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10)
            server.starttls()
        else:
            server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10)

        if SMTP_USER and SMTP_PASS:
            server.login(SMTP_USER, SMTP_PASS)

        server.sendmail(SMTP_FROM, to_addresses, msg.as_string())
        server.quit()
        logger.info("Email sent to %s: %s", to_addresses, subject)
        return True
    except Exception as exc:
        logger.warning("Failed to send email to %s: %s", to_addresses, exc)
        return False


def build_notification_email(event: str, payload: dict, subject_prefix: str = "[TODO Platform]") -> tuple[str, str]:
    project = payload.get("project", {})
    task = payload.get("task", {})

    event_labels = {
        "task.done": "Task Completed",
        "task.failed": "Task Failed",
        "task.in_progress": "Task In Progress",
        "project.complete": "Project Completed",
        "test": "Test Notification",
    }
    event_label = event_labels.get(event, event)

    subject = f"{subject_prefix} {event_label}"
    if task.get("title"):
        subject += f": {task['title']}"
    elif project.get("name"):
        subject += f": {project['name']}"

    status_colors = {
        "done": "#22c55e",
        "failed": "#ef4444",
        "in_progress": "#3b82f6",
        "todo": "#9ca3af",
    }
    task_status = task.get("status", "")
    status_color = status_colors.get(task_status, "#6b7280")

    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #5e6ad2; color: white; padding: 20px 24px; border-radius: 12px 12px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">{event_label}</h2>
        <p style="margin: 4px 0 0; opacity: 0.8; font-size: 14px;">{payload.get('timestamp', '')}</p>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
        {"<div style='margin-bottom: 16px;'><h3 style='margin: 0 0 8px; color: #374151; font-size: 14px;'>Project</h3><p style='margin: 0; font-size: 16px; font-weight: 600;'>" + project.get('name', 'N/A') + "</p><p style='margin: 4px 0 0; color: #6b7280; font-size: 13px;'>Progress: " + str(project.get('progress', 0)) + "% (" + str(project.get('done_tasks', 0)) + "/" + str(project.get('total_tasks', 0)) + " tasks)</p></div>" if project else ""}
        {"<div style='margin-bottom: 16px;'><h3 style='margin: 0 0 8px; color: #374151; font-size: 14px;'>Task</h3><p style='margin: 0; font-size: 16px; font-weight: 600;'>" + task.get('title', 'N/A') + "</p><div style='margin-top: 8px;'><span style='background: " + status_color + "; color: white; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600;'>" + task_status.upper() + "</span><span style='margin-left: 8px; color: #6b7280; font-size: 13px;'>Priority: " + task.get('priority', 'N/A') + "</span></div></div>" if task.get('title') else ""}
        {"<div style='background: #f0fdf4; padding: 12px 16px; border-radius: 8px; color: #166534; font-size: 14px;'>" + payload.get('message', '') + "</div>" if payload.get('message') else ""}
      </div>
      <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 16px;">Sent by TODO Platform</p>
    </div>
    """

    text = f"{event_label}\n"
    if project:
        text += f"\nProject: {project.get('name', 'N/A')} ({project.get('progress', 0)}% done)\n"
    if task.get("title"):
        text += f"Task: {task['title']} [{task_status}] (Priority: {task.get('priority', 'N/A')})\n"
    if payload.get("message"):
        text += f"\n{payload['message']}\n"

    return subject, html
