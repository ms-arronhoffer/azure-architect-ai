from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    azure_openai_endpoint: str
    azure_openai_key: str | None = None
    azure_openai_deployment_chat: str = "gpt-4o-mini"
    azure_openai_deployment_arch: str = "gpt-4.1"
    # Architecture Review ("evaluation") runs on a stronger reasoning model by
    # default. gpt-5.x deployments stream via the Responses API automatically.
    azure_openai_deployment_eval: str = "gpt-5.4"
    azure_openai_deployment_demo_build: str = "gpt-5.3-codex"
    azure_openai_deployment_pricing: str = "gpt-5.4-mini"
    azure_openai_deployment_embedding: str = "text-embedding-3-small"
    azure_openai_api_version: str = "2024-12-01-preview"

    # Per-deployment routing overrides. When a deployment name matches one of
    # these, the openai_service swaps the base endpoint / api-version / key
    # instead of using the global ones above. Used when a model lives on a
    # different Azure OpenAI / Foundry resource than the primary one.
    # gpt-5.4-pro currently lives on the arronhoffer-demo-resource Foundry
    # account in eastus (resource group: test-AI-Foundry). The Responses API
    # is the only supported surface for this deployment.
    azure_openai_endpoint_gpt54pro: str = (
        "https://arronhoffer-demo-resource.cognitiveservices.azure.com"
    )
    azure_openai_api_version_gpt54pro: str = "2025-04-01-preview"
    azure_openai_key_gpt54pro: str | None = None

    # RAG corpus. Pre-warmed at startup when true; reindex via /api/rag/reindex.
    rag_enabled: bool = True
    rag_top_k: int = 5

    # MCP integration
    mcp_enabled: bool = True
    azure_subscription_id: str | None = None

    # Database. Async driver URL. Defaults to local SQLite for dev.
    # Postgres example: postgresql+asyncpg://user:pass@host:5432/aa
    database_url: str = "sqlite+aiosqlite:///./data/conversations.db"

    # Secret-at-rest encryption key (Fernet, base64 32-byte). Required when storing
    # user secrets like GitHub PATs. Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    secret_encryption_key: str | None = None

    # Entra ID auth. When auth_enabled=true, all /api/* routes require a Bearer JWT.
    auth_enabled: bool = False
    entra_tenant_id: str | None = None
    entra_audience: str | None = None  # API app registration client ID or app ID URI
    session_cookie_name: str = "aa_session"
    session_cookie_secure: bool = False  # set true behind HTTPS

    # CORS. Comma-separated list of allowed origins added to the localhost defaults.
    # Example: CORS_ORIGINS=https://blueprint.techtools.host,https://app.example.com
    cors_origins: str = ""

    # Azure Monitor / Application Insights. When set, OTel exports traces, logs,
    # and metrics to App Insights via azure-monitor-opentelemetry.
    applicationinsights_connection_string: str | None = None

    # Reference architecture ingest. When true, an APScheduler job pulls the Learn
    # Architecture Center catalog weekly and upserts microsoft_official rows.
    ingest_enabled: bool = False
    ingest_user_agent: str = "AzureArchitectAI-Ingest/1.0"

    # Retail pricing catalog. When `pricing_catalog_enabled` is true, pricing
    # lookups resolve against the locally-scraped `PricingMeter` table (falling
    # back to a committed snapshot, then the live Retail API, then MCP). The
    # `pricing_ingest_daily` scheduler job walks prices.azure.com and upserts
    # rows for the regions/currency below. Use `["*"]` to scrape every region.
    pricing_catalog_enabled: bool = True
    pricing_regions: list[str] = [
        "eastus",
        "eastus2",
        "westus2",
        "westus3",
        "centralus",
        "westeurope",
        "northeurope",
        "uksouth",
    ]
    pricing_currency: str = "USD"
    pricing_catalog_ttl_days: int = 30
    pricing_resolver_confidence_floor: float = 0.45

    # Per-user daily OpenAI token budget (prompt + completion, rolling 24h).
    # Set to 0 to disable. Default is intentionally generous so it never breaks
    # legitimate multi-turn architecture runs; tune downward only after observing
    # real usage in `aa_openai_tokens_used`.
    daily_token_budget_per_user: int = 2_000_000

    # Audit log behavior. When true, inbound request bodies are scanned and the
    # would-be redactions are LOGGED only (shadow mode) — actual body content is
    # not mutated. Flip to enforcing later after a week of clean shadow logs.
    audit_log_enabled: bool = True
    audit_redaction_shadow_mode: bool = True


settings = Settings()
