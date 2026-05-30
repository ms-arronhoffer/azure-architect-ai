from contextlib import asynccontextmanager, AsyncExitStack
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import init_db
from config import settings
from services.mcp_service import init_mcp
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncExitStack() as stack:
        await init_db()
        if settings.mcp_enabled:
            await init_mcp(stack)
        yield


app = FastAPI(title="Azure Architect AI", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
