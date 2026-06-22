"""Runtime client configuration endpoint.

Exposes feature flags the SPA needs at boot. Reading these at runtime (rather
than baking them into the bundle via Vite ``VITE_*`` env vars) lets an operator
flip a flag with only a backend restart — no frontend rebuild or redeploy.

The endpoint is intentionally unauthenticated: it returns no secrets, only the
public feature-flag surface the SPA needs before the user signs in.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from services.feature_flags import unified_agents_enabled

router = APIRouter()


@router.get("/config")
async def client_config():
    return JSONResponse({
        "unified_agents": unified_agents_enabled(),
    })
