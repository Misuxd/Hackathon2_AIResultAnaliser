"""Opt-in HTML fetching. No JavaScript execution, private networks, or arbitrary redirects."""
import asyncio
import ipaddress
import json
import os
import socket
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup

from .models import public_url


def allowed_hosts() -> list[str]:
    return [h.strip().lower() for h in os.getenv("GEO_FETCH_HOSTS", "").split(",") if h.strip()]


async def validate_fetch_url(url: str):
    url = public_url(url)
    host = urlsplit(url).hostname
    if host not in allowed_hosts():
        raise ValueError(f"Page fetching is not enabled for {host}. Add its exact hostname to GEO_FETCH_HOSTS or paste page content.")
    try:
        resolved = await asyncio.to_thread(socket.getaddrinfo, host, 443, 0, socket.SOCK_STREAM)
        addresses = [row[4][0] for row in resolved]
    except socket.gaierror:
        # Managed proxies may support HTTPS but not local DNS. Resolve over verified
        # HTTPS rather than skipping the private-address check in that environment.
        addresses = []
        async with httpx.AsyncClient(timeout=8) as client:
            for kind in ("A", "AAAA"):
                response = await client.get("https://dns.google/resolve", params={"name": host, "type": kind})
                if response.is_error:
                    raise ValueError("Local DNS is unavailable. Allow dns.google for HTTPS DNS resolution, or paste the page content.")
                data = response.json()
                if data.get("Status") != 0:
                    raise ValueError("The page hostname could not be resolved")
                addresses.extend(answer["data"] for answer in data.get("Answer", []) if answer.get("type") in (1, 28))
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("Page resolves to a non-public address; fetching blocked")
    return url


def inspect_html(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    schemas = []
    for node in soup.select('script[type="application/ld+json"]'):
        try:
            value = json.loads(node.get_text())
            schemas.extend(value if isinstance(value, list) else [value])
        except (ValueError, TypeError):
            pass
    has_table = bool(soup.find("table"))
    headings = [h.get_text(" ", strip=True) for h in soup.select("h1,h2,h3")]
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    for node in soup.select("script,style,noscript,nav,footer,header"):
        node.decompose()
    main = soup.find("main") or soup.find("article") or soup.body or soup
    text = main.get_text("\n", strip=True)
    return {"text": text[:50000], "title": title, "headings": headings[:40], "has_table": has_table,
            "json_ld": schemas[:20]}


async def fetch_page(url: str) -> dict:
    async with asyncio.timeout(25):
        async with httpx.AsyncClient(timeout=15, follow_redirects=False, headers={"User-Agent": "AIResultsAssistant/0.1 (page audit)"}) as client:
            for _ in range(4):
                url = await validate_fetch_url(url)
                async with client.stream("GET", url) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise ValueError("Page returned a redirect without a destination")
                        url = urljoin(url, location)
                        continue
                    if response.is_error:
                        raise ValueError(f"Page returned HTTP {response.status_code}")
                    if "text/html" not in response.headers.get("content-type", ""):
                        raise ValueError("Only HTML pages are supported")
                    chunks = bytearray()
                    async for chunk in response.aiter_bytes():
                        chunks.extend(chunk)
                        if len(chunks) > 2_000_000:
                            raise ValueError("Page exceeds the 2 MB HTML limit")
                    return {"url": url, **inspect_html(chunks.decode(response.encoding or "utf-8", errors="replace"))}
    raise ValueError("Too many redirects")
