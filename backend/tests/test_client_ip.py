"""One resolver decides who a caller is, and how far it trusts the header (ADR-0109).

The behaviour worth pinning is not "does it parse a comma-separated list" — it is
that a forged X-Forwarded-For cannot change the answer, because that is the defect
this replaced: the login throttle took the leftmost entry, so a caller who varied it
per request got a fresh lockout bucket every time and the limit never applied.
"""

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.services.client_ip import client_ip, trusted_proxy_hops


@pytest.fixture
def probe():
    """An app whose only job is to report what client_ip() resolved to."""
    app = FastAPI()

    @app.get("/whoami")
    async def whoami(request: Request):
        return {"ip": client_ip(request)}

    return TestClient(app)


def _ask(probe, forwarded=None):
    headers = {"X-Forwarded-For": forwarded} if forwarded is not None else {}
    return probe.get("/whoami", headers=headers).json()["ip"]


class TestWithNoProxyDeclared:
    """Default configuration: the header is not evidence of anything."""

    def test_uses_the_socket_peer(self, probe, monkeypatch):
        monkeypatch.delenv("TRUSTED_PROXY_HOPS", raising=False)
        assert _ask(probe) == "testclient"

    def test_ignores_the_header_entirely(self, probe, monkeypatch):
        monkeypatch.delenv("TRUSTED_PROXY_HOPS", raising=False)
        assert _ask(probe, "203.0.113.9") == "testclient"

    def test_a_forged_chain_changes_nothing(self, probe, monkeypatch):
        monkeypatch.delenv("TRUSTED_PROXY_HOPS", raising=False)
        assert _ask(probe, "1.1.1.1, 2.2.2.2, 3.3.3.3") == "testclient"


class TestBehindOneProxy:
    """The topology the generated production compose always has: nginx in front."""

    @pytest.fixture(autouse=True)
    def _one_hop(self, monkeypatch):
        monkeypatch.setenv("TRUSTED_PROXY_HOPS", "1")

    def test_reads_the_address_the_proxy_recorded(self, probe):
        assert _ask(probe, "203.0.113.9") == "203.0.113.9"

    def test_a_client_supplied_prefix_is_stepped_over(self, probe):
        # The caller sent "X-Forwarded-For: 9.9.9.9"; nginx appended what it actually
        # saw. The forged entry is pushed left, and counting from the right skips it.
        assert _ask(probe, "9.9.9.9, 203.0.113.9") == "203.0.113.9"

    def test_a_long_forged_chain_is_still_stepped_over(self, probe):
        assert _ask(probe, "1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.9") == "203.0.113.9"

    def test_a_missing_header_falls_back_to_the_socket(self, probe):
        assert _ask(probe) == "testclient"


class TestBehindTwoProxies:
    """A CDN in front of the nginx — the count is what tells them apart."""

    @pytest.fixture(autouse=True)
    def _two_hops(self, monkeypatch):
        monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")

    def test_steps_past_both_proxies(self, probe):
        # client -> CDN -> nginx: CDN recorded the client, nginx recorded the CDN.
        assert _ask(probe, "203.0.113.9, 198.51.100.4") == "203.0.113.9"

    def test_a_forged_prefix_is_still_stepped_over(self, probe):
        assert _ask(probe, "9.9.9.9, 203.0.113.9, 198.51.100.4") == "203.0.113.9"

    def test_a_chain_shorter_than_declared_falls_back_to_the_socket(self, probe):
        # Only one entry where two hops were declared: the header was stripped, or the
        # count is wrong. Believing it would hand the caller their own answer.
        assert _ask(probe, "9.9.9.9") == "testclient"


class TestTheCountIsFailSafe:
    def test_unset_means_zero(self, monkeypatch):
        monkeypatch.delenv("TRUSTED_PROXY_HOPS", raising=False)
        assert trusted_proxy_hops() == 0

    def test_a_malformed_value_means_zero_not_everything(self, monkeypatch):
        monkeypatch.setenv("TRUSTED_PROXY_HOPS", "yes")
        assert trusted_proxy_hops() == 0

    def test_a_negative_value_means_zero(self, monkeypatch):
        monkeypatch.setenv("TRUSTED_PROXY_HOPS", "-3")
        assert trusted_proxy_hops() == 0


class TestBothThrottlesResolveTheCallerTheSameWay:
    """The defect was that they disagreed; a shared import is what fixes it."""

    def test_auth_and_rate_limiter_use_the_one_resolver(self):
        from app.routers import auth
        from app.services import rate_limiter

        assert auth.client_ip is client_ip
        assert rate_limiter.client_ip is client_ip
