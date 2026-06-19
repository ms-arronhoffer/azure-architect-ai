"""whats_new_cache table

Revision ID: 0004_whats_new_cache
Revises: 0003_engagements
Create Date: 2026-06-19

"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0004_whats_new_cache"
down_revision = "0003_engagements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "whats_new_cache",
        sa.Column("feed_set", sa.String(length=64), primary_key=True),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("whats_new_cache")
