"""engagement_artifacts — saved tool outputs for cross-tool recall

Revision ID: 0005_engagement_artifacts
Revises: 0004_whats_new_cache
Create Date: 2026-07-01

"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0005_engagement_artifacts"
down_revision = "0004_whats_new_cache"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "engagement_artifacts",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("engagement_id", sa.String(length=64), nullable=False),
        sa.Column("tool", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False, server_default="note"),
        sa.Column("title", sa.String(length=256), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False, server_default="default"),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
    )
    op.create_index(
        "ix_engagement_artifacts_engagement_id", "engagement_artifacts", ["engagement_id"]
    )
    op.create_index("ix_engagement_artifacts_tool", "engagement_artifacts", ["tool"])
    op.create_index("ix_engagement_artifacts_user_id", "engagement_artifacts", ["user_id"])
    op.create_index("ix_engagement_artifacts_tenant_id", "engagement_artifacts", ["tenant_id"])
    op.create_index(
        "ix_engagement_artifacts_updated_at", "engagement_artifacts", ["updated_at"]
    )


def downgrade() -> None:
    for ix in (
        "ix_engagement_artifacts_updated_at",
        "ix_engagement_artifacts_tenant_id",
        "ix_engagement_artifacts_user_id",
        "ix_engagement_artifacts_tool",
        "ix_engagement_artifacts_engagement_id",
    ):
        op.drop_index(ix, table_name="engagement_artifacts")
    op.drop_table("engagement_artifacts")
