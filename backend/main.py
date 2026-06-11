from contextlib import asynccontextmanager, AsyncExitStack
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from db import init_db
from config import settings
from limiter import limiter
from middleware.logging import RequestContextMiddleware, configure_logging
from services.mcp_service import init_mcp

configure_logging()
from routes.health import router as health_router
from routes.chat import router as chat_router
from routes.architecture import router as arch_router
from routes.reference import router as reference_router
from routes.conversations import router as conversations_router
from routes.export import router as export_router
from routes.improve import router as improve_router
from routes.presentation import router as presentation_router
from routes.settings import router as settings_router
from routes.codegen import router as codegen_router
from routes.intake import router as intake_router
from routes.analyze import router as analyze_router
from routes.parse import router as parse_router
from routes.auth import router as auth_router
from routes.rag import router as rag_router
from routes.scan import router as scan_router
from routes.iac import router as iac_router
from routes.cost import router as cost_router
from routes.security import router as security_router
from routes.whats_new import router as whats_new_router
from routes.strategy import router as strategy_router
from routes.admin import router as admin_router


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
        yield


app = FastAPI(title="Azure Architect AI", version="2.0.0", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
app.add_middleware(RequestContextMiddleware)
_CORS_DEFAULTS = ["http://localhost:5173", "http://localhost:3000"]
_extra = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_DEFAULTS + _extra,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
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
app.include_router(security_router, prefix="/api")
app.include_router(whats_new_router, prefix="/api")
app.include_router(strategy_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
