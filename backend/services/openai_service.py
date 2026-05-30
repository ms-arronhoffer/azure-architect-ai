from openai import AzureOpenAI, OpenAI
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from config import settings

_client: AzureOpenAI | None = None

TOOL_INCOMPATIBLE_MODELS = {
    "llama-3.1-70b-instruct",
    "mistral-large",
    "phi-3.5-mini-instruct",
}


def get_client() -> AzureOpenAI:
    global _client
    if _client is None:
        if settings.azure_openai_key:
            _client = AzureOpenAI(
                azure_endpoint=settings.azure_openai_endpoint,
                api_key=settings.azure_openai_key,
                api_version=settings.azure_openai_api_version,
            )
        else:
            credential = DefaultAzureCredential()
            token_provider = get_bearer_token_provider(
                credential, "https://cognitiveservices.azure.com/.default"
            )
            _client = AzureOpenAI(
                azure_endpoint=settings.azure_openai_endpoint,
                azure_ad_token_provider=token_provider,
                api_version=settings.azure_openai_api_version,
            )
    return _client


def get_deployment(mode: str) -> str:
    if mode in ("architecture", "waf"):
        return settings.azure_openai_deployment_arch
    return settings.azure_openai_deployment_chat


def resolve_client_and_model(
    mode: str,
    provider: str = "azure",
    model: str = "",
    github_token: str = "",
) -> tuple[AzureOpenAI | OpenAI, str]:
    """Return (client, model_string) for the given provider/model combo."""
    if provider == "azure" or not provider:
        return get_client(), get_deployment(mode)

    if not github_token:
        raise ValueError("GitHub token not configured. Add your token in Settings.")

    base_url = (
        "https://api.githubcopilot.com"
        if provider == "github-copilot"
        else "https://models.inference.ai.azure.com"
    )
    client = OpenAI(api_key=github_token, base_url=base_url)
    model_str = model or "gpt-4o"
    return client, model_str

