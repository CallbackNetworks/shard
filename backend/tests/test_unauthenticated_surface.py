"""What this server answers without any credential at all (ADR-0085).

``main.py``'s ``_AUTH_BYPASS`` exempts whole path *prefixes* from the password gate, and it
has to: a CI runner cannot carry the owner's session, a share link is for someone who has no
account, a health check has no identity. Each of those endpoints authenticates itself — a
callback token plus an HMAC signature, a share token, nothing to protect.

The hazard is that the exemption attaches to the prefix, so an endpoint added *near* one of
those inherits it by adjacency. That is exactly what happened to build history: it was added
to ``routers/webhooks.py`` as ``GET /webhook/events/{task_id}``, checked nothing, and was
readable off production by anyone holding a node id — while the identical read one segment
away under ``/api`` returned 401.

So this test enumerates the app's own published route table and pins the set. A new
unauthenticated endpoint is not forbidden; it has to be named here, next to the reason it
can be one. Same shape as ADR-0059's redaction rule: the invariant is about the surface, so
it is checked against the surface rather than trusted to each author.

Read from ``app.openapi()`` rather than by walking ``app.routes``, which nests included
routers and needs prefix reassembly — a test that reconstructs the paths could reassemble
them wrongly and pass against a surface that does not exist (the near-miss ADR-0061 records).
This asks the app what it publishes.
"""

from app.main import _AUTH_BYPASS, app

# Every documented route reachable with no credential, and why it may be. Anything under a
# bypassed prefix that is not here is either a mistake or an entry somebody has to justify.
#
# `/api/v1` is excluded from the sweep, not from scrutiny: it is a whole namespace bypassed
# here because `X-API-Key` is its sole auth mechanism, enforced per endpoint and pinned by
# `test_external_api.py`. `/docs`, `/redoc`, `/openapi.json`, `/ws` and `/mcp` carry no
# OpenAPI entry and so never reach this listing.
JUSTIFIED = {
    # A CI runner has no session. The token in the path is the address, and an HMAC
    # signature over the body proves the caller holds the node's key (ADR-0060).
    ("POST", "/webhook/callback/{callback_token}"),
    # Same reasoning: an issue-tracker webhook authenticates with the integration's secret.
    ("POST", "/webhook/issues/{project_id}"),
    # A share link is for someone with no account. The token is the credential, and a PIN
    # may be required on top (ADR-0070→0073).
    ("GET", "/share/node/{token}"),
    ("POST", "/share/node/{token}/verify"),
    ("POST", "/share/node/{token}/notes"),
    ("POST", "/share/node/{token}/tasks/{task_id}/notes"),
    # A calendar client cannot log in either; the token in the path is the credential.
    ("GET", "/ical/node/{token}.ics"),
    ("GET", "/ical/all/{token}.ics"),
    # Logging in cannot require being logged in.
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/auth/me"),
    # Liveness. Carries no user data.
    ("GET", "/health"),
}


def _public_routes() -> set[tuple[str, str]]:
    return {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
        if any(path.startswith(prefix) for prefix in _AUTH_BYPASS) and not path.startswith("/api/v1")
    }


def test_no_endpoint_is_unauthenticated_by_accident():
    """The whole point: an endpoint must not become public by sharing a prefix with one that
    had earned it."""
    unjustified = _public_routes() - JUSTIFIED
    assert not unjustified, (
        "These routes answer without any credential and are not listed as deliberate. Either "
        "move them under /api (the password gate) or /api/v1 (an API key), or add them to "
        f"JUSTIFIED with the reason they can be public: {sorted(unjustified)}"
    )


def test_the_listing_does_not_rot():
    """A justified entry that no longer exists means the reasoning above describes a route
    that is gone — the next person adding one nearby reads a stale map."""
    stale = JUSTIFIED - _public_routes()
    assert not stale, f"JUSTIFIED lists routes that no longer exist: {sorted(stale)}"


class TestBuildHistoryLeftThePublicPrefix:
    """Negative controls on the actual fix. Asserting only that the new route works would
    pass just as well with the old one still sitting there answering everybody."""

    def test_the_old_path_is_gone(self, client):
        assert client.get("/webhook/events/some-node-id").status_code == 404
        assert ("GET", "/webhook/events/{task_id}") not in _public_routes()

    def test_the_prefix_carries_only_what_a_runner_posts_to(self):
        webhook_routes = {r for r in _public_routes() if r[1].startswith("/webhook")}
        assert all(method == "POST" for method, _ in webhook_routes), (
            f"/webhook/ is exempt from auth so a CI runner can POST to it; a GET there reads "
            f"platform data with no credential: {sorted(webhook_routes)}"
        )

    def test_the_read_now_lives_behind_both_gates(self, client, db, sample_project):
        from app.services import graph

        # Present on the internal surface (this test client is unauthenticated by design —
        # AUTH_PASSWORD is empty in tests — so this asserts the route exists, and
        # test_no_endpoint_is_unauthenticated_by_accident asserts it is gated).
        assert client.get(f"/api/nodes/{sample_project.id}/webhook-events").status_code == 200
        # ...and on v1, where it needs a key.
        assert client.get(f"/api/v1/nodes/{sample_project.id}/webhook-events").status_code == 422
        assert graph.get_node(db, sample_project.id) is not None
