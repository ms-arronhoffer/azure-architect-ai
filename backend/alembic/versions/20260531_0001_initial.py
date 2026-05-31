"""initial baseline: conversations + user_secrets

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-31

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "conversations",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("mode", sa.String(length=64), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("messages", sa.JSON(), nullable=False),
        sa.Column("structured_result", sa.Text(), nullable=True),
        sa.Column("user_id", sa.String(length=128), nullable=True),
    )
    op.create_index("ix_conversations_updated_at", "conversations", ["updated_at"])
    op.create_index("ix_conversations_user_id", "conversations", ["user_id"])

    op.create_table(
        "user_secrets",
        sa.Column("user_id", sa.String(length=128), primary_key=True),
        sa.Column("name", sa.String(length=64), primary_key=True),
        sa.Column("value_encrypted", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("user_secrets")
    op.drop_index("ix_conversations_user_id", table_name="conversations")
    op.drop_index("ix_conversations_updated_at", table_name="conversations")
    op.drop_table("conversations")
