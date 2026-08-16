"""A refusal belongs to the act, not to the door it arrived through (ADR-0085).

Every capability this codebase exposes twice — once on the internal ``/api`` for the SPA,
once on ``/api/v1`` for agents — has to refuse the same things the same way, or the two
doors have quietly become two products. The failure mode is not hypothetical: ADR-0079
found the type registry enforcing its guards on one surface only, and its fix was a test
asserting both doors return the same status *and* the same detail.

Doing that with ``HTTPException`` means the service layer cannot raise: ``HTTPException``
is a FastAPI concept, so the refusal has to live in the router, which means writing it
twice and keeping two copies in step. Doing it with bare ``ValueError`` means every router
re-decides which status a given failure deserves — the same fork, one layer down.

So a service raises ``ServiceError`` carrying the status it deserves, and ``main.py``
registers one handler that renders it as ``{"detail": ...}``. Both doors get the identical
refusal because neither door writes one.
"""


class ServiceError(Exception):
    """A refusal with the HTTP status it deserves, raised from the service layer."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class NotFound(ServiceError):
    def __init__(self, detail: str = "not found") -> None:
        super().__init__(404, detail)


class Invalid(ServiceError):
    """The request is well-formed but asks for something this act cannot do."""

    def __init__(self, detail: str) -> None:
        super().__init__(400, detail)


class Unprocessable(ServiceError):
    """The request contradicts itself — a rule whose conditions its trigger never supplies,
    an event nothing delivers. 422 rather than 400 because the shape is wrong, not the
    world (see ``workflow_rules`` for why that distinction is load-bearing)."""

    def __init__(self, detail: str) -> None:
        super().__init__(422, detail)
