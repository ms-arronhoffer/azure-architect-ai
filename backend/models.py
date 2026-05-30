from pydantic import BaseModel


class ModelConfig(BaseModel):
    provider: str = "azure"  # "azure" | "github-models" | "github-copilot"
    model: str = ""           # empty = use deployment default


class UserSettings(BaseModel):
    github_token: str = ""
    mode_models: dict[str, ModelConfig] = {}
