"""model_lifecycle_cache table

Revision ID: 0006_model_lifecycle_cache
Revises: 0005_engagement_artifacts
Create Date: 2026-08-04

"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0006_model_lifecycle_cache"
down_revision = "0005_engagement_artifacts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "model_lifecycle_cache",
        sa.Column("cache_key", sa.String(length=64), primary_key=True),
        sa.Column("models", sa.JSON(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("model_lifecycle_cache")
