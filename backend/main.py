from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from config import settings
from db import init_db
from limiter import limiter
from middleware.audit import AuditMiddleware
from middleware.logging import RequestContextMiddleware, configure_logging
from middleware.tenant import TenantContextMiddleware
from services.mcp_service import init_mcp

configure_logging()
from routes.admin import router as admin_router  # noqa: E402
from routes.analyze import router as analyze_router  # noqa: E402
from routes.architecture import router as arch_router  # noqa: E402
from routes.auth import router as auth_router  # noqa: E402
from routes.chat import router as chat_router  # noqa: E402
from routes.codegen import router as codegen_router  # noqa: E402
from routes.conversations import router as conversations_router  # noqa: E402
from routes.cost import router as cost_router  # noqa: E402
from routes.demos import router as demos_router  # noqa: E402
from routes.demos_admin import router as demos_admin_router  # noqa: E402
from routes.engagements import router as engagements_router  # noqa: E402
from routes.export import router as export_router  # noqa: E402
from routes.health import router as health_router  # noqa: E402
from routes.iac import router as iac_router  # noqa: E402
from routes.improve import router as improve_router  # noqa: E402
from routes.intake import router as intake_router  # noqa: E402
from routes.model_migration import router as model_migration_router  # noqa: E402
from routes.parse import router as parse_router  # noqa: E402
from routes.presentation import router as presentation_router  # noqa: E402
from routes.rag import router as rag_router  # noqa: E402
from routes.refarch import router as refarch_router  # noqa: E402
from routes.refarch_admin import router as refarch_admin_router  # noqa: E402
from routes.reference import router as reference_router  # noqa: E402
from routes.report_analyzer import router as report_analyzer_router  # noqa: E402
from routes.scan import router as scan_router  # noqa: E402
from routes.security import router as security_router  # noqa: E402
from routes.settings import router as settings_router  # noqa: E402
from routes.strategy import router as strategy_router  # noqa: E402
from routes.whats_new import router as whats_new_router  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncExitStack() as stack:
        try:
            await init_db()
        except Exception as exc:
            from middleware.logging import get_logger
            get_logger("startup").warning("db.init_skipped", error=str(exc))
        # Wire OpenTelemetry + Azure Monitor after middleware is registered (see below).
        from observability import configure_telemetry
        configure_telemetry(app)
        if settings.mcp_enabled:
            await init_mcp(stack)
        if settings.rag_enabled:
            try:
                from services.rag_service import reindex_reference_archs
                await reindex_reference_archs()
            except Exception as exc:
                from middleware.logging import get_logger
                get_logger("startup").warning("rag.warmup_failed", error=str(exc))
        try:
            from services.scheduler import shutdown_scheduler, start_scheduler
            start_scheduler()
            stack.push_async_callback(shutdown_scheduler)
        except Exception as exc:
            from middleware.logging import get_logger
            get_logger("startup").warning("scheduler.start_failed", error=str(exc))
        yield


app = FastAPI(title="Azure Architect AI", version="2.0.0", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
if settings.audit_log_enabled:
    app.add_middleware(AuditMiddleware)
app.add_middleware(TenantContextMiddleware)
app.add_middleware(RequestContextMiddleware)
_CORS_DEFAULTS = ["http://localhost:5173", "http://localhost:3000"]
_extra = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_DEFAULTS + _extra,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(health_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(arch_router, prefix="/api")
app.include_router(reference_router, prefix="/api")
app.include_router(conversations_router, prefix="/api")
app.include_router(export_router, prefix="/api")
app.include_router(improve_router, prefix="/api")
app.include_router(presentation_router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(codegen_router, prefix="/api")
app.include_router(intake_router, prefix="/api")
app.include_router(analyze_router, prefix="/api")
app.include_router(parse_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(rag_router, prefix="/api")
app.include_router(scan_router, prefix="/api")
app.include_router(iac_router, prefix="/api")
app.include_router(cost_router, prefix="/api")
app.include_router(engagements_router, prefix="/api")
app.include_router(demos_router, prefix="/api")
app.include_router(demos_admin_router, prefix="/api")
app.include_router(refarch_router, prefix="/api")
app.include_router(refarch_admin_router, prefix="/api")
app.include_router(security_router, prefix="/api")
app.include_router(model_migration_router, prefix="/api")
app.include_router(report_analyzer_router, prefix="/api")
app.include_router(whats_new_router, prefix="/api")
app.include_router(strategy_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
