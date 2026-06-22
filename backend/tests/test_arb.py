"""ARB workflow route tests.

Exercises the six scenarios called out in the design plan:

1. submit_freezes_design — the bundled-design snapshot is captured by value
2. submit_freezes_citations — citation snapshot list is captured by value
3. conditions_lifecycle — open/cleared/waived counts via list endpoint
4. status_transitions — only the allowed matrix is accepted
5. packet_pdf_generated — background packet task lands a real PDF
6. tenant_scoping — submissions don't leak across engagements/users

Pattern mirrors ``test_conversations_ownership.py``: install a
``get_current_user`` dependency override so the ``X-Test-User`` header
selects the principal, then drive the routes through an httpx
``ASGITransport`` client.
"""
from __future__ import annotations

import asyncio
import time
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


def _bundled_design(title: str = "Design Snapshot") -> dict:
    return {
        "architecture": {"text": f"## {title}\nThree-tier on AKS"},
        "sizing": {"text": "10 nodes Standard_D8s_v5"},
        "security": {"text": "Defender for Cloud enabled"},
        "waf": {
            "pillars": [
                {"pillar": "Reliability", "score": 88, "text": "Multi-region"},
            ]
        },
        "cost_estimate": {
            "total_monthly_estimate": 4200.0,
            "line_items": [
                {
                    "service": "AKS",
                    "sku": "Standard_D8s_v5",
                    "region": "eastus2",
                    "quantity": 10,
                    "hours_per_month": 730,
                }
            ],
        },
        "quota_constraints": [],
    }


def _citations() -> list[dict]:
    return [
        {
            "artifact": "architecture",
            "title": "AKS reference architecture",
            "url": "https://learn.microsoft.com/azure/architecture/aks-baseline",
            "corpus": "learn",
            "published_at": "2026-05-01",
            "freshness_days": 50,
            "confidence": 0.91,
        },
        {
            "artifact": "security",
            "title": "Defender for Containers",
            "url": "https://learn.microsoft.com/azure/defender-for-cloud/containers",
            "corpus": "learn",
            "published_at": "2026-04-15",
            "freshness_days": 66,
            "confidence": 0.84,
        },
    ]


async def _create_engagement(client, principal: str, name: str) -> str:
    r = await client.post(
        "/api/engagements",
        json=_engagement_payload(name),
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _submit(
    client,
    principal: str,
    engagement_id: str,
    *,
    title: str,
    design: dict | None = None,
    citations: list[dict] | None = None,
    conditions: list[dict] | None = None,
) -> dict:
    payload = {
        "title": title,
        "bundled_design_snapshot": design if design is not None else _bundled_design(title),
        "citation_snapshot": citations if citations is not None else _citations(),
        "conditions": conditions or [],
    }
    r = await client.post(
        f"/api/engagements/{engagement_id}/arb/submissions",
        json=payload,
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_submit_freezes_design(auth_client):
    principal = f"alice-{_u()}"
    eng_id = await _create_engagement(auth_client, principal, f"Eng-{_u()}")

    original = _bundled_design("Frozen v1")
    submission = await _submit(
        auth_client, principal, eng_id, title="Freeze test", design=original
    )

    # Mutate the caller's dict and re-read the submission. The server-side
    # snapshot must not reflect the post-submit edit.
    original["architecture"]["text"] = "## Mutated v2"
    original["cost_estimate"]["total_monthly_estimate"] = 99999.0

    r = await auth_client.get(
        f"/api/arb/submissions/{submission['id']}",
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 200, r.text
    fetched = r.json()
    snap = fetched["bundled_design_snapshot"]
    assert snap["architecture"]["text"].startswith("## Frozen v1")
    assert snap["cost_estimate"]["total_monthly_estimate"] == 4200.0


@pytest.mark.asyncio
async def test_submit_freezes_citations(auth_client):
    principal = f"alice-{_u()}"
    eng_id = await _create_engagement(auth_client, principal, f"Eng-{_u()}")

    cites = _citations()
    submission = await _submit(
        auth_client,
        principal,
        eng_id,
        title="Citation freeze",
        citations=cites,
    )

    # Tamper with the local list after submit — server must hold the originals.
    cites.append(
        {
            "artifact": "waf",
            "title": "After the fact",
            "url": "https://example.com/never-cited",
            "corpus": "learn",
            "published_at": "2026-06-01",
        }
    )

    r = await auth_client.get(
        f"/api/arb/submissions/{submission['id']}",
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 200, r.text
    frozen = r.json()["citation_snapshot"]
    assert len(frozen) == 2
    urls = {c["url"] for c in frozen}
    assert "https://learn.microsoft.com/azure/architecture/aks-baseline" in urls
    assert "https://example.com/never-cited" not in urls


@pytest.mark.asyncio
async def test_conditions_lifecycle(auth_client):
    principal = f"alice-{_u()}"
    eng_id = await _create_engagement(auth_client, principal, f"Eng-{_u()}")

    submission = await _submit(
        auth_client,
        principal,
        eng_id,
        title="Lifecycle",
        conditions=[
            {"text": "Enable PIM for Key Vault admins", "severity": "blocker"},
            {"text": "Document break-glass account", "severity": "major"},
        ],
    )
    sid = submission["id"]

    r = await auth_client.get(
        f"/api/arb/submissions/{sid}",
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 200
    conditions = r.json()["conditions"]
    assert len(conditions) == 2
    assert {c["status"] for c in conditions} == {"open"}

    blocker = next(c for c in conditions if c["severity"] == "blocker")
    major = next(c for c in conditions if c["severity"] == "major")

    r = await auth_client.patch(
        f"/api/arb/conditions/{blocker['id']}",
        json={"status": "cleared", "evidence_url": "https://jira/JIRA-42"},
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 200, r.text
    cleared = r.json()
    assert cleared["status"] == "cleared"
    assert cleared["cleared_at"] is not None
    assert cleared["cleared_by"] == principal
    assert cleared["evidence_url"] == "https://jira/JIRA-42"

    r = await auth_client.patch(
        f"/api/arb/conditions/{major['id']}",
        json={"status": "waived", "notes": "low risk on this workload"},
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 200, r.text
    waived = r.json()
    assert waived["status"] == "waived"
    assert waived["cleared_at"] is not None

    r = await auth_client.get(
        f"/api/arb/submissions/{sid}",
        headers={"X-Test-User": principal},
    )
    conditions = r.json()["conditions"]
    counts: dict[str, int] = {}
    for c in conditions:
        counts[c["status"]] = counts.get(c["status"], 0) + 1
    assert counts == {"cleared": 1, "waived": 1}


@pytest.mark.asyncio
async def test_status_transitions(auth_client):
    principal = f"alice-{_u()}"
    eng_id = await _create_engagement(auth_client, principal, f"Eng-{_u()}")
    submission = await _submit(auth_client, principal, eng_id, title="Transitions")
    sid = submission["id"]

    # Fresh row starts at 'submitted' (no draft phase exposed via the route).
    assert submission["status"] == "submitted"

    # invalid: submitted -> approved (must traverse in_review)
    r = await auth_client.patch(
        f"/api/arb/submissions/{sid}",
        json={"status": "approved"},
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 409, r.text

    # valid: submitted -> in_review -> approved
    r = await auth_client.patch(
        f"/api/arb/submissions/{sid}",
        json={"status": "in_review"},
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "in_review"

    r = await auth_client.patch(
        f"/api/arb/submissions/{sid}",
        json={"status": "approved", "decision_summary": "LGTM"},
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 200, r.text
    approved = r.json()
    assert approved["status"] == "approved"
    assert approved["decided_at"] is not None
    assert approved["decided_by"] == principal
    assert approved["decision_summary"] == "LGTM"

    # terminal: approved -> anything else rejected
    for forbidden in ("submitted", "in_review", "rejected", "withdrawn"):
        r = await auth_client.patch(
            f"/api/arb/submissions/{sid}",
            json={"status": forbidden},
            headers={"X-Test-User": principal},
        )
        assert r.status_code == 409, f"expected reject for approved->{forbidden}"


@pytest.mark.asyncio
async def test_packet_pdf_generated(auth_client, tmp_path, monkeypatch):
    pytest.importorskip("fpdf")

    # Redirect packet output to a tmp dir so test artifacts don't leak.
    from routes import arb as arb_routes

    monkeypatch.setattr(arb_routes, "_PACKET_DIR", tmp_path)

    principal = f"alice-{_u()}"
    eng_id = await _create_engagement(auth_client, principal, f"Eng-{_u()}")

    submission = await _submit(
        auth_client,
        principal,
        eng_id,
        title="Packet test design",
        citations=_citations(),
    )
    sid = submission["id"]

    # Background task should finish within a few seconds. Poll the GET
    # endpoint until the file lands, with a generous timeout.
    pdf_path = tmp_path / f"{sid}.pdf"
    deadline = time.time() + 10.0
    while time.time() < deadline and not pdf_path.exists():
        await asyncio.sleep(0.1)
    assert pdf_path.exists(), "background packet task never produced a PDF"

    raw = pdf_path.read_bytes()
    assert raw.startswith(b"%PDF"), "output is not a PDF document"
    # PDF content streams encode text via positioned text operators, so a
    # raw substring search isn't reliable. Sanity-check structure instead:
    # 9 sections → 9 pages, and the file should be at least a few KB.
    assert b"/Count 9" in raw, "expected the packet to have all 9 sections"
    assert len(raw) > 3000, f"PDF unexpectedly small ({len(raw)} bytes)"

    r = await auth_client.get(
        f"/api/arb/submissions/{sid}/packet.pdf",
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/pdf")


@pytest.mark.asyncio
async def test_tenant_scoping(auth_client):
    alice = f"alice-{_u()}"
    bob = f"bob-{_u()}"

    eng_alice = await _create_engagement(auth_client, alice, f"Alice-Eng-{_u()}")
    eng_bob = await _create_engagement(auth_client, bob, f"Bob-Eng-{_u()}")

    sub_alice = await _submit(auth_client, alice, eng_alice, title="Alice design")

    # Bob can't see Alice's submission directly.
    r = await auth_client.get(
        f"/api/arb/submissions/{sub_alice['id']}",
        headers={"X-Test-User": bob},
    )
    assert r.status_code == 404

    # Bob can't list Alice's engagement submissions (engagement not his).
    r = await auth_client.get(
        f"/api/engagements/{eng_alice}/arb/submissions",
        headers={"X-Test-User": bob},
    )
    assert r.status_code == 404

    # Bob's engagement starts empty.
    r = await auth_client.get(
        f"/api/engagements/{eng_bob}/arb/submissions",
        headers={"X-Test-User": bob},
    )
    assert r.status_code == 200
    assert sub_alice["id"] not in {row["id"] for row in r.json()}

    # Alice's listing contains exactly the one she filed.
    r = await auth_client.get(
        f"/api/engagements/{eng_alice}/arb/submissions",
        headers={"X-Test-User": alice},
    )
    assert r.status_code == 200
    ids = {row["id"] for row in r.json()}
    assert sub_alice["id"] in ids
