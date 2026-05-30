from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    azure_openai_endpoint: str
    azure_openai_key: str | None = None
    azure_openai_deployment_chat: str = "gpt-4o-mini"
    azure_openai_deployment_arch: str = "gpt-4.1"
    azure_openai_api_version: str = "2024-12-01-preview"

    # MCP integration
    mcp_enabled: bool = True
    azure_subscription_id: str | None = None


settings = Settings()
