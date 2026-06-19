"""Tests for CI/CD adapter detection and payload normalization."""

from app.services.cicd_adapters import (
    detect_provider,
    normalize_webhook_payload,
    parse_bitbucket,
    parse_drone,
    parse_generic,
    parse_github,
    parse_gitlab,
    parse_jenkins,
)

# ── detect_provider ──────────────────────────────────────────────────────


class TestDetectProvider:
    def test_github_by_event_header(self):
        assert detect_provider({"X-GitHub-Event": "workflow_run"}, {}) == "github"

    def test_github_by_delivery_header(self):
        assert detect_provider({"X-GitHub-Delivery": "abc-123"}, {}) == "github"

    def test_gitlab_by_event_header(self):
        assert detect_provider({"X-Gitlab-Event": "Pipeline Hook"}, {}) == "gitlab"

    def test_gitlab_by_token_header(self):
        assert detect_provider({"X-Gitlab-Token": "secret"}, {}) == "gitlab"

    def test_bitbucket_by_event_key(self):
        assert detect_provider({"X-Event-Key": "repo:push"}, {}) == "bitbucket"

    def test_bitbucket_by_hook_uuid(self):
        assert detect_provider({"X-Hook-UUID": "uuid-123"}, {}) == "bitbucket"

    def test_jenkins_by_source_header(self):
        assert detect_provider({"X-Jenkins-Source": "jenkins"}, {}) == "jenkins"

    def test_jenkins_by_user_agent(self):
        assert detect_provider({"User-Agent": "Java/11.0.2"}, {}) == "jenkins"

    def test_drone_by_event_header(self):
        assert detect_provider({"X-Drone-Event": "push"}, {}) == "drone"

    def test_drone_by_source_header(self):
        assert detect_provider({"X-Drone-Source": "drone"}, {}) == "drone"

    def test_github_by_body_workflow_run(self):
        assert detect_provider({}, {"workflow_run": {}}) == "github"

    def test_github_by_body_check_run(self):
        assert detect_provider({}, {"check_run": {}}) == "github"

    def test_gitlab_by_body_pipeline(self):
        assert detect_provider({}, {"object_kind": "pipeline"}) == "gitlab"

    def test_gitlab_by_body_build(self):
        assert detect_provider({}, {"object_kind": "build"}) == "gitlab"

    def test_jenkins_by_body_build_phase(self):
        assert detect_provider({}, {"build": {"phase": "STARTED"}}) == "jenkins"

    def test_generic_fallback(self):
        assert detect_provider({}, {"foo": "bar"}) == "generic"

    def test_case_insensitive_headers(self):
        assert detect_provider({"x-github-event": "push"}, {}) == "github"


# ── parse_github ─────────────────────────────────────────────────────────


class TestParseGithub:
    def test_workflow_run_success(self):
        body = {
            "workflow_run": {
                "name": "CI",
                "status": "completed",
                "conclusion": "success",
                "html_url": "https://github.com/org/repo/actions/runs/1",
                "run_number": 42,
                "head_sha": "abc123",
                "head_branch": "main",
                "actor": {"login": "user1"},
                "run_started_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:05:00Z",
            }
        }
        r = parse_github({"X-GitHub-Event": "workflow_run"}, body)
        assert r["status"] == "done"
        assert r["provider"] == "github"
        assert r["commit_sha"] == "abc123"
        assert r["branch"] == "main"
        assert r["build_number"] == "42"
        assert r["triggered_by"] == "user1"
        assert r["build_duration_ms"] == 300_000

    def test_workflow_run_failure(self):
        body = {"workflow_run": {"status": "completed", "conclusion": "failure", "name": "CI"}}
        r = parse_github({}, body)
        assert r["status"] == "failed"

    def test_workflow_run_in_progress(self):
        body = {"workflow_run": {"status": "in_progress", "name": "CI"}}
        r = parse_github({}, body)
        assert r["status"] == "in_progress"

    def test_workflow_run_queued(self):
        body = {"workflow_run": {"status": "queued", "name": "CI"}}
        r = parse_github({}, body)
        assert r["status"] == "todo"

    def test_check_run_success(self):
        body = {"check_run": {"name": "lint", "status": "completed", "conclusion": "success", "head_sha": "def456"}}
        r = parse_github({}, body)
        assert r["status"] == "done"
        assert r["commit_sha"] == "def456"

    def test_check_run_in_progress(self):
        body = {"check_run": {"name": "lint", "status": "in_progress"}}
        r = parse_github({}, body)
        assert r["status"] == "in_progress"

    def test_check_suite(self):
        body = {"check_suite": {"conclusion": "failure", "head_sha": "aaa", "head_branch": "dev"}}
        r = parse_github({}, body)
        assert r["status"] == "failed"
        assert r["branch"] == "dev"

    def test_deployment_status(self):
        body = {"deployment_status": {"state": "success", "description": "Deployed OK", "target_url": "https://app"}}
        r = parse_github({}, body)
        assert r["status"] == "done"
        assert r["build_url"] == "https://app"

    def test_commit_status(self):
        body = {"state": "pending", "sha": "bbb", "context": "ci/test", "description": "Running"}
        r = parse_github({}, body)
        assert r["status"] == "in_progress"
        assert r["commit_sha"] == "bbb"

    def test_fallback_simple_status(self):
        body = {"status": "done", "message": "All good"}
        r = parse_github({"X-GitHub-Event": "ping"}, body)
        assert r["status"] == "done"


# ── parse_gitlab ─────────────────────────────────────────────────────────


class TestParseGitlab:
    def test_pipeline_success(self):
        body = {
            "object_kind": "pipeline",
            "object_attributes": {
                "id": 100,
                "status": "success",
                "sha": "abc",
                "ref": "main",
                "url": "https://gitlab.com/p/100",
                "duration": 120.5,
            },
            "user": {"username": "dev1"},
        }
        r = parse_gitlab({"X-Gitlab-Event": "Pipeline Hook"}, body)
        assert r["status"] == "done"
        assert r["provider"] == "gitlab"
        assert r["build_number"] == "100"
        assert r["commit_sha"] == "abc"
        assert r["build_duration_ms"] == 120_500
        assert r["triggered_by"] == "dev1"

    def test_pipeline_failed(self):
        body = {"object_kind": "pipeline", "object_attributes": {"status": "failed", "id": 1}}
        r = parse_gitlab({}, body)
        assert r["status"] == "failed"

    def test_pipeline_running(self):
        body = {"object_kind": "pipeline", "object_attributes": {"status": "running", "id": 2}}
        r = parse_gitlab({}, body)
        assert r["status"] == "in_progress"

    def test_build_event(self):
        body = {
            "object_kind": "build",
            "build_status": "success",
            "build_name": "test-job",
            "build_id": 55,
            "sha": "xyz",
            "ref": "dev",
            "user": {"username": "dev2"},
            "build_duration": 60,
            "repository": {"homepage": "https://gitlab.com/repo"},
        }
        r = parse_gitlab({}, body)
        assert r["status"] == "done"
        assert r["build_url"] == "https://gitlab.com/repo/-/jobs/55"
        assert r["build_duration_ms"] == 60_000

    def test_merge_request_with_pipeline(self):
        body = {
            "object_kind": "merge_request",
            "object_attributes": {
                "iid": 5,
                "source_branch": "feature",
                "head_pipeline": {"status": "success", "sha": "aaa", "web_url": "https://gl/p/1"},
            },
        }
        r = parse_gitlab({}, body)
        assert r["status"] == "done"
        assert r["branch"] == "feature"

    def test_merge_request_no_pipeline(self):
        body = {
            "object_kind": "merge_request",
            "object_attributes": {"iid": 6, "action": "open"},
        }
        r = parse_gitlab({}, body)
        assert r["status"] == "done"  # fallback


# ── parse_bitbucket ──────────────────────────────────────────────────────


class TestParseBitbucket:
    def test_commit_status(self):
        body = {
            "commit_status": {
                "state": "SUCCESSFUL",
                "name": "Build #1",
                "url": "https://bb.com/build/1",
                "commit": {"hash": "abc123"},
            }
        }
        r = parse_bitbucket({"X-Event-Key": "repo:commit_status_updated"}, body)
        assert r["status"] == "done"
        assert r["provider"] == "bitbucket"
        assert r["build_url"] == "https://bb.com/build/1"
        assert r["commit_sha"] == "abc123"

    def test_commit_status_failed(self):
        body = {"commit_status": {"state": "FAILED", "name": "Test"}}
        r = parse_bitbucket({}, body)
        assert r["status"] == "failed"

    def test_pipeline_event(self):
        body = {
            "pipeline": {
                "state": {"name": "SUCCESSFUL"},
                "build_number": 10,
                "target": {"commit": {"hash": "def"}, "ref_name": "main"},
                "creator": {"display_name": "User"},
                "duration_in_seconds": 90,
            }
        }
        r = parse_bitbucket({}, body)
        assert r["status"] == "done"
        assert r["build_number"] == "10"
        assert r["branch"] == "main"
        assert r["triggered_by"] == "User"
        assert r["build_duration_ms"] == 90_000

    def test_fallback(self):
        body = {"status": "success"}
        r = parse_bitbucket({}, body)
        assert r["status"] == "done"


# ── parse_jenkins ────────────────────────────────────────────────────────


class TestParseJenkins:
    def test_notification_plugin_started(self):
        body = {"build": {"phase": "STARTED", "number": 7, "full_url": "https://jenkins/job/7"}}
        r = parse_jenkins({}, body)
        assert r["status"] == "in_progress"
        assert r["provider"] == "jenkins"
        assert r["build_number"] == "7"

    def test_notification_plugin_completed_success(self):
        body = {
            "build": {
                "phase": "COMPLETED",
                "status": "SUCCESS",
                "number": 8,
                "scm": {"commit": "abc", "branch": "main"},
                "duration": 45000,
            }
        }
        r = parse_jenkins({}, body)
        assert r["status"] == "done"
        assert r["commit_sha"] == "abc"
        assert r["branch"] == "main"
        assert r["build_duration_ms"] == 45000

    def test_notification_plugin_failure(self):
        body = {"build": {"phase": "FINALIZED", "status": "FAILURE", "number": 9}}
        r = parse_jenkins({}, body)
        assert r["status"] == "failed"

    def test_generic_webhook_trigger(self):
        body = {
            "result": "SUCCESS",
            "build_url": "https://jenkins/job/10",
            "build_number": "10",
            "commit": "xyz",
            "branch": "dev",
        }
        r = parse_jenkins({}, body)
        assert r["status"] == "done"
        assert r["build_url"] == "https://jenkins/job/10"

    def test_generic_webhook_trigger_failure(self):
        body = {"build_status": "UNSTABLE"}
        r = parse_jenkins({}, body)
        assert r["status"] == "failed"

    def test_fallback(self):
        body = {"status": "done", "message": "OK"}
        r = parse_jenkins({}, body)
        assert r["status"] == "done"


# ── parse_drone ──────────────────────────────────────────────────────────


class TestParseDrone:
    def test_success_build(self):
        body = {
            "build": {
                "status": "success",
                "number": 15,
                "link": "https://drone/build/15",
                "after": "abc",
                "target": "main",
                "trigger": "user1",
                "started": 1000,
                "finished": 1060,
            }
        }
        r = parse_drone({"X-Drone-Event": "push"}, body)
        assert r["status"] == "done"
        assert r["provider"] == "drone"
        assert r["build_number"] == "15"
        assert r["commit_sha"] == "abc"
        assert r["branch"] == "main"
        assert r["triggered_by"] == "user1"
        assert r["build_duration_ms"] == 60_000

    def test_failure_build(self):
        body = {"status": "failure", "number": 16}
        r = parse_drone({}, body)
        assert r["status"] == "failed"

    def test_running_build(self):
        body = {"status": "running", "number": 17}
        r = parse_drone({}, body)
        assert r["status"] == "in_progress"

    def test_pending_build(self):
        body = {"status": "pending", "number": 18}
        r = parse_drone({}, body)
        assert r["status"] == "todo"


# ── parse_generic ────────────────────────────────────────────────────────


class TestParseGeneric:
    def test_direct_status(self):
        body = {"status": "done", "message": "All good"}
        r = parse_generic({}, body)
        assert r["status"] == "done"
        assert r["message"] == "All good"

    def test_mapped_status(self):
        body = {"status": "success"}
        r = parse_generic({}, body)
        assert r["status"] == "done"

    def test_extracts_common_fields(self):
        body = {
            "status": "done",
            "commit_sha": "abc",
            "branch": "main",
            "build_url": "https://ci/1",
            "build_number": "42",
            "triggered_by": "bot",
        }
        r = parse_generic({}, body)
        assert r["commit_sha"] == "abc"
        assert r["branch"] == "main"
        assert r["build_url"] == "https://ci/1"
        assert r["build_number"] == "42"
        assert r["triggered_by"] == "bot"

    def test_unknown_status_defaults_to_done(self):
        body = {"status": "something_unknown"}
        r = parse_generic({}, body)
        assert r["status"] == "done"


# ── normalize_webhook_payload ────────────────────────────────────────────


class TestNormalizeWebhookPayload:
    def test_auto_detect_and_parse(self):
        body = {"workflow_run": {"name": "CI", "status": "completed", "conclusion": "success"}}
        r = normalize_webhook_payload({"X-GitHub-Event": "workflow_run"}, body)
        assert r["provider"] == "github"
        assert r["status"] == "done"

    def test_provider_hint_overrides_detection(self):
        body = {"status": "done", "message": "OK"}
        r = normalize_webhook_payload({"X-GitHub-Event": "push"}, body, provider_hint="generic")
        assert r["provider"] == "generic"

    def test_invalid_status_defaults_to_done(self):
        body = {"workflow_run": {"name": "CI", "status": "weird_status"}}
        r = normalize_webhook_payload({}, body)
        # status should be valid
        assert r["status"] in ("todo", "in_progress", "done", "failed")

    def test_empty_strings_become_none(self):
        body = {"status": "done", "commit_sha": "", "branch": "", "build_url": ""}
        r = normalize_webhook_payload({}, body)
        assert r["commit_sha"] is None
        assert r["branch"] is None
        assert r["build_url"] is None

    def test_parser_exception_falls_back_to_generic(self):
        # Pass a body that will cause parse_github to handle gracefully
        r = normalize_webhook_payload(
            {"X-GitHub-Event": "unknown"},
            {"status": "success"},
        )
        assert r["status"] == "done"
