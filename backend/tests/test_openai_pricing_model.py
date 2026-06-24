"""The Pricing Desk (architecture pricing) is backed by its own deployment.

The diagram/text extraction LLM resolves through mode "pricing", which maps to
``azure_openai_deployment_pricing`` (gpt-5.4-mini by default) rather than the
chat deployment. gpt-5 family deployments must be routed via the Responses API.
"""
from __future__ import annotations


def test_pricing_mode_uses_pricing_deployment():
    from services import openai_service

    assert openai_service.get_deployment("pricing") == (
        openai_service.settings.azure_openai_deployment_pricing
    )


def test_pricing_default_deployment_is_gpt54_mini():
    from services import openai_service

    assert openai_service.settings.azure_openai_deployment_pricing == "gpt-5.4-mini"


def test_needs_responses_api_for_gpt5_family():
    from services import openai_service

    assert openai_service.needs_responses_api("gpt-5.4-mini") is True
    assert openai_service.needs_responses_api("gpt-5.3-codex") is True
    assert openai_service.needs_responses_api("o3-mini") is True
    assert openai_service.needs_responses_api("gpt-4o-mini") is False
    assert openai_service.needs_responses_api("") is False
