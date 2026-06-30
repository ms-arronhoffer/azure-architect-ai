"""Route-level tests for custom skills + skill showcase.

Auth is disabled by default in tests; we override `get_current_user` to read an
`X-Test-User` header (same pattern as test_conversations_ownership). The
`CUSTOM_SKILLS` flag is enabled via monkeypatched env, and embeddings are
mocked so knowledge ingest doesn't call Azure.
"""
from __future__ import annotations

import io
import uuid
import zipfile

import pytest
import pytest_asyncio
from fastapi import Request


def _user() -> str:
    """Unique principal per call — the app uses a persisted SQLite file shared
    across tests, so per-user isolation keeps list/count assertions stable."""
    return f"u-{uuid.uuid4().hex[:12]}"


def _claims(header_value: str | None):
    if not header_value:
        return None
    return {"oid": header_value, "sub": header_value}


def _zip(files: dict[str, str], root: str = "my-skill/") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(root + name, content)
    return buf.getvalue()


_MANIFEST = """
name: Tagging Reviewer
slug: tagging-reviewer
version: 1.0.0
category: cost
description: Reviews tags.
tags: [FinOps]
"""


@pytest_asyncio.fixture
async def skills_client(monkeypatch):
    import httpx

    # Enable the feature flag and avoid real embeddings.
    monkeypatch.setenv("CUSTOM_SKILLS", "true")

    import services.embeddings_service as emb
    monkeypatch.setattr(emb, "embed_texts", lambda texts: [[1.0, 0.0, 0.0] for _ in texts])
    monkeypatch.setattr(emb, "embed_text", lambda text: [1.0, 0.0, 0.0])

    from auth.entra import get_current_user
    from db import init_db
    from main import app

    async def fake_get_current_user(request: Request):
        return _claims(request.headers.get("X-Test-User"))

    app.dependency_overrides[get_current_user] = fake_get_current_user
    await init_db()
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def _upload(client, user: str, files: dict[str, str]) -> dict:
    data = _zip(files)
    r = await client.post(
        "/api/skills/upload",
        files={"file": ("skill.zip", data, "application/zip")},
        headers={"X-Test-User": user},
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_upload_then_list(skills_client):
    alice = _user()
    skill = await _upload(skills_client, alice, {
        "skill.yaml": _MANIFEST,
        "instructions.md": "Review tags.",
        "knowledge/a.md": "tag guidance",
    })
    assert skill["slug"] == "tagging-reviewer"
    assert skill["enabled"] is True

    r = await skills_client.get("/api/skills", headers={"X-Test-User": alice})
    assert r.status_code == 200
    skills = r.json()["skills"]
    assert len(skills) == 1
    assert skills[0]["id"] == skill["id"]


@pytest.mark.asyncio
async def test_skills_are_user_scoped(skills_client):
    await _upload(skills_client, _user(), {"skill.yaml": _MANIFEST, "instructions.md": "x"})
    r = await skills_client.get("/api/skills", headers={"X-Test-User": _user()})
    assert r.status_code == 200
    assert r.json()["skills"] == []


@pytest.mark.asyncio
async def test_other_user_cannot_access_skill(skills_client):
    skill = await _upload(skills_client, _user(), {"skill.yaml": _MANIFEST, "instructions.md": "x"})
    r = await skills_client.get(f"/api/skills/{skill['id']}", headers={"X-Test-User": _user()})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_patch_enable_disable(skills_client):
    alice = _user()
    skill = await _upload(skills_client, alice, {"skill.yaml": _MANIFEST, "instructions.md": "x"})
    r = await skills_client.patch(
        f"/api/skills/{skill['id']}",
        json={"enabled": False},
        headers={"X-Test-User": alice},
    )
    assert r.status_code == 200
    assert r.json()["enabled"] is False


@pytest.mark.asyncio
async def test_delete_purges_skill(skills_client):
    alice = _user()
    skill = await _upload(skills_client, alice, {
        "skill.yaml": _MANIFEST,
        "instructions.md": "x",
        "knowledge/a.md": "guidance",
    })
    r = await skills_client.delete(f"/api/skills/{skill['id']}", headers={"X-Test-User": alice})
    assert r.status_code == 200

    # Corpus rows for the skill should be gone.
    from db import RagDocument, session_scope
    from db import select as db_select
    from services import skill_service
    async with session_scope() as session:
        rows = (
            await session.execute(
                db_select(RagDocument)
                .where(RagDocument.corpus == skill_service.corpus_for(skill["id"]))
                .execution_options(skip_tenant_filter=True)
            )
        ).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_invalid_package_rejected(skills_client):
    r = await skills_client.post(
        "/api/skills/upload",
        files={"file": ("x.zip", b"not a zip", "application/zip")},
        headers={"X-Test-User": _user()},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_export_roundtrip(skills_client):
    alice = _user()
    skill = await _upload(skills_client, alice, {"skill.yaml": _MANIFEST, "instructions.md": "x"})
    r = await skills_client.get(f"/api/skills/{skill['id']}/export", headers={"X-Test-User": alice})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    from services.skill_package import parse_package
    parsed = parse_package(r.content)
    assert parsed.slug == "tagging-reviewer"


@pytest.mark.asyncio
async def test_sample_download(skills_client):
    r = await skills_client.get("/api/skills/sample", headers={"X-Test-User": _user()})
    assert r.status_code == 200
    from services.skill_package import parse_package
    parsed = parse_package(r.content)
    assert parsed.slug


@pytest.mark.asyncio
async def test_showcase_seed_and_install(skills_client):
    alice = _user()
    r = await skills_client.get("/api/skills/showcase", headers={"X-Test-User": alice})
    assert r.status_code == 200
    skills = r.json()["skills"]
    assert len(skills) >= 1
    target = skills[0]
    showcase_id = target["id"]
    before = target["downloads"]

    r = await skills_client.post(
        f"/api/skills/showcase/{showcase_id}/install",
        headers={"X-Test-User": alice},
    )
    assert r.status_code == 201, r.text
    installed = r.json()
    assert installed["source"] == "showcase"
    assert installed["origin_skill_id"] == showcase_id

    # Download counter incremented by exactly one.
    r = await skills_client.get("/api/skills/showcase", headers={"X-Test-User": alice})
    match = next(s for s in r.json()["skills"] if s["id"] == showcase_id)
    assert match["downloads"] == before + 1


@pytest.mark.asyncio
async def test_publish_own_skill(skills_client):
    alice = _user()
    skill = await _upload(skills_client, alice, {"skill.yaml": _MANIFEST, "instructions.md": "x"})
    r = await skills_client.post(f"/api/skills/{skill['id']}/publish", headers={"X-Test-User": alice})
    assert r.status_code == 201, r.text

    r = await skills_client.get("/api/skills/showcase", headers={"X-Test-User": _user()})
    slugs = [s["slug"] for s in r.json()["skills"]]
    assert "tagging-reviewer" in slugs


@pytest.mark.asyncio
async def test_flag_off_returns_404(skills_client, monkeypatch):
    monkeypatch.setenv("CUSTOM_SKILLS", "false")
    r = await skills_client.get("/api/skills", headers={"X-Test-User": _user()})
    assert r.status_code == 404
