"""engagements + conversations.engagement_id

Revision ID: 0003_engagements
Revises: 0002_rag_documents
Create Date: 2026-06-18

"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0003_engagements"
down_revision = "0002_rag_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "engagements",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("customer_name", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("industry", sa.String(length=64), nullable=True),
        sa.Column("compliance_frameworks", sa.JSON(), nullable=False),
        sa.Column("subscription_ids", sa.JSON(), nullable=False),
        sa.Column("region_preference", sa.String(length=64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("reservation_commitments", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False, server_default="default"),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_engagements_industry", "engagements", ["industry"])
    op.create_index("ix_engagements_status", "engagements", ["status"])
    op.create_index("ix_engagements_user_id", "engagements", ["user_id"])
    op.create_index("ix_engagements_tenant_id", "engagements", ["tenant_id"])
    op.create_index("ix_engagements_updated_at", "engagements", ["updated_at"])

    with op.batch_alter_table("conversations") as batch:
        batch.add_column(sa.Column("engagement_id", sa.String(length=64), nullable=True))
    op.create_index(
        "ix_conversations_engagement_id", "conversations", ["engagement_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_conversations_engagement_id", table_name="conversations")
    with op.batch_alter_table("conversations") as batch:
        batch.drop_column("engagement_id")
    for ix in (
        "ix_engagements_updated_at",
        "ix_engagements_tenant_id",
        "ix_engagements_user_id",
        "ix_engagements_status",
        "ix_engagements_industry",
    ):
        op.drop_index(ix, table_name="engagements")
    op.drop_table("engagements")
