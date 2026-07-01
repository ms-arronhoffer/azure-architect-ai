"""Engagement workspace route tests.

Covers the save/recall/clear story for tool outputs tied to an engagement:

1. save_and_list — artifacts round-trip and come back newest-first
2. recall_preamble — recent_artifacts folds saved outputs into the active
   engagement preamble so other tools recall them
3. clear_workspace — the "Start over" action wipes every artifact
4. tenant/user scoping — one architect can't see another's artifacts
5. prune — the workspace stays bounded to MAX_ARTIFACTS_PER_ENGAGEMENT

Pattern mirrors ``test_arb.py``: override ``get_current_user`` so the
``X-Test-User`` header selects the principal, then drive the routes through an
httpx ``ASGITransport`` client.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from fastapi import Request


def _u() -> str:
    return uuid.uuid4().hex[:8]


def _claims_for_header(header_value: str | None) -> dict[str, str] | None:
    if not header_value:
        return None
    return {"oid": header_value, "sub": header_value}


@pytest_asyncio.fixture
async def auth_client():
    import httpx

    from auth.entra import get_current_user
    from db import init_db
    from main import app

    async def fake_get_current_user(request: Request):
        return _claims_for_header(request.headers.get("X-Test-User"))

    app.dependency_overrides[get_current_user] = fake_get_current_user

    await init_db()
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def _engagement_payload(name: str) -> dict:
    return {
        "name": name,
        "customer_name": "Acme",
        "industry": "fintech",
        "compliance_frameworks": ["PCI-DSS"],
        "subscription_ids": [],
        "region_preference": "eastus2",
        "notes": "",
        "reservation_commitments": {},
        "status": "active",
    }


async def _create_engagement(client, principal: str, name: str) -> str:
    r = await client.post(
        "/api/engagements",
        json=_engagement_payload(name),
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _artifact(tool: str, title: str, summary: str = "", **data) -> dict:
    return {"tool": tool, "title": title, "kind": "markdown", "summary": summary, "data": data}


@pytest.mark.asyncio
async def test_save_and_list_newest_first(auth_client):
    user = _u()
    eid = await _create_engagement(auth_client, user, "Acme migration")

    a = await auth_client.post(
        f"/api/engagements/{eid}/workspace",
        json=_artifact("namingstandards", "CAF naming", "Naming spec for contoso", text="# spec"),
        headers={"X-Test-User": user},
    )
    assert a.status_code == 201, a.text
    b = await auth_client.post(
        f"/api/engagements/{eid}/workspace",
        json=_artifact("cost-optimize", "AKS worksheet", "Monthly $4,200"),
        headers={"X-Test-User": user},
    )
    assert b.status_code == 201, b.text

    r = await auth_client.get(
        f"/api/engagements/{eid}/workspace", headers={"X-Test-User": user}
    )
    assert r.status_code == 200
    items = r.json()
    assert [i["title"] for i in items] == ["AKS worksheet", "CAF naming"]
    assert items[1]["data"]["text"] == "# spec"


@pytest.mark.asyncio
async def test_saved_outputs_recalled_in_preamble(auth_client):
    from db import engagement_id_var
    from services import engagement_context

    user = _u()
    eid = await _create_engagement(auth_client, user, "Recall co")
    await auth_client.post(
        f"/api/engagements/{eid}/workspace",
        json=_artifact("namingstandards", "CAF naming", "Naming spec ready"),
        headers={"X-Test-User": user},
    )

    token = engagement_id_var.set(eid)
    try:
        preamble = await engagement_context.preamble_for_active()
    finally:
        engagement_id_var.reset(token)

    assert "Engagement Workspace" in preamble
    assert "CAF naming" in preamble
    assert "Naming spec ready" in preamble


@pytest.mark.asyncio
async def test_clear_workspace_removes_all(auth_client):
    user = _u()
    eid = await _create_engagement(auth_client, user, "Clear co")
    for i in range(3):
        await auth_client.post(
            f"/api/engagements/{eid}/workspace",
            json=_artifact("tool", f"item {i}"),
            headers={"X-Test-User": user},
        )

    r = await auth_client.delete(
        f"/api/engagements/{eid}/workspace", headers={"X-Test-User": user}
    )
    assert r.status_code == 200
    assert r.json()["deleted"] == 3

    left = await auth_client.get(
        f"/api/engagements/{eid}/workspace", headers={"X-Test-User": user}
    )
    assert left.json() == []


@pytest.mark.asyncio
async def test_delete_single_artifact(auth_client):
    user = _u()
    eid = await _create_engagement(auth_client, user, "Del co")
    created = await auth_client.post(
        f"/api/engagements/{eid}/workspace",
        json=_artifact("tool", "keep"),
        headers={"X-Test-User": user},
    )
    victim = await auth_client.post(
        f"/api/engagements/{eid}/workspace",
        json=_artifact("tool", "drop"),
        headers={"X-Test-User": user},
    )
    vid = victim.json()["id"]

    d = await auth_client.delete(
        f"/api/engagements/{eid}/workspace/{vid}", headers={"X-Test-User": user}
    )
    assert d.status_code == 204

    left = await auth_client.get(
        f"/api/engagements/{eid}/workspace", headers={"X-Test-User": user}
    )
    titles = [i["title"] for i in left.json()]
    assert titles == ["keep"]
    assert created.json()["id"] in [i["id"] for i in left.json()]


@pytest.mark.asyncio
async def test_artifacts_scoped_per_user(auth_client):
    owner = _u()
    other = _u()
    eid = await _create_engagement(auth_client, owner, "Scoped co")
    await auth_client.post(
        f"/api/engagements/{eid}/workspace",
        json=_artifact("tool", "secret"),
        headers={"X-Test-User": owner},
    )

    # Another principal can't even see the engagement.
    r = await auth_client.get(
        f"/api/engagements/{eid}/workspace", headers={"X-Test-User": other}
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_workspace_pruned_to_max(auth_client):
    from routes.engagement_workspace import MAX_ARTIFACTS_PER_ENGAGEMENT

    user = _u()
    eid = await _create_engagement(auth_client, user, "Prune co")
    for i in range(MAX_ARTIFACTS_PER_ENGAGEMENT + 5):
        await auth_client.post(
            f"/api/engagements/{eid}/workspace",
            json=_artifact("tool", f"item {i}"),
            headers={"X-Test-User": user},
        )

    r = await auth_client.get(
        f"/api/engagements/{eid}/workspace", headers={"X-Test-User": user}
    )
    items = r.json()
    assert len(items) == MAX_ARTIFACTS_PER_ENGAGEMENT
    # Newest survive; the very first inserts are pruned.
    assert items[0]["title"] == f"item {MAX_ARTIFACTS_PER_ENGAGEMENT + 4}"
    assert "item 0" not in [i["title"] for i in items]
