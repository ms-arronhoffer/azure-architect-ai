from pydantic import BaseModel


class ModelConfig(BaseModel):
    provider: str = "azure"  # "azure" | "github-models" | "github-copilot"
    model: str = ""           # empty = use deployment default


class UserSettings(BaseModel):
    # GitHub PAT is no longer carried in this model. Tokens live encrypted server-side
    # and are managed via /api/auth/github-token. Clients see only configured-state there.
    mode_models: dict[str, ModelConfig] = {}
