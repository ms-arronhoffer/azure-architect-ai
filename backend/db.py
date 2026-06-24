"""SQLAlchemy 2.0 async data layer.

Same models work against SQLite (dev) and Postgres (prod) via the async URL.
Replaces the prior aiosqlite-only `db.py`.
"""
from __future__ import annotations

import datetime as dt
from collections.abc import AsyncIterator
from contextvars import ContextVar

from sqlalchemy import JSON, BigInteger, LargeBinary, String, Text, event, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, with_loader_criteria

from config import settings

# Per-request tenant scope. Populated by TenantContextMiddleware from the JWT
# `tid` claim. Defaults to "default" so unauthenticated/dev requests still
# operate against a single logical tenant.
tenant_id_var: ContextVar[str] = ContextVar("tenant_id", default="default")

# Per-request engagement scope. Populated by EngagementContextMiddleware from
# the `X-Engagement-Id` header. None when the caller has no active engagement.
# Cost + scan routes read this to auto-scope to the engagement's subscriptions;
# chat prepends the engagement preamble to the system prompt when set.
engagement_id_var: ContextVar[str | None] = ContextVar("engagement_id", default=None)

# Per-request user scope. Populated by TenantContextMiddleware from the JWT
# `oid`/`sub` claim. None for unauthenticated/background work. Read by the
# token-usage recorder so LLM calls made deep inside services (cost/demo
# pipelines, router, reranker, embeddings) are attributed to the caller even
# when the route handler does not thread the user id through explicitly.
user_id_var: ContextVar[str | None] = ContextVar("user_id", default=None)


def current_tenant_id() -> str:
    return tenant_id_var.get()


def current_user_id() -> str | None:
    return user_id_var.get()


def current_engagement_id() -> str | None:
    return engagement_id_var.get()


class Base(DeclarativeBase):
    pass


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    mode: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    messages: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    structured_result: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    engagement_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64), nullable=False, default=current_tenant_id, index=True
    )


class Engagement(Base):
    """Customer engagement scope. Holds the few facts the model needs to
    answer cost/scan questions without re-typing them every chat: which
    subscriptions, what industry, what compliance frameworks apply, and the
    preferred deployment region. Soft-deleted by status='archived'.
    """

    __tablename__ = "engagements"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    customer_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    industry: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    compliance_frameworks: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    subscription_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    region_preference: Mapped[str | None] = mapped_column(String(64), nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reservation_commitments: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64), nullable=False, default=current_tenant_id, index=True
    )
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)


class EngagementReference(Base):
    """Per-engagement bookmark: URL link, uploaded file, or both.

    File bytes stored inline as LargeBinary with a 5 MB cap enforced at the route
    layer. Postgres handles this fine for the handful of small reference docs
    (CSA workbooks, process PDFs) this is sized for; revisit blob storage if we
    grow beyond ~50 refs per engagement.
    """

    __tablename__ = "engagement_references"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    engagement_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    file_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    file_mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    file_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64), nullable=False, default=current_tenant_id, index=True
    )
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)


class RagDocument(Base):
    """RAG corpus entry. Embedding stored as JSON array for cross-DB portability
    (SQLite has no vector type; pgvector optimization deferred since corpus is small).
    """

    __tablename__ = "rag_documents"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    corpus: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source_id: Mapped[str] = mapped_column(String(256), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list] = mapped_column(JSON, nullable=False)
    doc_metadata: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Per-engagement scoping for tenant_inventory corpus chunks. Null for
    # public corpora (learn / avm / reference_archs / azure_updates).
    # Indexed because hybrid_search filters on it when an engagement is active.
    engagement_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    updated_at: Mapped[dt.datetime] = mapped_column(
        nullable=False, default=lambda: dt.datetime.now(dt.UTC).replace(tzinfo=None)
    )


class UserSecret(Base):
    """Encrypted per-user secrets (e.g. GitHub PAT). Value is Fernet ciphertext."""

    __tablename__ = "user_secrets"

    user_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    value_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    tenant_id: Mapped[str] = mapped_column(
        String(64), nullable=False, default=current_tenant_id, index=True
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        nullable=False, default=lambda: dt.datetime.now(dt.UTC).replace(tzinfo=None)
    )


class TokenUsage(Base):
    """Per-request token counts keyed by user, model, and mode."""

    __tablename__ = "token_usage"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    mode: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(nullable=False, default=0)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64), nullable=False, default=current_tenant_id, index=True
    )


class AuditEvent(Base):
    """Append-only audit trail for API calls.

    `secret_hit_kinds` records the categories of redaction patterns matched in
    the inbound request body (e.g. ["jwt", "github_pat"]). When the system is
    in `audit_redaction_shadow_mode=true`, hits are LOGGED but the body is not
    actually mutated — used to validate redaction rules before enforcing them.
    """

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    method: Mapped[str] = mapped_column(String(8), nullable=False)
    path: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    status_code: Mapped[int] = mapped_column(nullable=False)
    duration_ms: Mapped[int] = mapped_column(nullable=False, default=0)
    secret_hit_kinds: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    client_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64), nullable=False, default=current_tenant_id, index=True
    )


class Demo(Base):
    """Demo showcase entry — global (not user-scoped) catalog of demos."""

    __tablename__ = "demos"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tags: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    video_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    repo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    live_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    featured: Mapped[bool] = mapped_column(nullable=False, default=False)
    created_at: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="custom", index=True)
    last_synced_at: Mapped[str | None] = mapped_column(String(64), nullable=True)


class WhatsNewCache(Base):
    """Singleton-keyed cache of fetched announcement feeds.

    One row per logical feed set (currently just "default"). `items` holds the
    full deduplicated list as JSON; the daily scheduler overwrites it. Reads
    are O(1) by primary key. Global catalog — not tenant-scoped.
    """

    __tablename__ = "whats_new_cache"

    feed_set: Mapped[str] = mapped_column(String(64), primary_key=True)
    items: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    fetched_at: Mapped[dt.datetime] = mapped_column(
        nullable=False, default=lambda: dt.datetime.now(dt.UTC).replace(tzinfo=None)
    )


class RefArch(Base):
    """Reference architecture catalog entry — global library of MS-official + custom architectures."""

    __tablename__ = "ref_archs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    slug: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str] = mapped_column(String(64), nullable=False, default="general", index=True)
    tags: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    services: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    patterns: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    waf_score: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    estimated_monthly: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    complexity: Mapped[str] = mapped_column(String(16), nullable=False, default="Medium")
    learn_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    repo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    bicep_avm_module: Mapped[str | None] = mapped_column(Text, nullable=True)
    diagram_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="custom", index=True)
    featured: Mapped[bool] = mapped_column(nullable=False, default=False)
    created_at: Mapped[str] = mapped_column(String(64), nullable=False)
    last_synced_at: Mapped[str | None] = mapped_column(String(64), nullable=True)


class PricingMeter(Base):
    """A single Azure Retail price meter — global reference data scraped from
    prices.azure.com (not tenant-scoped, like RefArch).

    One row per (meterId, armRegionName, currencyCode). `search_key` is the
    normalised lowercase token string the resolver matches against so compact
    ARM/diagram SKUs (``P1v4``) collide with the Retail display form
    (``P1 v4``). Indexed on serviceName, armRegionName, and search_key.
    """

    __tablename__ = "pricing_meters"

    id: Mapped[str] = mapped_column(String(160), primary_key=True)
    meter_id: Mapped[str] = mapped_column(String(96), nullable=False, index=True)
    service_name: Mapped[str] = mapped_column(String(128), nullable=False, default="", index=True)
    service_family: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    product_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    sku_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    meter_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    arm_sku_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    arm_region_name: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)
    unit_of_measure: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    retail_price: Mapped[float] = mapped_column(nullable=False, default=0.0)
    currency_code: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    price_type: Mapped[str] = mapped_column(String(32), nullable=False, default="Consumption")
    search_key: Mapped[str] = mapped_column(String(256), nullable=False, default="", index=True)
    effective_start_date: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_synced_at: Mapped[str] = mapped_column(String(64), nullable=False)


class ArbSubmission(Base):
    """Architecture Review Board submission — a frozen design that has been
    handed off for governance review. The `bundled_design_snapshot` and
    `citation_snapshot` columns capture the artifact exactly as it stood at
    submit time so reviewers always see what the architect signed off on,
    even if the upstream RAG docs or design panels are later edited.
    """

    __tablename__ = "arb_submissions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    engagement_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    submitted_by: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    submitted_at: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="submitted", index=True)
    bundled_design_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    citation_snapshot: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    inventory_snapshot_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reviewer_packet_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64), nullable=False, default=current_tenant_id, index=True
    )
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)


class MigrationJob(Base):
    """Async Model IQ bundle job.

    A single job ingests 1..N retirement-report CSVs, runs analysis +
    narrative, produces 1..3 export formats, and zips them. The route layer
    returns the row immediately with ``status='pending'``; a background
    task drives it through ``running -> complete|failed`` and writes the
    finished ZIP to ``backend/data/model_iq_bundles/{id}.zip``. Rows older
    than 24 h are purged by a scheduler cron alongside the on-disk zip.
    """

    __tablename__ = "migration_jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    phase: Mapped[str | None] = mapped_column(String(32), nullable=True)
    formats: Mapped[str] = mapped_column(String(64), nullable=False, default="pptx,docx,pdf")
    files_total: Mapped[int] = mapped_column(nullable=False, default=0)
    files_done: Mapped[int] = mapped_column(nullable=False, default=0)
    bundle_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    terminal_event: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    engagement_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64), nullable=False, default=current_tenant_id, index=True
    )
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    completed_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class ArbCondition(Base):
    """Trackable approval condition attached to an ARB submission. Each row
    is a single remediation item (e.g. "Enable PIM for Key Vault admins")
    with its own severity, owner, due date, and evidence trail. Lets the
    'approved with conditions' state be enforceable rather than aspirational.
    """

    __tablename__ = "arb_conditions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    submission_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="minor")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open", index=True)
    owner: Mapped[str | None] = mapped_column(String(128), nullable=True)
    due_date: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    evidence_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    cleared_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    cleared_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64), nullable=False, default=current_tenant_id, index=True
    )
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)


_engine = create_async_engine(settings.database_url, future=True, pool_pre_ping=True)
_Session = async_sessionmaker(_engine, expire_on_commit=False)


# Models that are partitioned per tenant. Global catalogs (RagDocument, Demo,
# RefArch) are intentionally excluded — they are shared knowledge bases.
_TENANT_SCOPED = (
    Conversation,
    Engagement,
    EngagementReference,
    UserSecret,
    TokenUsage,
    AuditEvent,
    ArbSubmission,
    ArbCondition,
    MigrationJob,
)


@event.listens_for(Session, "do_orm_execute")
def _apply_tenant_filter(execute_state) -> None:
    """Inject `tenant_id = <current>` into every ORM read/update/delete
    against a tenant-scoped model.

    Opt out per query with `.execution_options(skip_tenant_filter=True)` —
    used by admin/scheduler jobs that legitimately need cross-tenant reach.
    Inserts auto-populate via the column's `default=current_tenant_id`.
    """
    if execute_state.execution_options.get("skip_tenant_filter"):
        return
    if not (
        execute_state.is_select
        or execute_state.is_update
        or execute_state.is_delete
    ):
        return
    tenant_id = current_tenant_id()
    for entity in _TENANT_SCOPED:
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(
                entity,
                lambda cls: cls.tenant_id == tenant_id,
                include_aliases=True,
            )
        )


async def init_db() -> None:
    """Create tables if they do not exist. Idempotent."""
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(
            text("UPDATE conversations SET user_id = 'default' WHERE user_id IS NULL")
        )
        await _ensure_column(conn, "demos", "live_url", "TEXT")
        await _ensure_column(conn, "demos", "source", "TEXT")
        await _ensure_column(conn, "demos", "last_synced_at", "TEXT")
        await _ensure_column(conn, "ref_archs", "last_synced_at", "TEXT")
        # Tenant scoping (P1): add tenant_id to user-scoped tables and backfill
        # legacy rows with "default" so existing single-tenant deployments keep
        # working unchanged.
        for table in ("conversations", "user_secrets", "token_usage", "audit_events"):
            await _ensure_column(conn, table, "tenant_id", "VARCHAR(64)")
            await conn.execute(
                text(f"UPDATE {table} SET tenant_id = 'default' WHERE tenant_id IS NULL")
            )
        # Engagement linkage on conversations (Theme 4): nullable so legacy
        # rows and "no engagement selected" requests both keep working.
        await _ensure_column(conn, "conversations", "engagement_id", "VARCHAR(64)")
        # Per-engagement RAG chunks (tenant_inventory corpus). Null for
        # public corpora — existing rows backfill to NULL implicitly.
        await _ensure_column(conn, "rag_documents", "engagement_id", "VARCHAR(64)")


async def _ensure_column(conn, table: str, column: str, ddl_type: str) -> None:
    """Add `column` to `table` if missing. Dialect-agnostic via SQLAlchemy Inspector."""
    from sqlalchemy import inspect

    def _has_column(sync_conn) -> bool:
        insp = inspect(sync_conn)
        if table not in insp.get_table_names():
            return True  # table doesn't exist yet; create_all will build it correctly
        return any(c["name"] == column for c in insp.get_columns(table))

    if await conn.run_sync(_has_column):
        return
    await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))


async def get_session() -> AsyncIterator[AsyncSession]:
    async with _Session() as session:
        yield session


def session_scope() -> AsyncSession:
    """Return a new AsyncSession for use as `async with session_scope() as s:`.

    Prefer FastAPI's `Depends(get_session)` inside routes; use this only in
    contexts where dependency injection is not available (e.g. inside an
    SSE generator that has already started streaming).
    """
    return _Session()


__all__ = [
    "AuditEvent",
    "Base",
    "Conversation",
    "Demo",
    "Engagement",
    "EngagementReference",
    "MigrationJob",
    "PricingMeter",
    "RagDocument",
    "RefArch",
    "TokenUsage",
    "UserSecret",
    "WhatsNewCache",
    "current_engagement_id",
    "current_tenant_id",
    "current_user_id",
    "engagement_id_var",
    "get_session",
    "init_db",
    "select",
    "session_scope",
    "tenant_id_var",
    "user_id_var",
]
