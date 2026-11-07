import re
from collections import Counter
from urllib.parse import urlsplit

from .models import AuditRequest, QueryResult


def normalize(name: str) -> str:
    tokens = re.sub(r"[^\w]+", " ", name.casefold()).strip().split()
    while tokens and tokens[-1] in {"inc", "llc", "ltd", "limited", "corp", "corporation"}:
        tokens.pop()
    return " ".join(tokens)


def canonical(name: str, request: AuditRequest) -> str:
    return next((brand for brand in [request.brand, *request.competitors] if normalize(brand) == normalize(name)), name.strip())


def has_brand(text: str, brand: str) -> bool:
    return bool(re.search(r"(?<!\w)" + re.escape(normalize(brand)) + r"(?!\w)", normalize(text)))


def summarize(request: AuditRequest, results: list[QueryResult]) -> dict:
    successful = [r for r in results if r.status == "success"]
    points: Counter = Counter()
    visible: Counter = Counter()
    engines = []
    domains: Counter = Counter()
    patterns: Counter = Counter()
    identities = {normalize(b): b for b in [request.brand, *request.competitors]}
    for result in successful:
        ranked = {}
        for mention in result.mentions:
            brand = identities.setdefault(normalize(mention.brand_name), canonical(mention.brand_name, request))
            rank = mention.rank_position
            score = 0 if rank is None else {1: 3, 2: 2, 3: 1}.get(rank, 0.5)
            ranked[brand] = max(ranked.get(brand, 0), score)
        points.update(ranked)
        visible.update(ranked.keys())
        domains.update({urlsplit(url).hostname.removeprefix("www.") for url in result.citations if urlsplit(url).hostname})
        patterns.update(set(result.structural_winner_patterns))
    total_points = sum(points.values())
    count = len(successful)
    visibility = round(100 * visible[request.brand] / count, 1) if count else None
    for provider in ("openai", "perplexity", "gemini"):
        rows = [r for r in successful if r.provider == provider]
        mentions = sum(any(canonical(m.brand_name, request) == request.brand for m in r.mentions) for r in rows)
        engines.append({"provider": provider, "successful": len(rows), "mentioned": mentions,
                        "visibility_pct": round(100 * mentions / len(rows), 1) if rows else None})
    brands = dict.fromkeys([request.brand, *request.competitors, *points.keys()])
    leaderboard = sorted([{"brand": b, "rank_points": points[b], "mentions": visible[b],
                           "weighted_som_pct": round(100 * points[b] / total_points, 1) if total_points else None}
                          for b in brands], key=lambda b: (-b["rank_points"], b["brand"]))
    client_host = (urlsplit(request.target_url).hostname or "").removeprefix("www.")
    third_party = [{"domain": domain, "response_count": n} for domain, n in domains.most_common()
                   if domain != client_host and not domain.endswith("." + client_host)][0:8]
    scenario = None
    if request.monthly_organic_revenue is not None and visibility is not None:
        scenario = round(request.monthly_organic_revenue * (1 - visibility / 100) * request.displacement_assumption, 2)
    return {"visibility_pct": visibility,
            "weighted_som_pct": round(100 * points[request.brand] / total_points, 1) if total_points else None,
            "mentioned_responses": visible[request.brand], "successful_queries": count,
            "total_queries": len(results), "failed_queries": len(results) - count,
            "rank_points": points[request.brand], "total_rank_points": total_points,
            "revenue_scenario_usd": scenario,
            "scenario_assumption": request.displacement_assumption,
            "primary_gap": patterns.most_common(1)[0][0] if patterns else "Inspect source content before diagnosing a gap",
            "brand_leaderboard": leaderboard, "engine_breakdown": engines,
            "top_third_party_domains": third_party,
            "methodology": "Visibility uses successful responses only. SoM uses explicit ranks: 3/2/1/0.5 points; unranked mentions earn 0. Engines are pooled equally per successful response. Patterns are observations, not proven ranking causes."}
