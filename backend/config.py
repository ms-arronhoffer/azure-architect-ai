from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    azure_openai_endpoint: str
    azure_openai_key: str | None = None
    azure_openai_deployment_chat: str = "gpt-4o-mini"
    azure_openai_deployment_arch: str = "gpt-4.1"
    azure_openai_deployment_embedding: str = "text-embedding-3-small"
    azure_openai_api_version: str = "2024-12-01-preview"

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


settings = Settings()
