"""OpenTelemetry + Azure Monitor (Application Insights) wiring.

Composes with the existing structlog setup in middleware/logging.py — it does
not replace it. When `settings.applicationinsights_connection_string` is unset
this module is a no-op and `tracer.start_as_current_span(...)` still works as
a non-recording span, so callers don't need try/except guards.
"""
from __future__ import annotations

from fastapi import FastAPI
from opentelemetry import metrics, trace

from config import settings
from middleware.logging import get_logger

__version__ = "2.0.0"

log = get_logger("observability")

# Module-level tracer and meter. Other services import these directly.
# Before configure_telemetry() runs these resolve to the default no-op
# providers, so spans/metrics are safe to create at import time.
tracer = trace.get_tracer(__name__)
meter = metrics.get_meter(__name__)

# Custom metrics (created once at import; safe under no-op providers).
tool_calls_counter = meter.create_counter(
    name="aa_tool_calls_total",
    description="Count of tool dispatches per tool_name in the chat route.",
    unit="1",
)

openai_tokens_histogram = meter.create_histogram(
    name="aa_openai_tokens_used",
    description="Total tokens reported by Azure OpenAI for a chat completion.",
    unit="token",
)

rag_cache_hit_latency_histogram = meter.create_histogram(
    name="aa_rag_cache_hit_latency_ms",
    description="Latency in ms for rag_service.search() end-to-end.",
    unit="ms",
)

_configured = False


def configure_telemetry(app: FastAPI) -> None:
    """Initialize Azure Monitor and instrument FastAPI/httpx/SQLAlchemy.

    Safe to call multiple times — only the first call wires Azure Monitor.
    When no connection string is configured, logs once and returns.
    """
    global _configured
    if _configured:
        return

    conn = settings.applicationinsights_connection_string
    if not conn:
        log.info("observability.disabled", reason="no_connection_string")
        _configured = True
        return

    try:
        from azure.monitor.opentelemetry import configure_azure_monitor

        configure_azure_monitor(
            connection_string=conn,
            resource_attributes={
                "service.name": "azure-architect-ai-backend",
                "service.version": __version__,
            },
        )
    except Exception as exc:  # azure-monitor may fail on misconfig; degrade gracefully
        log.warning("observability.azure_monitor_failed", error=str(exc))
        _configured = True
        return

    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(app)
    except Exception as exc:
        log.warning("observability.fastapi_instrument_failed", error=str(exc))

    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        HTTPXClientInstrumentor().instrument()
    except Exception as exc:
        log.warning("observability.httpx_instrument_failed", error=str(exc))

    try:
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

        SQLAlchemyInstrumentor().instrument()
    except Exception as exc:
        log.warning("observability.sqlalchemy_instrument_failed", error=str(exc))

    # Refresh module-level handles to ensure they bind to the configured providers.
    global tracer, meter
    tracer = trace.get_tracer(__name__)
    meter = metrics.get_meter(__name__)

    log.info("observability.enabled", service="azure-architect-ai-backend", version=__version__)
    _configured = True


__all__ = [
    "__version__",
    "configure_telemetry",
    "meter",
    "openai_tokens_histogram",
    "rag_cache_hit_latency_histogram",
    "tool_calls_counter",
    "tracer",
]
