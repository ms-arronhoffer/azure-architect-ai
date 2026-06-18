"""SQLAlchemy 2.0 async data layer.

Same models work against SQLite (dev) and Postgres (prod) via the async URL.
Replaces the prior aiosqlite-only `db.py`.
"""
from __future__ import annotations

import datetime as dt
from collections.abc import AsyncIterator
from contextvars import ContextVar

from sqlalchemy import JSON, BigInteger, String, Text, event, select, text
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


def current_tenant_id() -> str:
    return tenant_id_var.get()


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


_engine = create_async_engine(settings.database_url, future=True, pool_pre_ping=True)
_Session = async_sessionmaker(_engine, expire_on_commit=False)


# Models that are partitioned per tenant. Global catalogs (RagDocument, Demo,
# RefArch) are intentionally excluded — they are shared knowledge bases.
_TENANT_SCOPED = (Conversation, Engagement, UserSecret, TokenUsage, AuditEvent)


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
    "RagDocument",
    "RefArch",
    "TokenUsage",
    "UserSecret",
    "current_engagement_id",
    "current_tenant_id",
    "engagement_id_var",
    "get_session",
    "init_db",
    "select",
    "session_scope",
    "tenant_id_var",
]
