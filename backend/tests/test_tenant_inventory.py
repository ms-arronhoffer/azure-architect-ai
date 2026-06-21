"""Tests for the per-engagement tenant_inventory ingest + RAG isolation.

Covers:
1. ingest_creates_documents — mocked scan returns rows; ingest writes
   RagDocument with engagement_id stamped.
2. rag_filter_isolation — two engagements' tenant_inventory chunks
   never cross-contaminate hybrid_search results.
3. public_corpora_unaffected — learn / avm / reference_archs docs
   remain visible regardless of the engagement filter.
4. idempotent — re-running ingest does not duplicate documents
   (SHA1(source_id) dedupes via index_documents).
5. preamble_includes_inventory — engagement_context.preamble_for_active
   surfaces the resource counts after a scan.
"""
from __future__ import annotations

import time

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import db as db_module
from db import Engagement, RagDocument, engagement_id_var, select


@pytest_asyncio.fixture
async def in_memory_engine(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(db_module.Base.metadata.create_all)
    session_maker = async_sessionmaker(engine, expire_on_commit=False)

    def fake_scope():
        return session_maker()

    # Both the ingest and the preamble helper use session_scope() from db
    # via different modules; patch the binding in each.
    from services import engagement_context, rag_service, tenant_inventory_ingest

    monkeypatch.setattr(tenant_inventory_ingest, "session_scope", fake_scope)
    monkeypatch.setattr(rag_service, "session_scope", fake_scope)
    monkeypatch.setattr(engagement_context, "session_scope", fake_scope)

    # Mock embeddings so we don't reach Azure OpenAI.
    monkeypatch.setattr(
        rag_service, "embed_texts", lambda texts: [[1.0, 0.0, 0.0] for _ in texts]
    )
    monkeypatch.setattr(rag_service, "embed_text", lambda text: [1.0, 0.0, 0.0])

    # Make every "live" Azure call deterministic.
    from services import azure_scan_service, cost_service, mcp_service, security_posture_service

    monkeypatch.setattr(mcp_service, "is_mcp_available", lambda: False)
    monkeypatch.setattr(
        azure_scan_service,
        "list_resources",
        lambda sub: [
            {
                "id": f"/subscriptions/{sub}/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/vm-a",
                "name": "vm-a",
                "type": "Microsoft.Compute/virtualMachines",
                "location": "eastus2",
                "resourceGroup": "rg1",
                "sku": {"name": "Standard_D2s_v5"},
                "tags": {"env": "prod"},
            },
            {
                "id": f"/subscriptions/{sub}/resourceGroups/rg1/providers/Microsoft.Storage/storageAccounts/sa1",
                "name": "sa1",
                "type": "Microsoft.Storage/storageAccounts",
                "location": "eastus2",
                "resourceGroup": "rg1",
                "sku": {"name": "Standard_LRS"},
                "tags": {},
            },
        ],
    )
    monkeypatch.setattr(
        azure_scan_service,
        "list_public_ips",
        lambda sub: [
            {
                "id": f"/subscriptions/{sub}/resourceGroups/rg1/providers/Microsoft.Network/publicIPAddresses/pip-a",
                "name": "pip-a",
                "ipAddress": "20.1.2.3",
                "location": "eastus2",
                "resourceGroup": "rg1",
            }
        ],
    )
    monkeypatch.setattr(
        azure_scan_service,
        "list_open_nsg_rules",
        lambda sub: [
            {
                "name": "nsg-a",
                "ruleName": "allow-22",
                "destinationPortRange": "22",
                "protocol": "Tcp",
                "resourceGroup": "rg1",
            }
        ],
    )
    monkeypatch.setattr(
        security_posture_service,
        "list_policy_states",
        lambda sub: [
            {
                "policy_definition": "require-https",
                "policy_assignment": "secure-baseline",
                "resource_id": f"/subscriptions/{sub}/resourceGroups/rg1/providers/Microsoft.Storage/storageAccounts/sa1",
                "resource_type": "Microsoft.Storage/storageAccounts",
            }
        ],
    )
    monkeypatch.setattr(
        cost_service,
        "query_mtd_by_service",
        lambda sub: [
            {"service": "Virtual Machines", "cost": 1234.56, "currency": "USD"},
            {"service": "Storage", "cost": 12.34, "currency": "USD"},
        ],
    )

    yield session_maker
    await engine.dispose()


def _make_engagement(eid: str = "eng-1", sub_ids: list[str] | None = None) -> Engagement:
    now = int(time.time() * 1000)
    return Engagement(
        id=eid,
        name=f"Engagement {eid}",
        customer_name="ACME",
        industry="finance",
        compliance_frameworks=["PCI-DSS"],
        subscription_ids=sub_ids or ["sub-aaa"],
        region_preference="eastus2",
        notes="",
        reservation_commitments={},
        status="active",
        user_id="u1",
        created_at=now,
        updated_at=now,
    )


@pytest.mark.asyncio
async def test_ingest_creates_documents(in_memory_engine):
    from services.rag_service import CORPUS_TENANT_INVENTORY
    from services.tenant_inventory_ingest import ingest_engagement

    eng = _make_engagement()
    summary = await ingest_engagement(eng)
    assert summary["ok"] is True
    # 2 resources + 1 public IP + 1 NSG rule + 1 policy state + 1 cost summary = 6
    assert summary["docs_indexed"] == 6

    async with in_memory_engine() as session:
        rows = (
            (
                await session.execute(
                    select(RagDocument).where(RagDocument.corpus == CORPUS_TENANT_INVENTORY)
                )
            )
            .scalars()
            .all()
        )
    assert len(rows) == 6
    assert {r.engagement_id for r in rows} == {"eng-1"}
    kinds = {r.doc_metadata.get("fact_kind") for r in rows}
    assert kinds == {
        "resource",
        "public_ip",
        "open_nsg_rule",
        "policy_noncompliance",
        "cost_mtd",
    }


@pytest.mark.asyncio
async def test_rag_filter_isolation(in_memory_engine):
    pytest.importorskip("rapidfuzz")
    from services import rag_service
    from services.tenant_inventory_ingest import ingest_engagement

    await ingest_engagement(_make_engagement("eng-a", ["sub-a"]))
    await ingest_engagement(_make_engagement("eng-b", ["sub-b"]))

    async with in_memory_engine() as session:
        res_a = await rag_service.hybrid_search(
            session, "virtual machines storage", top_k=20, engagement_id="eng-a"
        )
        res_b = await rag_service.hybrid_search(
            session, "virtual machines storage", top_k=20, engagement_id="eng-b"
        )

    # Every tenant_inventory hit returned to engagement A must belong to A.
    a_tenant_hits = [h for h in res_a["hits"] if h["corpus"] == "tenant_inventory"]
    b_tenant_hits = [h for h in res_b["hits"] if h["corpus"] == "tenant_inventory"]
    assert a_tenant_hits
    assert b_tenant_hits
    for hit in a_tenant_hits:
        assert "sub-a" in hit["content"] or hit["content"].count("sub-b") == 0
    for hit in b_tenant_hits:
        assert "sub-b" in hit["content"] or hit["content"].count("sub-a") == 0
    # No leak across the cohort.
    a_source_ids = {h["source_id"] for h in a_tenant_hits}
    b_source_ids = {h["source_id"] for h in b_tenant_hits}
    assert a_source_ids.isdisjoint(b_source_ids)


@pytest.mark.asyncio
async def test_public_corpora_unaffected(in_memory_engine):
    pytest.importorskip("rapidfuzz")
    import datetime as dt

    from services import rag_service
    from services.rag_service import CORPUS_LEARN
    from services.tenant_inventory_ingest import ingest_engagement

    # Seed a public learn doc.
    async with in_memory_engine() as session:
        session.add(
            RagDocument(
                id="learn-doc-1",
                corpus=CORPUS_LEARN,
                source_id="learn::aks-overview",
                title="AKS overview",
                url="https://learn.microsoft.com/azure/aks",
                content="Azure Kubernetes Service runs managed Kubernetes clusters.",
                embedding=[1.0, 0.0, 0.0],
                doc_metadata={},
                engagement_id=None,
                updated_at=dt.datetime.now(dt.UTC).replace(tzinfo=None),
            )
        )
        await session.commit()

    await ingest_engagement(_make_engagement("eng-a", ["sub-a"]))

    async with in_memory_engine() as session:
        result = await rag_service.hybrid_search(
            session,
            "kubernetes clusters",
            top_k=20,
            engagement_id="eng-a",
        )
    corpora_seen = {h["corpus"] for h in result["hits"]}
    assert CORPUS_LEARN in corpora_seen

    # And: with no engagement filter at all, tenant_inventory stays hidden but
    # learn is still visible.
    async with in_memory_engine() as session:
        result = await rag_service.hybrid_search(
            session, "kubernetes clusters", top_k=20
        )
    corpora_seen = {h["corpus"] for h in result["hits"]}
    assert CORPUS_LEARN in corpora_seen
    assert "tenant_inventory" not in corpora_seen


@pytest.mark.asyncio
async def test_ingest_is_idempotent(in_memory_engine):
    from services.rag_service import CORPUS_TENANT_INVENTORY
    from services.tenant_inventory_ingest import ingest_engagement

    eng = _make_engagement()
    await ingest_engagement(eng)
    await ingest_engagement(eng)

    async with in_memory_engine() as session:
        rows = (
            (
                await session.execute(
                    select(RagDocument).where(RagDocument.corpus == CORPUS_TENANT_INVENTORY)
                )
            )
            .scalars()
            .all()
        )
    # Same 6 docs, upserted in place — no duplicates.
    assert len(rows) == 6
    source_ids = [r.source_id for r in rows]
    assert len(source_ids) == len(set(source_ids))


@pytest.mark.asyncio
async def test_preamble_includes_inventory(in_memory_engine, monkeypatch):
    from services import engagement_context
    from services.tenant_inventory_ingest import ingest_engagement

    eng = _make_engagement()
    # Persist the engagement so load_active() can find it.
    async with in_memory_engine() as session:
        session.add(eng)
        await session.commit()

    await ingest_engagement(eng)

    token = engagement_id_var.set(eng.id)
    try:
        preamble = await engagement_context.preamble_for_active()
    finally:
        engagement_id_var.reset(token)

    assert "Engagement Context" in preamble
    assert "Tenant Inventory Snapshot" in preamble
    # 2 resources were seeded; top types should be in the snapshot.
    assert "2 resources" in preamble
    assert "virtualMachines" in preamble or "storageAccounts" in preamble
    # The NSG open-rule fact survives into the snapshot.
    assert "NSG rules open" in preamble
