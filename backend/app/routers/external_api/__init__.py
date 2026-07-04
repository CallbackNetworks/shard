"""
External API v1 — authenticated with API keys.

All endpoints require an `X-API-Key` header.
Scopes: read (GET), write (POST/PATCH/DELETE), admin (all).
"""

from fastapi import APIRouter, Depends

from app.routers.external_api.activity import sub_router as activity_router
from app.routers.external_api.agent_context import sub_router as agent_context_router
from app.routers.external_api.analytics import sub_router as analytics_router
from app.routers.external_api.comments import sub_router as comments_router
from app.routers.external_api.dependencies import sub_router as dependencies_router
from app.routers.external_api.email import sub_router as email_router
from app.routers.external_api.labels import sub_router as labels_router
from app.routers.external_api.notifications import sub_router as notifications_router
from app.routers.external_api.progress import sub_router as progress_router
from app.routers.external_api.projects import sub_router as projects_router
from app.routers.external_api.search import sub_router as search_router
from app.routers.external_api.stats import sub_router as stats_router
from app.routers.external_api.subscriptions import sub_router as subscriptions_router
from app.routers.external_api.summary import sub_router as summary_router
from app.routers.external_api.tasks import sub_router as tasks_router
from app.routers.external_api.tools_schema import sub_router as tools_schema_router
from app.services.rate_limiter import api_rate_limit

router = APIRouter(prefix="/api/v1", tags=["External API v1"], dependencies=[Depends(api_rate_limit)])

router.include_router(projects_router)
router.include_router(tasks_router)
router.include_router(stats_router)
router.include_router(email_router)
router.include_router(summary_router)
router.include_router(activity_router)
router.include_router(search_router)
router.include_router(comments_router)
router.include_router(labels_router)
router.include_router(dependencies_router)
router.include_router(analytics_router)
router.include_router(notifications_router)
router.include_router(agent_context_router)
router.include_router(progress_router)
router.include_router(tools_schema_router)
router.include_router(subscriptions_router)
