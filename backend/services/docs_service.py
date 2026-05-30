import httpx

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
        except Exception:
            return []
