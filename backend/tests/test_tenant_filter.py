"""Tenant-scoping query filter (db.py do_orm_execute listener)."""
from __future__ import annotations

import time
import uuid

import pytest

from db import (
    AuditEvent,
    Conversation,
    TokenUsage,
    UserSecret,
    init_db,
    select,
    session_scope,
    tenant_id_var,
)


def _u() -> str:
    """Unique suffix so tests don't collide across the persistent dev DB."""
    return uuid.uuid4().hex[:8]


@pytest.mark.asyncio
async def test_conversation_select_scopes_to_current_tenant():
    await init_db()
    now = int(time.time() * 1000)
    suffix = _u()
    tok = tenant_id_var.set(f"tenant-isolation-A-{suffix}")
    try:
        async with session_scope() as s:
            s.add(Conversation(
                id=f"iso-a-{suffix}", mode="chat", title="A", created_at=now, updated_at=now,
                messages=[], user_id="ua",
            ))
            await s.commit()
    finally:
        tenant_id_var.reset(tok)

    tok = tenant_id_var.set(f"tenant-isolation-B-{suffix}")
    try:
        async with session_scope() as s:
            s.add(Conversation(
                id=f"iso-b-{suffix}", mode="chat", title="B", created_at=now, updated_at=now,
                messages=[], user_id="ub",
            ))
            await s.commit()
            rows = (await s.execute(select(Conversation))).scalars().all()
        ids = {r.id for r in rows}
        assert f"iso-b-{suffix}" in ids
        assert f"iso-a-{suffix}" not in ids
    finally:
        tenant_id_var.reset(tok)


@pytest.mark.asyncio
async def test_token_usage_select_scopes_to_current_tenant():
    await init_db()
    now = int(time.time() * 1000)
    suffix = _u()
    user = f"u-tu-{suffix}"
    tok = tenant_id_var.set(f"tt-A-{suffix}")
    try:
        async with session_scope() as s:
            s.add(TokenUsage(user_id=user, model="m", mode="chat",
                             prompt_tokens=10, completion_tokens=10, created_at=now))
            await s.commit()
    finally:
        tenant_id_var.reset(tok)

    tok = tenant_id_var.set(f"tt-B-{suffix}")
    try:
        async with session_scope() as s:
            rows = (await s.execute(
                select(TokenUsage).where(TokenUsage.user_id == user)
            )).scalars().all()
        assert rows == []
    finally:
        tenant_id_var.reset(tok)


@pytest.mark.asyncio
async def test_user_secret_select_scopes_to_current_tenant():
    await init_db()
    suffix = _u()
    user = f"u-ts-{suffix}"
    tok = tenant_id_var.set(f"ts-A-{suffix}")
    try:
        async with session_scope() as s:
            s.add(UserSecret(user_id=user, name="github_pat", value_encrypted="cipher"))
            await s.commit()
    finally:
        tenant_id_var.reset(tok)

    tok = tenant_id_var.set(f"ts-B-{suffix}")
    try:
        async with session_scope() as s:
            row = (await s.execute(
                select(UserSecret).where(UserSecret.user_id == user)
            )).scalar_one_or_none()
        assert row is None
    finally:
        tenant_id_var.reset(tok)


@pytest.mark.asyncio
async def test_audit_event_select_scopes_to_current_tenant():
    await init_db()
    now = int(time.time() * 1000)
    suffix = _u()
    user = f"u-ae-{suffix}"
    path = f"/api/chat-{suffix}"
    tok = tenant_id_var.set(f"ae-A-{suffix}")
    try:
        async with session_scope() as s:
            s.add(AuditEvent(
                user_id=user, request_id="r", method="POST", path=path,
                status_code=200, duration_ms=10, secret_hit_kinds=[], client_ip=None,
                created_at=now,
            ))
            await s.commit()
    finally:
        tenant_id_var.reset(tok)

    tok = tenant_id_var.set(f"ae-B-{suffix}")
    try:
        async with session_scope() as s:
            rows = (await s.execute(select(AuditEvent))).scalars().all()
        assert not any(r.user_id == user and r.path == path for r in rows)
    finally:
        tenant_id_var.reset(tok)


@pytest.mark.asyncio
async def test_skip_tenant_filter_returns_cross_tenant_rows():
    await init_db()
    now = int(time.time() * 1000)
    suffix = _u()
    for tid in (f"skip-A-{suffix}", f"skip-B-{suffix}"):
        tok = tenant_id_var.set(tid)
        try:
            async with session_scope() as s:
                s.add(Conversation(
                    id=f"skip-{tid}", mode="chat", title=tid,
                    created_at=now, updated_at=now, messages=[], user_id=tid,
                ))
                await s.commit()
        finally:
            tenant_id_var.reset(tok)

    tok = tenant_id_var.set(f"skip-A-{suffix}")
    try:
        async with session_scope() as s:
            rows = (await s.execute(
                select(Conversation).execution_options(skip_tenant_filter=True)
            )).scalars().all()
        ids = {r.id for r in rows}
        assert f"skip-skip-A-{suffix}" in ids
        assert f"skip-skip-B-{suffix}" in ids
    finally:
        tenant_id_var.reset(tok)


@pytest.mark.asyncio
async def test_insert_auto_assigns_current_tenant():
    await init_db()
    now = int(time.time() * 1000)
    suffix = _u()
    cid = f"auto-assign-{suffix}"
    tenant = f"auto-assign-tenant-{suffix}"
    tok = tenant_id_var.set(tenant)
    try:
        async with session_scope() as s:
            s.add(Conversation(
                id=cid, mode="chat", title="x",
                created_at=now, updated_at=now, messages=[], user_id="u",
            ))
            await s.commit()
            row = (await s.execute(
                select(Conversation).where(Conversation.id == cid)
            )).scalar_one()
        assert row.tenant_id == tenant
    finally:
        tenant_id_var.reset(tok)
