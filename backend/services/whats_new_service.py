import asyncio
import hashlib
import re
import time
import xml.etree.ElementTree as ET
from typing import Any

import httpx

from middleware.logging import get_logger

log = get_logger("whats_new_service")

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

_FEEDS = [
    {
        "source": "azure-blog",
        "source_label": "Azure Blog",
        "url": "https://azure.microsoft.com/en-us/blog/feed/",
    },
    {
        "source": "azure-updates",
        "source_label": "Azure Updates",
        "url": "https://www.microsoft.com/releasecommunications/api/v2/azure/rss",
    },
    {
        "source": "azure-sdk",
        "source_label": "Azure SDK Blog",
        "url": "https://devblogs.microsoft.com/azure-sdk/feed/",
    },
    {
        "source": "azure-devblogs",
        "source_label": "Azure DevBlogs",
        "url": "https://devblogs.microsoft.com/feed/?category=azure",
    },
]

_HEALTH_FEEDS = [
    {
        "source": "azure-service-health",
        "source_label": "Azure Service Health",
        "url": "https://azurestatuscdn.azureedge.net/en-us/status/feed/",
    },
]

_health_cache: dict[str, dict] = {}
_health_cache_time: float = 0.0

_CACHE_TTL = 900  # 15 minutes
_cache: dict[str, dict] = {}
_cache_time: float = 0.0


def _strip_html(text: str) -> str:
    clean = re.sub(r"<[^>]+>", "", text)
    clean = re.sub(r"&[a-zA-Z]+;", " ", clean)
    return " ".join(clean.split())


def _truncate(text: str, max_len: int) -> str:
    clean = _strip_html(text)
    if len(clean) > max_len:
        return clean[:max_len].rsplit(" ", 1)[0] + "…"
    return clean


def _make_id(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:16]


def _parse_rss(root: ET.Element, source: str, source_label: str) -> list[dict]:
    items = []
    channel = root.find("channel")
    if channel is None:
        return items
    for item in channel.findall("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        desc = (item.findtext("description") or "").strip()
        pub_date = (item.findtext("pubDate") or "").strip()
        if title and link:
            items.append({
                "id": _make_id(link),
                "title": title,
                "description": _truncate(desc, 300),
                "url": link,
                "pub_date": pub_date,
                "source": source,
                "source_label": source_label,
            })
    return items


def _parse_atom(root: ET.Element, source: str, source_label: str) -> list[dict]:
    ns = "http://www.w3.org/2005/Atom"
    items = []
    for entry in root.findall(f"{{{ns}}}entry"):
        title_el = entry.find(f"{{{ns}}}title")
        link_el = entry.find(f"{{{ns}}}link")
        summary_el = entry.find(f"{{{ns}}}summary") or entry.find(f"{{{ns}}}content")
        date_el = entry.find(f"{{{ns}}}updated") or entry.find(f"{{{ns}}}published")

        title = (title_el.text or "").strip() if title_el is not None else ""
        link = (link_el.get("href") or "").strip() if link_el is not None else ""
        desc = (summary_el.text or "").strip() if summary_el is not None else ""
        pub_date = (date_el.text or "").strip() if date_el is not None else ""

        if title and link:
            items.append({
                "id": _make_id(link),
                "title": title,
                "description": _truncate(desc, 300),
                "url": link,
                "pub_date": pub_date,
                "source": source,
                "source_label": source_label,
            })
    return items


def _parse_feed(xml_text: str, source: str, source_label: str) -> list[dict]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        log.warning("whats_new.parse_error", source=source, error=str(exc))
        return []

    if root.find("channel") is not None:
        return _parse_rss(root, source, source_label)

    atom_ns = "http://www.w3.org/2005/Atom"
    if root.tag == f"{{{atom_ns}}}feed" or root.find(f"{{{atom_ns}}}entry") is not None:
        return _parse_atom(root, source, source_label)

    return []


async def fetch_announcements(force_refresh: bool = False) -> list[dict]:
    global _cache, _cache_time
    now = time.monotonic()
    if not force_refresh and _cache and (now - _cache_time) < _CACHE_TTL:
        return list(_cache.values())

    results: dict[str, dict] = {}
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers={"User-Agent": _USER_AGENT}) as client:
        for feed in _FEEDS:
            try:
                resp = await client.get(feed["url"])
                resp.raise_for_status()
                items = _parse_feed(resp.text, feed["source"], feed["source_label"])
                for item in items:
                    results[item["id"]] = item
                log.info("whats_new.feed_fetched", source=feed["source"], count=len(items))
            except Exception as exc:
                log.warning("whats_new.feed_error", source=feed["source"], error=str(exc))

    _cache = results
    _cache_time = now
    return list(results.values())


async def fetch_service_health(force_refresh: bool = False) -> list[dict]:
    global _health_cache, _health_cache_time
    now = time.monotonic()
    if not force_refresh and _health_cache is not None and (now - _health_cache_time) < _CACHE_TTL:
        return list(_health_cache.values())

    results: dict[str, dict] = {}
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers={"User-Agent": _USER_AGENT}) as client:
        for feed in _HEALTH_FEEDS:
            try:
                resp = await client.get(feed["url"])
                resp.raise_for_status()
                items = _parse_feed(resp.text, feed["source"], feed["source_label"])
                for item in items:
                    results[item["id"]] = item
                log.info("service_health.feed_fetched", source=feed["source"], count=len(items))
            except Exception as exc:
                log.warning("service_health.feed_error", source=feed["source"], error=str(exc))

    _health_cache = results
    _health_cache_time = now
    return list(results.values())


def _draft_sync(
    announcements: list[dict],
    customer_context: str,
    client: Any,
    deployment: str,
) -> tuple[str, str]:
    items_text = "\n".join(
        f"- [{i + 1}] {a['title']} ({a['source_label']})\n  {a['description']}\n  Link: {a['url']}"
        for i, a in enumerate(announcements)
    )
    context_clause = f"\n\nCustomer context: {customer_context.strip()}" if customer_context.strip() else ""

    prompt = (
        "You are an Azure Solutions Architect drafting a professional customer communication email."
        f"{context_clause}\n\n"
        "The following Microsoft Azure announcements have been selected as relevant:\n\n"
        f"{items_text}\n\n"
        "Write a concise, professional customer-facing HTML email that:\n"
        "1. Has an engaging subject line\n"
        "2. Opens with a brief value-statement for why these updates matter\n"
        "3. Summarizes each announcement in plain language (1-2 sentences each) with customer benefit, "
        "linking each announcement title as a hyperlink using its provided URL\n"
        "4. Closes with a call to action (schedule a discussion, ask questions, etc.)\n"
        "5. Uses a professional but approachable tone\n"
        "6. Uses inline CSS only (no external stylesheets or <style> blocks)\n"
        "7. Uses Azure brand colors: primary blue #0078D4 for headings and links, "
        "neutral background #f5f5f5 for the outer wrapper, white #ffffff for the email body\n"
        "8. Structures the HTML as: outer <div> wrapper, inner content <div>, "
        "a header section with a colored banner, announcement items as styled <div> blocks "
        "with a subtle left border in #0078D4, and a footer with closing\n"
        "9. Do NOT include <!DOCTYPE>, <html>, <head>, or <body> tags — return only the inner HTML fragment\n\n"
        "Return your response in this EXACT format:\n"
        "SUBJECT: <subject line>\n"
        "BODY:\n"
        "<html email fragment>"
    )

    response = client.chat.completions.create(
        model=deployment,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
        max_completion_tokens=2500,
    )

    text = (response.choices[0].message.content or "").strip()

    if "SUBJECT:" in text and "BODY:" in text:
        parts = text.split("BODY:", 1)
        subject = parts[0].replace("SUBJECT:", "").strip()
        body = parts[1].strip()
    else:
        subject = "Azure Updates: New Features Announced"
        body = text

    return subject, body


async def draft_customer_email(
    announcements: list[dict],
    customer_context: str,
    client: Any,
    deployment: str,
) -> tuple[str, str]:
    return await asyncio.to_thread(_draft_sync, announcements, customer_context, client, deployment)
