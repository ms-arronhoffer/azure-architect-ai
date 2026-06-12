"""rag corpus: rag_documents

Revision ID: 0002_rag_documents
Revises: 0001_initial
Create Date: 2026-05-31

"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0002_rag_documents"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rag_documents",
        sa.Column("id", sa.String(length=128), primary_key=True),
        sa.Column("corpus", sa.String(length=64), nullable=False),
        sa.Column("source_id", sa.String(length=256), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("embedding", sa.JSON(), nullable=False),
        sa.Column("doc_metadata", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_rag_documents_corpus", "rag_documents", ["corpus"])


def downgrade() -> None:
    op.drop_index("ix_rag_documents_corpus", table_name="rag_documents")
    op.drop_table("rag_documents")
