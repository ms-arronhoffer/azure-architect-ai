"""Per-user daily token budget tests (services/token_service.py)."""
from __future__ import annotations

import time

import pytest

from config import settings
from db import TokenUsage, init_db, session_scope, tenant_id_var
from services.token_service import check_daily_budget, daily_usage_tokens


@pytest.fixture(autouse=True)
def _isolated_default_tenant():
    tok = tenant_id_var.set("default")
    yield
    tenant_id_var.reset(tok)


async def _seed_usage(user_id: str, total_tokens: int, age_ms: int = 0) -> None:
    """Insert one TokenUsage row with the requested age."""
    async with session_scope() as s:
        s.add(TokenUsage(
            user_id=user_id,
            model="gpt-4o-mini",
            mode="chat",
            prompt_tokens=total_tokens // 2,
            completion_tokens=total_tokens - (total_tokens // 2),
            created_at=int(time.time() * 1000) - age_ms,
        ))
        await s.commit()


@pytest.mark.asyncio
async def test_daily_usage_sums_recent_rows():
    await init_db()
    await _seed_usage("u-budget-1", 100)
    await _seed_usage("u-budget-1", 250)
    used = await daily_usage_tokens("u-budget-1")
    assert used >= 350


@pytest.mark.asyncio
async def test_daily_usage_ignores_rows_older_than_24h():
    await init_db()
    await _seed_usage("u-budget-old", 5_000, age_ms=25 * 60 * 60 * 1000)
    used = await daily_usage_tokens("u-budget-old")
    assert used == 0


@pytest.mark.asyncio
async def test_daily_usage_scoped_per_user():
    await init_db()
    import uuid
    suffix = uuid.uuid4().hex[:8]
    alice = f"u-budget-alice-{suffix}"
    bob = f"u-budget-bob-{suffix}"
    await _seed_usage(alice, 500)
    await _seed_usage(bob, 999)
    assert await daily_usage_tokens(alice) == 500
    assert await daily_usage_tokens(bob) == 999


@pytest.mark.asyncio
async def test_check_budget_allows_under_limit(monkeypatch):
    await init_db()
    monkeypatch.setattr(settings, "daily_token_budget_per_user", 10_000)
    await _seed_usage("u-budget-under", 100)
    allowed, used, limit = await check_daily_budget("u-budget-under")
    assert allowed
    assert used >= 100
    assert limit == 10_000


@pytest.mark.asyncio
async def test_check_budget_denies_over_limit(monkeypatch):
    await init_db()
    monkeypatch.setattr(settings, "daily_token_budget_per_user", 500)
    await _seed_usage("u-budget-over", 800)
    allowed, used, limit = await check_daily_budget("u-budget-over")
    assert not allowed
    assert used >= 800
    assert limit == 500


@pytest.mark.asyncio
async def test_check_budget_disabled_when_zero(monkeypatch):
    monkeypatch.setattr(settings, "daily_token_budget_per_user", 0)
    allowed, used, limit = await check_daily_budget("u-anyone")
    assert allowed
    assert used == 0
    assert limit == 0
