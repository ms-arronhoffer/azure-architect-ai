"""Async multi-format bundle job tests for /api/model-migration/jobs/*.

Pattern mirrors ``test_arb.py``: install a ``get_current_user`` override
keyed on the ``X-Test-User`` header, then drive the routes through an
httpx ``ASGITransport`` client. Heavy LLM/PDF/PPTX/DOCX builders are
monkeypatched to fixed bytes so the orchestrator runs in tests without
external dependencies.
"""
from __future__ import annotations

import asyncio
import io
import json
import threading
import time
import uuid
import zipfile

import pytest
import pytest_asyncio
from fastapi import Request


def _u() -> str:
    return uuid.uuid4().hex[:8]


def _claims_for_header(header_value: str | None) -> dict[str, str] | None:
    if not header_value:
        return None
    return {"oid": header_value, "sub": header_value}


_TSV_HEADER = (
    "region\taccountability_unit\tsegment\ttpid\ttp_name\tsubscription_id\t"
    "subscription_name\tdeployment_region\toffering_name\tmodel\tversion\t"
    "upgrade_option\tretirement_date\tunified\ttokens_w3\ttokens_w2\t"
    "tokens_w1\tcsam"
)


def _tsv_row(
    tpid: str = "T1",
    tp_name: str = "Acme",
    sub_id: str = "S1",
    sub_name: str = "Acme Prod",
    model: str = "gpt-4",
    version: str = "0613",
    retirement_date: str = "2026-12-31",
    region: str = "eastus",
) -> str:
    return "\t".join([
        "WW", "AU", "Enterprise", tpid, tp_name, sub_id, sub_name, region,
        "Azure OpenAI", model, version, "Auto", retirement_date, "Y",
        "100M", "80M", "60M", "N",
    ])


def _sample_tsv(tpid: str = "T1", model: str = "gpt-4") -> str:
    return f"{_TSV_HEADER}\n{_tsv_row(tpid=tpid, model=model)}\n"


def _patch_builders(monkeypatch):
    """Replace the heavy builders with cheap stubs so jobs run fast."""
    from services import model_iq_bundle_service as svc

    def fake_narrative(_data):
        return {
            "executive_summary": "stub",
            "key_risks": ["r1"],
            "recommended_actions": ["a1"],
            "customer_highlights": [],
        }

    def fake_pptx(_d, _n):
        return b"PPTX-STUB"

    def fake_docx(_d, _n):
        return b"DOCX-STUB"

    def fake_pdf(_d, _n):
        return b"PDF-STUB"

    monkeypatch.setattr(svc, "generate_report_narrative", fake_narrative)
    monkeypatch.setitem(svc._BUILDERS, "pptx", fake_pptx)
    monkeypatch.setitem(svc._BUILDERS, "docx", fake_docx)
    monkeypatch.setitem(svc._BUILDERS, "pdf", fake_pdf)


@pytest_asyncio.fixture
async def auth_client(monkeypatch, tmp_path):
    import httpx

    from auth.entra import get_current_user
    from db import init_db
    from main import app
    from services import model_iq_bundle_service as svc

    # Redirect bundle output to tmp dir so test artifacts don't leak.
    monkeypatch.setattr(svc, "BUNDLE_DIR", tmp_path)
    monkeypatch.setattr(
        svc,
        "bundle_path_for",
        lambda jid: tmp_path / f"{jid}.zip",
    )
    _patch_builders(monkeypatch)

    async def fake_get_current_user(request: Request):
        return _claims_for_header(request.headers.get("X-Test-User"))

    app.dependency_overrides[get_current_user] = fake_get_current_user

    await init_db()
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def _wait_for_complete(client, principal: str, job_id: str, timeout: float = 8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = await client.get(
            f"/api/model-migration/jobs/{job_id}",
            headers={"X-Test-User": principal},
        )
        if r.status_code == 200 and r.json()["status"] in ("complete", "failed"):
            return r.json()
        await asyncio.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")


def _multipart_files(n: int) -> list[tuple[str, tuple[str, bytes, str]]]:
    return [
        ("files", (f"r{i}.csv", _sample_tsv(tpid=f"T{i}").encode("utf-8"), "text/csv"))
        for i in range(n)
    ]


# ── Tests ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_post_jobs_accepts_multiple_files(auth_client):
    principal = f"alice-{_u()}"
    r = await auth_client.post(
        "/api/model-migration/jobs",
        files=_multipart_files(2),
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["job_id"]
    assert body["status"] == "pending"
    assert set(body["formats"]) == {"pptx", "docx", "pdf"}
    assert body["bundle_url"].endswith(f"/jobs/{body['job_id']}/bundle.zip")
    assert body["sse_url"].endswith(f"/jobs/{body['job_id']}/events")

    await _wait_for_complete(auth_client, principal, body["job_id"])


@pytest.mark.asyncio
async def test_format_subset_honored(auth_client):
    principal = f"alice-{_u()}"
    r = await auth_client.post(
        "/api/model-migration/jobs",
        files=_multipart_files(1),
        data={"formats": "pptx,pdf"},
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 202, r.text
    job_id = r.json()["job_id"]

    status = await _wait_for_complete(auth_client, principal, job_id)
    assert status["status"] == "complete"
    assert set(status["formats"]) == {"pptx", "pdf"}

    # Inspect the actual ZIP contents.
    r = await auth_client.get(
        f"/api/model-migration/jobs/{job_id}/bundle.zip",
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 200, r.text
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        names = set(zf.namelist())
    assert "report.pptx" in names
    assert "report.pdf" in names
    assert "report.docx" not in names
    assert "analysis.json" in names
    assert "narrative.json" in names


@pytest.mark.asyncio
async def test_invalid_format_rejected(auth_client):
    principal = f"alice-{_u()}"
    r = await auth_client.post(
        "/api/model-migration/jobs",
        files=_multipart_files(1),
        data={"formats": "pptx,xlsx"},
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 400, r.text
    assert "xlsx" in r.text


@pytest.mark.asyncio
async def test_status_progression(auth_client):
    principal = f"alice-{_u()}"
    r = await auth_client.post(
        "/api/model-migration/jobs",
        files=_multipart_files(1),
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 202, r.text
    job_id = r.json()["job_id"]

    r = await auth_client.get(
        f"/api/model-migration/jobs/{job_id}",
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] in ("pending", "running", "complete")

    status = await _wait_for_complete(auth_client, principal, job_id)
    assert status["status"] == "complete"
    assert status["size_bytes"] is not None and status["size_bytes"] > 0
    assert status["completed_at"] is not None
    assert status["expires_at"] > status["created_at"]


@pytest.mark.asyncio
async def test_sse_events_sequence(auth_client):
    principal = f"alice-{_u()}"
    r = await auth_client.post(
        "/api/model-migration/jobs",
        files=_multipart_files(1),
        headers={"X-Test-User": principal},
    )
    job_id = r.json()["job_id"]

    events: list[dict] = []
    async with auth_client.stream(
        "GET",
        f"/api/model-migration/jobs/{job_id}/events",
        headers={"X-Test-User": principal},
    ) as resp:
        assert resp.status_code == 200
        async for line in resp.aiter_lines():
            if line.startswith("data:"):
                events.append(json.loads(line[len("data:"):].strip()))
                if events[-1].get("event") in ("job_complete", "job_failed"):
                    break

    event_names = [e["event"] for e in events]
    assert "job_complete" in event_names
    assert event_names[-1] == "job_complete"
    assert any(e == "job_started" or e == "job_progress" for e in event_names)


@pytest.mark.asyncio
async def test_sse_replays_terminal_event_after_completion(auth_client):
    principal = f"alice-{_u()}"
    r = await auth_client.post(
        "/api/model-migration/jobs",
        files=_multipart_files(1),
        headers={"X-Test-User": principal},
    )
    job_id = r.json()["job_id"]
    await _wait_for_complete(auth_client, principal, job_id)

    # Late subscriber: should receive terminal event immediately + stream closes.
    events: list[dict] = []
    async with auth_client.stream(
        "GET",
        f"/api/model-migration/jobs/{job_id}/events",
        headers={"X-Test-User": principal},
    ) as resp:
        assert resp.status_code == 200
        async for line in resp.aiter_lines():
            if line.startswith("data:"):
                events.append(json.loads(line[len("data:"):].strip()))

    assert events, "expected at least one replayed event"
    assert events[-1]["event"] in ("job_complete", "job_failed")


@pytest.mark.asyncio
async def test_bundle_404_until_complete_then_200(auth_client, monkeypatch):
    # Slow the narrative phase so we can observe the in-flight 404.
    from services import model_iq_bundle_service as svc

    sleeper_event = threading.Event()

    def slow_narrative(_data):
        # Hold up the job (runs in a worker thread via asyncio.to_thread)
        # until the test releases it.
        if not sleeper_event.wait(timeout=5):
            raise RuntimeError("slow_narrative was never released")
        return {
            "executive_summary": "s",
            "key_risks": [],
            "recommended_actions": [],
            "customer_highlights": [],
        }

    monkeypatch.setattr(svc, "generate_report_narrative", slow_narrative)

    principal = f"alice-{_u()}"
    r = await auth_client.post(
        "/api/model-migration/jobs",
        files=_multipart_files(1),
        headers={"X-Test-User": principal},
    )
    job_id = r.json()["job_id"]

    # Bundle should 404 while the job runs.
    await asyncio.sleep(0.1)
    r = await auth_client.get(
        f"/api/model-migration/jobs/{job_id}/bundle.zip",
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 404, r.text

    # Release the orchestrator and wait for completion.
    sleeper_event.set()
    await _wait_for_complete(auth_client, principal, job_id)

    r = await auth_client.get(
        f"/api/model-migration/jobs/{job_id}/bundle.zip",
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/zip"
    assert len(r.content) > 0


@pytest.mark.asyncio
async def test_bundle_failure_returns_409(auth_client, monkeypatch):
    from services import model_iq_bundle_service as svc

    def boom(_d, _n):
        raise RuntimeError("pdf builder exploded")

    monkeypatch.setitem(svc._BUILDERS, "pdf", boom)

    principal = f"alice-{_u()}"
    r = await auth_client.post(
        "/api/model-migration/jobs",
        files=_multipart_files(1),
        data={"formats": "pdf"},
        headers={"X-Test-User": principal},
    )
    job_id = r.json()["job_id"]
    status = await _wait_for_complete(auth_client, principal, job_id)
    assert status["status"] == "failed"
    assert "exploded" in (status["error"] or "")

    r = await auth_client.get(
        f"/api/model-migration/jobs/{job_id}/bundle.zip",
        headers={"X-Test-User": principal},
    )
    assert r.status_code == 409, r.text


@pytest.mark.asyncio
async def test_cleanup_purges_old_rows(auth_client, tmp_path):
    from db import MigrationJob, session_scope
    from services.model_iq_bundle_service import purge_old_bundles

    job_id = uuid.uuid4().hex
    old_ms = int(time.time() * 1000) - 25 * 3600 * 1000
    zip_path = tmp_path / f"{job_id}.zip"
    zip_path.write_bytes(b"stub-zip")

    async with session_scope() as s:
        row = MigrationJob(
            id=job_id,
            status="complete",
            formats="pptx",
            files_total=1,
            files_done=1,
            bundle_path=str(zip_path),
            size_bytes=zip_path.stat().st_size,
            created_at=old_ms,
            completed_at=old_ms + 1000,
        )
        s.add(row)
        await s.commit()

    removed = await purge_old_bundles(max_age_hours=24)
    assert removed >= 1
    assert not zip_path.exists()

    async with session_scope() as s:
        from sqlalchemy import select as _select
        row = (
            await s.execute(
                _select(MigrationJob)
                .where(MigrationJob.id == job_id)
                .execution_options(skip_tenant_filter=True)
            )
        ).scalar_one_or_none()
        assert row is None


@pytest.mark.asyncio
async def test_tenant_scoping_enforced(auth_client, monkeypatch):
    """A job owned by tenant A is invisible to tenant B.

    The tenant id comes from the JWT `tid` claim via TenantContextMiddleware.
    We patch that lookup so the two principals resolve to different tenants.
    """

    from auth.entra import get_current_user
    from db import tenant_id_var
    from main import app

    async def tenant_aware(request: Request):
        h = request.headers.get("X-Test-User")
        if not h:
            return None
        # Pretend two users live in two separate tenants.
        tid = f"tenant-{h.split('-')[0]}"
        tenant_id_var.set(tid)
        return {"oid": h, "sub": h, "tid": tid}

    app.dependency_overrides[get_current_user] = tenant_aware
    try:
        alice = f"alice-{_u()}"
        bob = f"bob-{_u()}"
        r = await auth_client.post(
            "/api/model-migration/jobs",
            files=_multipart_files(1),
            headers={"X-Test-User": alice},
        )
        assert r.status_code == 202, r.text
        job_id = r.json()["job_id"]

        # Bob (different tenant) cannot see Alice's job.
        r = await auth_client.get(
            f"/api/model-migration/jobs/{job_id}",
            headers={"X-Test-User": bob},
        )
        assert r.status_code == 404, r.text
    finally:
        # Restore the simple override the fixture installed.
        async def simple(request: Request):
            return _claims_for_header(request.headers.get("X-Test-User"))

        app.dependency_overrides[get_current_user] = simple
