"""Auth-adjacent endpoints. Currently: GitHub PAT secure storage.

Tokens are encrypted at rest (Fernet) and never returned to the client.
Clients can only check presence or replace/clear the token.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_user, user_id_from_claims
from db import get_session
from services.secret_store import (
    SecretStoreError,
    delete_secret,
    has_secret,
    set_secret,
)

router = APIRouter()

GITHUB_TOKEN_NAME = "github_pat"


class GithubTokenStatus(BaseModel):
    configured: bool


class GithubTokenBody(BaseModel):
    token: str = Field(min_length=10, max_length=500)


@router.get("/auth/me")
async def get_me(claims=Depends(require_user)):
    return {
        "user_id": user_id_from_claims(claims),
        "name": claims.get("name") or claims.get("preferred_username"),
        "email": claims.get("preferred_username") or claims.get("email"),
    }


@router.get("/auth/github-token", response_model=GithubTokenStatus)
async def get_github_token_status(
    claims=Depends(require_user),
    session: AsyncSession = Depends(get_session),
):
    user_id = user_id_from_claims(claims)
    return GithubTokenStatus(configured=await has_secret(session, user_id, GITHUB_TOKEN_NAME))


@router.put("/auth/github-token", response_model=GithubTokenStatus)
async def put_github_token(
    body: GithubTokenBody,
    claims=Depends(require_user),
    session: AsyncSession = Depends(get_session),
):
    user_id = user_id_from_claims(claims)
    try:
        await set_secret(session, user_id, GITHUB_TOKEN_NAME, body.token)
    except SecretStoreError as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)) from e
    return GithubTokenStatus(configured=True)


@router.delete("/auth/github-token", status_code=status.HTTP_204_NO_CONTENT)
async def delete_github_token(
    claims=Depends(require_user),
    session: AsyncSession = Depends(get_session),
):
    user_id = user_id_from_claims(claims)
    await delete_secret(session, user_id, GITHUB_TOKEN_NAME)
    return None
