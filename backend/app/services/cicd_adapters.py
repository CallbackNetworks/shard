"""
CI/CD payload adapters: auto-detect and normalize payloads from various CI/CD platforms.

Each adapter extracts a normalized result dict:
  - status: todo | in_progress | done | failed
  - message: human-readable summary
  - provider: github | gitlab | bitbucket | jenkins | drone | gitea | generic
  - commit_sha: git commit hash
  - branch: git branch name
  - build_url: link to the CI/CD build page
  - build_number: build/run number or ID
  - build_duration_ms: build duration in milliseconds
  - triggered_by: who/what triggered the build
  - event_type: original event type from the CI/CD platform
  - test_summary: { passed, failed, skipped } if available
  - raw_payload: the original payload dict for reference
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Each map covers its provider's *documented* vocabulary, not just the common cases.
# A status outside these maps is left unmapped rather than guessed at: an outcome this
# system invents is worse than no outcome, because it is indistinguishable from one the
# CI system actually reported (ADR-0051).
STATUS_MAP_GITHUB = {
    "completed": {
        "success": "done",
        "neutral": "done",
        "skipped": "done",
        "failure": "failed",
        "cancelled": "failed",
        "timed_out": "failed",
        "action_required": "failed",
        "startup_failure": "failed",
        "stale": "failed",
    },
    "in_progress": "in_progress",
    "queued": "todo",
    "requested": "todo",
    "waiting": "todo",
    "pending": "todo",
}

STATUS_MAP_GITLAB = {
    "success": "done",
    "failed": "failed",
    "canceled": "failed",
    "cancelled": "failed",
    "skipped": "done",
    "running": "in_progress",
    "preparing": "in_progress",
    "pending": "todo",
    "created": "todo",
    "manual": "todo",
    "scheduled": "todo",
    "waiting_for_resource": "todo",
}

STATUS_MAP_BITBUCKET = {
    "SUCCESSFUL": "done",
    "FAILED": "failed",
    "ERROR": "failed",
    "STOPPED": "failed",
    "INPROGRESS": "in_progress",
    "IN_PROGRESS": "in_progress",
    "PENDING": "todo",
}

STATUS_MAP_JENKINS = {
    "SUCCESS": "done",
    "FAILURE": "failed",
    "UNSTABLE": "failed",
    "ABORTED": "failed",
    "NOT_BUILT": "todo",
}

STATUS_MAP_DRONE = {
    "success": "done",
    "failure": "failed",
    "error": "failed",
    "killed": "failed",
    "declined": "failed",
    "skipped": "done",
    "running": "in_progress",
    "pending": "todo",
    "blocked": "todo",
}

# Gitea Actions models its run/job webhooks on GitHub Actions (same field names), so
# the same conclusion vocabulary applies once the payload shape is unwrapped.
STATUS_MAP_GITEA = STATUS_MAP_GITHUB

VALID_STATUSES = {"todo", "in_progress", "done", "failed"}

# What ``status`` is when the payload carried no outcome this system recognises. The
# caller must not touch the task in that case — see ``normalize_webhook_payload``.
UNMAPPED = None


def _base_result() -> dict[str, Any]:
    return {
        "status": None,
        "message": None,
        "provider": "generic",
        "commit_sha": None,
        "branch": None,
        "build_url": None,
        "build_number": None,
        "build_duration_ms": None,
        "triggered_by": None,
        "event_type": None,
        "test_summary": None,
        "raw_payload": None,
    }


def detect_provider(headers: dict[str, str], body: dict) -> str:
    """Detect CI/CD provider from request headers and body shape."""
    h = {k.lower(): v for k, v in headers.items()}

    # Gitea / Gitea Actions (checked before GitHub: Actions run/job payloads mirror
    # GitHub's field names, so the header is the only reliable signal between them)
    if "x-gitea-event" in h or "x-gitea-delivery" in h:
        return "gitea"

    # GitHub Actions / GitHub webhooks
    if "x-github-event" in h or "x-github-delivery" in h:
        return "github"

    # GitLab CI
    if "x-gitlab-event" in h or "x-gitlab-token" in h:
        return "gitlab"

    # Bitbucket
    if "x-event-key" in h or "x-hook-uuid" in h:
        return "bitbucket"

    # Jenkins
    if "x-jenkins-source" in h or h.get("user-agent", "").startswith("Java/"):
        return "jenkins"

    # Drone CI
    if "x-drone-event" in h or "x-drone-source" in h:
        return "drone"

    # Body-based heuristics
    if "workflow_run" in body or "check_run" in body or "check_suite" in body:
        return "github"
    if "object_kind" in body and body.get("object_kind") in ("pipeline", "build", "job"):
        return "gitlab"
    if "build" in body and "phase" in body.get("build", {}):
        return "jenkins"

    return "generic"


def parse_github(headers: dict[str, str], body: dict) -> dict[str, Any]:
    """Parse GitHub Actions / GitHub webhook payloads."""
    result = _base_result()
    result["provider"] = "github"
    result["raw_payload"] = body

    event_type = headers.get("x-github-event", headers.get("X-GitHub-Event", ""))
    result["event_type"] = event_type

    # workflow_run event (GitHub Actions)
    if "workflow_run" in body:
        run = body["workflow_run"]
        conclusion = run.get("conclusion")
        run_status = run.get("status", "")

        if conclusion:
            result["status"] = STATUS_MAP_GITHUB.get("completed", {}).get(conclusion)
        elif run_status in STATUS_MAP_GITHUB:
            mapped = STATUS_MAP_GITHUB[run_status]
            result["status"] = mapped if isinstance(mapped, str) else "todo"
        else:
            result["status"] = "in_progress"

        result["message"] = f"Workflow '{run.get('name', 'unknown')}' {conclusion or run_status}"
        result["build_url"] = run.get("html_url")
        result["build_number"] = str(run.get("run_number", ""))
        result["commit_sha"] = run.get("head_sha")
        result["branch"] = run.get("head_branch")
        result["triggered_by"] = run.get("actor", {}).get("login") if run.get("actor") else None

        # Duration
        if run.get("run_started_at") and run.get("updated_at"):
            from datetime import datetime

            try:
                started = datetime.fromisoformat(run["run_started_at"].replace("Z", "+00:00"))
                ended = datetime.fromisoformat(run["updated_at"].replace("Z", "+00:00"))
                result["build_duration_ms"] = int((ended - started).total_seconds() * 1000)
            except (ValueError, TypeError):
                pass
        return result

    # check_run event
    if "check_run" in body:
        cr = body["check_run"]
        conclusion = cr.get("conclusion")
        cr_status = cr.get("status", "")

        if conclusion:
            result["status"] = STATUS_MAP_GITHUB.get("completed", {}).get(conclusion)
        elif cr_status == "in_progress":
            result["status"] = "in_progress"
        else:
            result["status"] = "todo"

        result["message"] = f"Check '{cr.get('name', 'unknown')}' {conclusion or cr_status}"
        result["build_url"] = cr.get("html_url")
        result["commit_sha"] = cr.get("head_sha")
        return result

    # check_suite event
    if "check_suite" in body:
        cs = body["check_suite"]
        conclusion = cs.get("conclusion")
        if conclusion:
            result["status"] = STATUS_MAP_GITHUB.get("completed", {}).get(conclusion)
        else:
            result["status"] = "in_progress"
        result["message"] = f"Check suite {conclusion or cs.get('status', 'unknown')}"
        result["commit_sha"] = cs.get("head_sha")
        result["branch"] = cs.get("head_branch")
        return result

    # Deployment status
    if "deployment_status" in body:
        ds = body["deployment_status"]
        state = ds.get("state", "")
        state_map = {"success": "done", "failure": "failed", "error": "failed", "pending": "in_progress"}
        result["status"] = state_map.get(state)
        result["message"] = f"Deployment {state}: {ds.get('description', '')}"
        result["build_url"] = ds.get("target_url") or ds.get("log_url")
        return result

    # status event (commit status)
    if "state" in body and "sha" in body and "context" in body:
        state = body["state"]
        state_map = {"success": "done", "failure": "failed", "error": "failed", "pending": "in_progress"}
        result["status"] = state_map.get(state)
        result["message"] = f"{body.get('context', 'Status')}: {body.get('description', state)}"
        result["commit_sha"] = body.get("sha")
        result["build_url"] = body.get("target_url")
        return result

    # Fallback: try to extract status from body
    result["status"] = _extract_simple_status(body)
    result["message"] = body.get("message") or f"GitHub event: {event_type}"
    return result


def parse_gitlab(headers: dict[str, str], body: dict) -> dict[str, Any]:
    """Parse GitLab CI webhook payloads."""
    result = _base_result()
    result["provider"] = "gitlab"
    result["raw_payload"] = body

    event_type = headers.get("x-gitlab-event", headers.get("X-Gitlab-Event", ""))
    result["event_type"] = event_type
    object_kind = body.get("object_kind", "")

    # Pipeline event
    if object_kind == "pipeline":
        attrs = body.get("object_attributes", {})
        gl_status = attrs.get("status", "")
        result["status"] = STATUS_MAP_GITLAB.get(gl_status)
        result["message"] = f"Pipeline #{attrs.get('id', '?')} {gl_status}"
        result["build_url"] = attrs.get("url")
        result["build_number"] = str(attrs.get("id", ""))
        result["commit_sha"] = attrs.get("sha")
        result["branch"] = attrs.get("ref")

        # Duration
        duration = attrs.get("duration")
        if duration:
            result["build_duration_ms"] = int(float(duration) * 1000)

        # Triggered by
        user = body.get("user", {})
        result["triggered_by"] = user.get("username") or user.get("name")
        return result

    # Build/Job event
    if object_kind in ("build", "job"):
        gl_status = body.get("build_status", "")
        result["status"] = STATUS_MAP_GITLAB.get(gl_status)
        result["message"] = f"Job '{body.get('build_name', '?')}' {gl_status}"
        result["build_number"] = str(body.get("build_id", ""))
        result["commit_sha"] = body.get("sha") or body.get("commit", {}).get("sha")
        result["branch"] = body.get("ref")
        result["triggered_by"] = body.get("user", {}).get("username")

        duration = body.get("build_duration")
        if duration:
            result["build_duration_ms"] = int(float(duration) * 1000)

        # Construct build URL
        project_url = body.get("repository", {}).get("homepage", "")
        if project_url and body.get("build_id"):
            result["build_url"] = f"{project_url}/-/jobs/{body['build_id']}"
        return result

    # Merge request event with pipeline info
    if object_kind == "merge_request":
        attrs = body.get("object_attributes", {})
        pipeline = attrs.get("head_pipeline", {})
        if pipeline:
            gl_status = pipeline.get("status", "")
            result["status"] = STATUS_MAP_GITLAB.get(gl_status)
            result["message"] = f"MR !{attrs.get('iid', '?')} pipeline {gl_status}"
            result["build_url"] = pipeline.get("web_url")
            result["commit_sha"] = pipeline.get("sha")
            result["branch"] = attrs.get("source_branch")
        else:
            result["status"] = _extract_simple_status(body)
            result["message"] = f"MR !{attrs.get('iid', '?')} {attrs.get('action', 'updated')}"
        return result

    # Fallback
    result["status"] = _extract_simple_status(body)
    result["message"] = body.get("message") or f"GitLab event: {event_type or object_kind}"
    return result


def parse_bitbucket(headers: dict[str, str], body: dict) -> dict[str, Any]:
    """Parse Bitbucket Pipelines webhook payloads."""
    result = _base_result()
    result["provider"] = "bitbucket"
    result["raw_payload"] = body

    event_key = headers.get("x-event-key", headers.get("X-Event-Key", ""))
    result["event_type"] = event_key

    # commit_status event (repo:commit_status_updated / repo:commit_status_created)
    if "commit_status" in body:
        cs = body["commit_status"]
        bb_state = cs.get("state", "")
        result["status"] = STATUS_MAP_BITBUCKET.get(bb_state)
        result["message"] = f"{cs.get('name', 'Build')} {bb_state.lower()}"
        result["build_url"] = cs.get("url")
        result["commit_sha"] = cs.get("commit", {}).get("hash") if isinstance(cs.get("commit"), dict) else None
        return result

    # Pipeline step event
    if "pipeline" in body:
        pipeline = body.get("pipeline", {}) if isinstance(body.get("pipeline"), dict) else {}
        state = pipeline.get("state", {})
        state_name = state.get("name", "") if isinstance(state, dict) else str(state)
        result["status"] = STATUS_MAP_BITBUCKET.get(state_name.upper())
        result["message"] = f"Pipeline {state_name}"
        result["build_number"] = str(pipeline.get("build_number", ""))

        target = pipeline.get("target", {})
        if isinstance(target, dict):
            result["commit_sha"] = (
                target.get("commit", {}).get("hash") if isinstance(target.get("commit"), dict) else None
            )
            ref = target.get("ref_name") or target.get("selector", {}).get("pattern")
            result["branch"] = ref

        creator = pipeline.get("creator", {})
        if isinstance(creator, dict):
            result["triggered_by"] = creator.get("display_name") or creator.get("username")

        # Duration
        duration = pipeline.get("duration_in_seconds")
        if duration:
            result["build_duration_ms"] = int(float(duration) * 1000)
        return result

    # Fallback
    result["status"] = _extract_simple_status(body)
    result["message"] = body.get("message") or f"Bitbucket event: {event_key}"
    return result


def parse_jenkins(headers: dict[str, str], body: dict) -> dict[str, Any]:
    """Parse Jenkins webhook payloads (Generic Webhook Trigger / Notification plugin)."""
    result = _base_result()
    result["provider"] = "jenkins"
    result["raw_payload"] = body

    # Jenkins Notification Plugin format
    build = body.get("build", {})
    if build:
        phase = build.get("phase", "")
        jenkins_status = build.get("status", "")

        if phase == "STARTED":
            result["status"] = "in_progress"
        elif phase in ("COMPLETED", "FINALIZED"):
            result["status"] = STATUS_MAP_JENKINS.get(jenkins_status)
        else:
            result["status"] = STATUS_MAP_JENKINS.get(jenkins_status)

        result["message"] = f"Build #{build.get('number', '?')} {phase} ({jenkins_status or 'unknown'})"
        result["build_url"] = build.get("full_url") or build.get("url")
        result["build_number"] = str(build.get("number", ""))
        result["commit_sha"] = build.get("scm", {}).get("commit") if build.get("scm") else None
        result["branch"] = build.get("scm", {}).get("branch") if build.get("scm") else None

        # Duration
        duration = build.get("duration")
        if duration:
            result["build_duration_ms"] = int(duration)

        result["event_type"] = f"build.{phase.lower()}" if phase else "build"
        return result

    # Flat format from Generic Webhook Trigger
    if "result" in body or "build_status" in body:
        jenkins_status = body.get("result") or body.get("build_status", "")
        result["status"] = STATUS_MAP_JENKINS.get(jenkins_status.upper())
        result["message"] = f"Build {jenkins_status}"
        result["build_url"] = body.get("build_url") or body.get("url")
        result["build_number"] = str(body.get("build_number") or body.get("number", ""))
        result["commit_sha"] = body.get("commit") or body.get("git_commit")
        result["branch"] = body.get("branch") or body.get("git_branch")
        result["event_type"] = "build.completed"
        return result

    # Fallback
    result["status"] = _extract_simple_status(body)
    result["message"] = body.get("message") or "Jenkins build event"
    return result


def parse_drone(headers: dict[str, str], body: dict) -> dict[str, Any]:
    """Parse Drone CI webhook payloads."""
    result = _base_result()
    result["provider"] = "drone"
    result["raw_payload"] = body

    event = headers.get("x-drone-event", headers.get("X-Drone-Event", ""))
    result["event_type"] = event or body.get("event", "")

    build = body.get("build", body)  # Drone may wrap in 'build' or send flat
    drone_status = build.get("status", "")
    result["status"] = STATUS_MAP_DRONE.get(drone_status)
    result["message"] = f"Build #{build.get('number', '?')} {drone_status}"
    result["build_url"] = build.get("link")
    result["build_number"] = str(build.get("number", ""))
    result["commit_sha"] = build.get("after") or build.get("commit")
    result["branch"] = build.get("target") or build.get("branch")
    result["triggered_by"] = build.get("trigger") or build.get("sender")

    # Duration
    started = build.get("started")
    finished = build.get("finished")
    if started and finished and finished > started:
        result["build_duration_ms"] = (finished - started) * 1000

    return result


def parse_gitea(headers: dict[str, str], body: dict) -> dict[str, Any]:
    """Parse Gitea webhook payloads: push events and Gitea Actions run/job events.

    A plain push carries no build outcome, so ``status`` stays unmapped on purpose —
    the caller logs it rather than treating a push as a status to apply (ADR-0051).
    Actions events mirror GitHub Actions' field names, so they reuse that mapping.
    """
    result = _base_result()
    result["provider"] = "gitea"
    result["raw_payload"] = body

    event_type = headers.get("x-gitea-event", headers.get("X-Gitea-Event", ""))
    result["event_type"] = event_type

    if "workflow_run" in body:
        run = body["workflow_run"]
        conclusion = run.get("conclusion")
        run_status = run.get("status", "")

        if conclusion:
            result["status"] = STATUS_MAP_GITEA.get("completed", {}).get(conclusion)
        elif run_status in STATUS_MAP_GITEA:
            mapped = STATUS_MAP_GITEA[run_status]
            result["status"] = mapped if isinstance(mapped, str) else "todo"
        else:
            result["status"] = "in_progress"

        result["message"] = f"Workflow '{run.get('name', 'unknown')}' {conclusion or run_status}"
        result["build_url"] = run.get("html_url")
        result["build_number"] = str(run.get("run_number", ""))
        result["commit_sha"] = run.get("head_sha")
        result["branch"] = run.get("head_branch")
        return result

    if "workflow_job" in body:
        job = body["workflow_job"]
        conclusion = job.get("conclusion")
        job_status = job.get("status", "")

        if conclusion:
            result["status"] = STATUS_MAP_GITEA.get("completed", {}).get(conclusion)
        elif job_status == "in_progress":
            result["status"] = "in_progress"
        else:
            result["status"] = "todo"

        result["message"] = f"Job '{job.get('name', 'unknown')}' {conclusion or job_status}"
        result["build_url"] = job.get("html_url")
        result["commit_sha"] = job.get("head_sha")
        return result

    if event_type == "push" or ("commits" in body and "ref" in body):
        commits = body.get("commits") or []
        ref = body.get("ref", "")
        branch = ref.removeprefix("refs/heads/") if ref else None
        repo = body.get("repository") if isinstance(body.get("repository"), dict) else {}
        pusher = body.get("pusher") if isinstance(body.get("pusher"), dict) else {}

        result["branch"] = branch
        result["commit_sha"] = body.get("after")
        result["triggered_by"] = pusher.get("login") or pusher.get("full_name")
        result["build_url"] = body.get("compare_url") or repo.get("html_url")

        count = len(commits)
        who = f" by {result['triggered_by']}" if result["triggered_by"] else ""
        if count:
            headline = (commits[-1].get("message") or "").splitlines()[0]
            noun = "commit" if count == 1 else "commits"
            result["message"] = f"{count} {noun} pushed to {branch or '?'}{who}: {headline}"
        else:
            result["message"] = f"Push to {branch or '?'}{who}"
        return result

    # Fallback: try to extract status from body
    result["status"] = _extract_simple_status(body)
    result["message"] = body.get("message") or f"Gitea event: {event_type}"
    return result


def parse_generic(headers: dict[str, str], body: dict) -> dict[str, Any]:
    """Parse generic/simple webhook payloads (the existing format)."""
    result = _base_result()
    result["provider"] = "generic"
    result["raw_payload"] = body

    result["status"] = _extract_simple_status(body)
    result["message"] = body.get("message")

    # Try to extract common fields even from unknown payloads
    result["commit_sha"] = body.get("commit_sha") or body.get("commit") or body.get("sha")
    result["branch"] = body.get("branch") or body.get("ref")
    result["build_url"] = body.get("build_url") or body.get("url") or body.get("target_url")
    result["build_number"] = str(body.get("build_number") or body.get("number", "") or "")
    result["triggered_by"] = body.get("triggered_by") or body.get("actor") or body.get("sender")

    return result


def _extract_simple_status(body: dict) -> str | None:
    """Extract a status from a simple payload, or ``None`` if it carries none we know.

    Returning ``None`` rather than a guess is the whole point (ADR-0051): this is the
    path an empty body, a typo and an unrecognised vocabulary all end up on, and every
    one of them used to mean "done".
    """
    status = body.get("status", "")
    if status in VALID_STATUSES:
        return status

    # Map common external status strings
    status_lower = str(status).lower()
    common_map = {
        "success": "done",
        "successful": "done",
        "passed": "done",
        "pass": "done",
        "failure": "failed",
        "fail": "failed",
        "error": "failed",
        "broken": "failed",
        "running": "in_progress",
        "started": "in_progress",
        "building": "in_progress",
        "pending": "todo",
        "queued": "todo",
        "waiting": "todo",
        "created": "todo",
        "cancelled": "failed",
        "canceled": "failed",
        "skipped": "done",
        "aborted": "failed",
    }
    return common_map.get(status_lower)


def _raw_status(body: dict) -> str | None:
    """The status string the sender actually used, for the record we leave behind.

    Providers bury it in different places; this is best-effort and only ever used to
    tell the user what arrived, never to decide anything.
    """
    for path in (
        ("status",),
        ("state",),
        ("workflow_run", "conclusion"),
        ("workflow_run", "status"),
        ("check_run", "conclusion"),
        ("check_suite", "conclusion"),
        ("deployment_status", "state"),
        ("object_attributes", "status"),
        ("build", "phase"),
        ("build", "status"),
        ("commit_status", "state"),
    ):
        value: Any = body
        for key in path:
            value = value.get(key) if isinstance(value, dict) else None
        if isinstance(value, str) and value:
            return value
    return None


PROVIDER_PARSERS = {
    "github": parse_github,
    "gitlab": parse_gitlab,
    "bitbucket": parse_bitbucket,
    "jenkins": parse_jenkins,
    "drone": parse_drone,
    "gitea": parse_gitea,
    "generic": parse_generic,
}


def normalize_webhook_payload(
    headers: dict[str, str],
    body: dict,
    provider_hint: str | None = None,
) -> dict[str, Any]:
    """
    Main entry point: detect provider, parse payload, return normalized result.

    Args:
        headers: HTTP request headers
        body: parsed JSON body
        provider_hint: optional override to skip auto-detection

    Returns:
        Normalized dict with status, message, provider, commit_sha, branch, etc.
    """
    provider = provider_hint or detect_provider(headers, body)
    parser = PROVIDER_PARSERS.get(provider, parse_generic)

    try:
        result = parser(headers, body)
    except Exception:
        logger.exception("Failed to parse %s webhook payload", provider)
        result = parse_generic(headers, body)

    # Anything the maps did not recognise stays unmapped. This used to default to "done",
    # which meant a timed-out build, a typo, an empty body and a payload from a system we
    # cannot parse all reported the task as finished — an invented outcome the caller
    # could not tell apart from a real one (ADR-0051).
    if result.get("status") not in VALID_STATUSES:
        result["status"] = UNMAPPED
        result["raw_status"] = _raw_status(body)

    # Clean up empty strings to None
    for key in ("commit_sha", "branch", "build_url", "build_number", "triggered_by"):
        if result.get(key) == "":
            result[key] = None

    return result
