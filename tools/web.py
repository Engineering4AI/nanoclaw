from __future__ import annotations

import html
import re
import urllib.parse

import httpx

from . import Tool

_HEADERS = {"User-Agent": "NanoClaw/1.0"}
_TIMEOUT = 30


def _make_client(proxy: str = "") -> httpx.AsyncClient:
    kwargs: dict = {
        "trust_env": False,  # never inherit HTTP_PROXY
        "timeout": _TIMEOUT,
        "headers": _HEADERS,
        "follow_redirects": True,
    }
    if proxy:
        if not proxy.startswith(("http://", "https://")):
            raise ValueError("NANOCLAW_WEB_PROXY must start with http:// or https://")
        if "@" in urllib.parse.urlparse(proxy).netloc:
            raise ValueError("Proxy credentials in URL are not allowed")
        kwargs["proxy"] = proxy
    return httpx.AsyncClient(**kwargs)


def _strip_html(text: str) -> str:
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s{3,}", "\n\n", text).strip()


async def _web_fetch(args: dict) -> str:
    from .. import config as _cfg  # lazy to avoid circular import at module level
    proxy = args.get("proxy", "")
    async with _make_client(proxy) as client:
        r = await client.get(args["url"])
        r.raise_for_status()
    ct = r.headers.get("content-type", "")
    if "html" in ct:
        return _strip_html(r.text)
    return r.text


async def _web_search(args: dict) -> str:
    query = args["query"]
    n = args.get("num_results", 5)
    encoded = urllib.parse.quote_plus(query)
    url = f"https://html.duckduckgo.com/html/?q={encoded}"
    async with _make_client() as client:
        r = await client.get(url)
        r.raise_for_status()

    results = []
    for m in re.finditer(
        r'class="result__title"[^>]*>.*?<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>.*?'
        r'class="result__snippet"[^>]*>(.*?)</span>',
        r.text, re.DOTALL
    ):
        href, title, snippet = m.group(1), m.group(2), m.group(3)
        title = _strip_html(title).strip()
        snippet = _strip_html(snippet).strip()
        results.append(f"[{title}]({href})\n{snippet}")
        if len(results) >= n:
            break

    return "\n\n".join(results) or "No results found."


WEB_FETCH = Tool(
    name="web_fetch",
    description="HTTP GET a URL and return the page text (HTML stripped).",
    input_schema={
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "URL to fetch"},
        },
        "required": ["url"],
    },
    execute=_web_fetch,
)

WEB_SEARCH = Tool(
    name="web_search",
    description="Search DuckDuckGo and return top N results as title + snippet.",
    input_schema={
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "num_results": {"type": "integer", "description": "Number of results (default 5)"},
        },
        "required": ["query"],
    },
    execute=_web_search,
)

WEB_TOOLS = [WEB_FETCH, WEB_SEARCH]
