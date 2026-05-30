"""
External API v1 — Send email endpoint.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.models import ApiKey
from app.routers.external_api.auth import _auth_errors, _get_api_key, _require_scope
from app.schemas import EmailSendOut, EmailSendRequest

sub_router = APIRouter()


@sub_router.post(
    "/email/send",
    summary="Send an email directly",
    description="Sends an email to specified recipients. SMTP must be configured. Requires `write` scope.",
    response_model=EmailSendOut,
    responses={
        **_auth_errors,
        502: {"description": "Failed to send email"},
        503: {"description": "SMTP not configured"},
    },
)
def api_send_email(
    email: EmailSendRequest,
    api_key: ApiKey = Depends(_get_api_key),
):
    from app.services.email_sender import is_configured, send_email

    _require_scope(api_key, "write")
    if not is_configured():
        raise HTTPException(status_code=503, detail="SMTP not configured")
    if email.html:
        ok = send_email(email.to, email.subject, email.body)
    else:
        ok = send_email(email.to, email.subject, f"<pre>{email.body}</pre>", email.body)
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to send email")
    return {"success": True, "recipients": email.to}
