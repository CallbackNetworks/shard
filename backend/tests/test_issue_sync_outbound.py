"""The outbound half of issue sync: what this app sends *to* a provider.

The inbound half — parsing webhooks — was already well covered. The outbound half was
not: 137 uncovered lines, essentially every function that makes an HTTP call. That
asymmetry matters because the two fail differently. An inbound parsing bug shows up as a
task that did not change, which somebody notices. An outbound bug shows up as a provider
that was never told, which nobody notices from this side — the same "failure mode is
silence" shape as the delivery log (ADR-0085), except here there is no log at all.

Three things are pinned throughout:

**A transport error is a False, not an exception.** ``_github_request`` and
``_gitlab_request`` swallow ``httpx.HTTPError`` and return None, and every caller turns
that into a falsy result. A raise here would escape into the task mutation pipeline that
called it, so a GitHub outage would fail the user's own write.

**A non-2xx is also a False.** The request succeeded, the provider refused — a 404 on a
deleted issue, a 403 on a revoked token. Both are `resp is not None and resp.is_success`,
and dropping either half of that condition turns a refusal into a success.

**The URL is the contract.** These are string-built paths against three providers
(github.com, GHE, Gitea) that differ only by base URL, plus GitLab, whose project path
has to be percent-encoded because it contains slashes. Getting one wrong is a request
that goes somewhere else entirely, and the assertions name the exact URL.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services import issue_sync


def _response(status=200, body=None):
    resp = MagicMock(spec=httpx.Response)
    resp.is_success = 200 <= status < 300
    resp.status_code = status
    resp.json.return_value = body if body is not None else {}
    return resp


def _client(resp):
    """Patch the AsyncClient so `async with httpx.AsyncClient(...) as c` yields a stub."""
    client = MagicMock()
    client.request = AsyncMock(return_value=resp)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return patch("httpx.AsyncClient", return_value=ctx), client


class TestGithubIssueState:
    @pytest.mark.asyncio
    async def test_closing_patches_the_issue_with_state_closed(self):
        patcher, client = _client(_response())
        with patcher:
            assert await issue_sync.close_github_issue("octo/repo", "7", "tok") is True
        method, url = client.request.call_args[0]
        assert method == "PATCH"
        assert url == "https://api.github.com/repos/octo/repo/issues/7"
        assert client.request.call_args.kwargs["json"] == {"state": "closed"}

    @pytest.mark.asyncio
    async def test_reopening_sends_state_open(self):
        patcher, client = _client(_response())
        with patcher:
            await issue_sync.reopen_github_issue("octo/repo", "7", "tok")
        assert client.request.call_args.kwargs["json"] == {"state": "open"}

    @pytest.mark.asyncio
    async def test_the_token_travels_as_a_github_authorization_header(self):
        patcher, client = _client(_response())
        with patcher:
            await issue_sync.close_github_issue("octo/repo", "7", "s3cret")
        headers = client.request.call_args.kwargs["headers"]
        assert headers["Authorization"] == "token s3cret"
        assert headers["Accept"] == "application/vnd.github.v3+json"

    @pytest.mark.asyncio
    async def test_a_self_hosted_base_replaces_github_com(self):
        """Gitea and GHE are the same code path, distinguished only by api_base."""
        patcher, client = _client(_response())
        with patcher:
            await issue_sync.close_github_issue("me/proj", "3", "tok", "https://git.example.invalid/api/v1")
        assert client.request.call_args[0][1] == "https://git.example.invalid/api/v1/repos/me/proj/issues/3"

    @pytest.mark.asyncio
    async def test_a_trailing_slash_on_the_base_does_not_double_up(self):
        patcher, client = _client(_response())
        with patcher:
            await issue_sync.close_github_issue("me/proj", "3", "tok", "https://git.example.invalid/api/v1/")
        assert "//repos" not in client.request.call_args[0][1]

    @pytest.mark.asyncio
    async def test_a_refusal_reports_false(self):
        patcher, _ = _client(_response(404))
        with patcher:
            assert await issue_sync.close_github_issue("octo/repo", "7", "tok") is False

    @pytest.mark.asyncio
    async def test_a_transport_error_reports_false_rather_than_raising(self):
        """Otherwise a provider outage fails the user's own write, several frames up."""
        with patch("httpx.AsyncClient", side_effect=httpx.ConnectError("unreachable")):
            assert await issue_sync.close_github_issue("octo/repo", "7", "tok") is False


class TestGitlabIssueState:
    @pytest.mark.asyncio
    async def test_closing_sends_a_state_event(self):
        patcher, client = _client(_response())
        with patcher:
            assert await issue_sync.close_gitlab_issue("group/proj", "9", "tok") is True
        method, url = client.request.call_args[0]
        assert method == "PUT"
        assert client.request.call_args.kwargs["json"] == {"state_event": "close"}

    @pytest.mark.asyncio
    async def test_reopening_sends_reopen(self):
        patcher, client = _client(_response())
        with patcher:
            await issue_sync.reopen_gitlab_issue("group/proj", "9", "tok")
        assert client.request.call_args.kwargs["json"] == {"state_event": "reopen"}

    @pytest.mark.asyncio
    async def test_the_project_path_is_percent_encoded(self):
        """A GitLab project path contains slashes; unencoded it addresses a different route."""
        patcher, client = _client(_response())
        with patcher:
            await issue_sync.close_gitlab_issue("group/sub/proj", "9", "tok")
        url = client.request.call_args[0][1]
        assert "projects/group%2Fsub%2Fproj/issues/9" in url

    @pytest.mark.asyncio
    async def test_the_token_travels_as_a_private_token_header(self):
        patcher, client = _client(_response())
        with patcher:
            await issue_sync.close_gitlab_issue("group/proj", "9", "s3cret")
        assert client.request.call_args.kwargs["headers"] == {"PRIVATE-TOKEN": "s3cret"}

    @pytest.mark.asyncio
    async def test_a_self_hosted_gitlab_is_addressed(self):
        patcher, client = _client(_response())
        with patcher:
            await issue_sync.close_gitlab_issue("g/p", "1", "tok", "https://gitlab.example.invalid")
        assert client.request.call_args[0][1].startswith("https://gitlab.example.invalid/api/v4/projects/")

    @pytest.mark.asyncio
    async def test_a_transport_error_reports_false(self):
        with patch("httpx.AsyncClient", side_effect=httpx.ReadTimeout("slow")):
            assert await issue_sync.close_gitlab_issue("g/p", "1", "tok") is False


class TestFieldUpdates:
    @pytest.mark.asyncio
    async def test_github_fields_are_sent_verbatim(self):
        patcher, client = _client(_response())
        payload = {"title": "New title", "body": "New body"}
        with patcher:
            assert await issue_sync.update_github_issue_fields("o/r", "2", payload, "tok") is True
        assert client.request.call_args.kwargs["json"] == payload

    @pytest.mark.asyncio
    async def test_gitlab_fields_are_sent_verbatim(self):
        patcher, client = _client(_response())
        payload = {"title": "New title", "description": "New body"}
        with patcher:
            assert await issue_sync.update_gitlab_issue_fields("g/p", "2", payload, "tok") is True
        assert client.request.call_args.kwargs["json"] == payload

    @pytest.mark.asyncio
    async def test_a_refused_update_reports_false(self):
        patcher, _ = _client(_response(403))
        with patcher:
            assert await issue_sync.update_github_issue_fields("o/r", "2", {"title": "x"}, "tok") is False


class TestGitlabUserLookup:
    """GitLab assignees are numeric ids, so a username has to be resolved first."""

    @pytest.mark.asyncio
    async def test_a_known_username_resolves_to_an_id(self):
        patcher, client = _client(_response(body=[{"id": 42, "username": "someone"}]))
        with patcher:
            assert await issue_sync.lookup_gitlab_user_id("someone", "tok") == 42
        assert "users?username=someone" in client.request.call_args[0][1]

    @pytest.mark.asyncio
    async def test_an_unknown_username_resolves_to_none(self):
        patcher, _ = _client(_response(body=[]))
        with patcher:
            assert await issue_sync.lookup_gitlab_user_id("ghost", "tok") is None

    @pytest.mark.asyncio
    async def test_a_failed_lookup_resolves_to_none(self):
        patcher, _ = _client(_response(500))
        with patcher:
            assert await issue_sync.lookup_gitlab_user_id("someone", "tok") is None


class TestComments:
    @pytest.mark.asyncio
    async def test_creating_a_github_comment_returns_its_external_id(self):
        """The id is what lets a later edit or delete find the same comment."""
        patcher, client = _client(_response(201, {"id": 987}))
        with patcher:
            assert await issue_sync.create_github_issue_comment("o/r", "5", "hello", "tok") == "987"
        assert client.request.call_args[0][1].endswith("/repos/o/r/issues/5/comments")

    @pytest.mark.asyncio
    async def test_a_response_without_an_id_yields_none_rather_than_an_empty_string(self):
        patcher, _ = _client(_response(201, {}))
        with patcher:
            assert await issue_sync.create_github_issue_comment("o/r", "5", "hello", "tok") is None

    @pytest.mark.asyncio
    async def test_a_failed_create_yields_none(self):
        patcher, _ = _client(_response(422))
        with patcher:
            assert await issue_sync.create_github_issue_comment("o/r", "5", "hello", "tok") is None

    @pytest.mark.asyncio
    async def test_editing_a_github_comment_targets_the_comment_not_the_issue(self):
        patcher, client = _client(_response())
        with patcher:
            assert await issue_sync.update_github_issue_comment("o/r", "987", "edited", "tok") is True
        assert client.request.call_args[0][1].endswith("/repos/o/r/issues/comments/987")

    @pytest.mark.asyncio
    async def test_deleting_a_github_comment_sends_no_body(self):
        patcher, client = _client(_response(204))
        with patcher:
            assert await issue_sync.delete_github_issue_comment("o/r", "987", "tok") is True
        assert client.request.call_args[0][0] == "DELETE"
        assert client.request.call_args.kwargs["json"] is None

    @pytest.mark.asyncio
    async def test_creating_a_gitlab_note_returns_its_id(self):
        patcher, client = _client(_response(201, {"id": 55}))
        with patcher:
            assert await issue_sync.create_gitlab_issue_note("g/p", "3", "hello", "tok") == "55"
        assert client.request.call_args[0][1].endswith("/issues/3/notes")

    @pytest.mark.asyncio
    async def test_editing_a_gitlab_note_targets_the_note(self):
        patcher, client = _client(_response())
        with patcher:
            assert await issue_sync.update_gitlab_issue_note("g/p", "3", "55", "edited", "tok") is True
        assert client.request.call_args[0][1].endswith("/issues/3/notes/55")

    @pytest.mark.asyncio
    async def test_deleting_a_gitlab_note_targets_the_note(self):
        patcher, client = _client(_response(204))
        with patcher:
            assert await issue_sync.delete_gitlab_issue_note("g/p", "3", "55", "tok") is True
        assert client.request.call_args[0][0] == "DELETE"

    @pytest.mark.asyncio
    async def test_a_transport_error_on_a_comment_reports_falsy(self):
        with patch("httpx.AsyncClient", side_effect=httpx.ConnectError("down")):
            assert await issue_sync.create_github_issue_comment("o/r", "5", "hi", "tok") is None
            assert await issue_sync.update_github_issue_comment("o/r", "9", "hi", "tok") is False
            assert await issue_sync.delete_github_issue_comment("o/r", "9", "tok") is False


class TestLabels:
    @pytest.mark.asyncio
    async def test_github_labels_are_replaced_wholesale(self):
        """PUT, not POST: the label set is declared, not appended to."""
        patcher, client = _client(_response())
        with patcher:
            assert await issue_sync.replace_github_issue_labels("o/r", "4", ["bug", "p1"], "tok") is True
        method, url = client.request.call_args[0]
        assert method == "PUT"
        assert url.endswith("/repos/o/r/issues/4/labels")
        assert client.request.call_args.kwargs["json"] == {"labels": ["bug", "p1"]}

    @pytest.mark.asyncio
    async def test_an_empty_list_clears_the_labels(self):
        patcher, client = _client(_response())
        with patcher:
            await issue_sync.replace_github_issue_labels("o/r", "4", [], "tok")
        assert client.request.call_args.kwargs["json"] == {"labels": []}
