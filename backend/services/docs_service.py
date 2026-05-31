import httpx

from middleware.logging import get_logger

log = get_logger("docs_service")
LEARN_SEARCH_URL = "https://learn.microsoft.com/api/search"


async def search_azure_docs(query: str, category: str = "", top: int = 5) -> list[dict]:
    """Query the Microsoft Learn search API and return article results."""
    params = {
        "search": query,
        "locale": "en-us",
        "$top": top,
        "facet": "products",
        "scoringprofile": "semantic",
    }
    if category:
        params["category"] = category

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(LEARN_SEARCH_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [])
            return [
                {
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "description": r.get("description", ""),
                }
                for r in results
                if r.get("url")
            ]
        except httpx.HTTPStatusError as exc:
            log.warning(
                "learn_search.http_error",
                status=exc.response.status_code,
                query=query,
            )
            return []
        except httpx.RequestError as exc:
            log.warning("learn_search.request_error", error=str(exc), query=query)
            return []
        except Exception as exc:
            log.exception("learn_search.unexpected", error=str(exc), query=query)
            return []
