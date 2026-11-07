import re
from collections import Counter
from urllib.parse import urlsplit

from .models import AuditRequest, Provider, QueryResult


def normalize(name: str) -> str:
    tokens = re.sub(r"[^\w]+", " ", name.casefold()).strip().split()
    while tokens and tokens[-1] in {"inc", "llc", "ltd", "limited", "corp", "corporation"}:
        tokens.pop()
    return " ".join(tokens)


def has_brand(text: str, brand: str) -> bool:
    phrase = normalize(brand)
    return bool(phrase and re.search(r"(?<!\w)" + re.escape(phrase) + r"(?!\w)", normalize(text)))


def host_of(url: str) -> str:
    return (urlsplit(url).hostname or "").removeprefix("www.")


def summarize(request: AuditRequest, results: list[QueryResult]) -> dict:
    successful = [r for r in results if r.status == "success"]
    client_host = host_of(request.target_url)
    branded_questions = {r.prompt_index for r in successful if r.generic_buyer_question is False}
    eligible = [i for i, prompt in enumerate(request.prompts)
                if i not in branded_questions and not re.search(r"\b(?:https?://|www\.)", prompt, re.I)
                and has_brand(prompt, request.offering) and not any(
                    has_brand(prompt, brand) for brand in (request.brand, client_host))]
    eligible_answers = [r for r in successful if r.prompt_index in eligible]
    appearances = sum(
        has_brand(r.answer, request.brand) or any(host_of(url) == client_host for url in r.citations)
        for r in eligible_answers
    )
    points: Counter = Counter()
    visible: Counter = Counter()
    engines = []
    domains: Counter = Counter()
    identities = {normalize(request.brand): request.brand}
    ranked_queries = 0
    for result in successful:
        ranked = {}
        for mention in result.mentions:
            identity = normalize(mention.brand_name)
            brand = identities.setdefault(identity, mention.brand_name)
            rank = mention.rank_position
            score = 0 if rank is None else {1: 3, 2: 2, 3: 1}.get(rank, 0.5)
            ranked[brand] = max(ranked.get(brand, 0), score)
        points.update(ranked)
        ranked_queries += any(ranked.values())
        visible.update(ranked.keys())
        domains.update({host_of(url) for url in result.citations} - {""})
    total_points = sum(points.values())
    count = len(successful)
    visibility = round(100 * visible[request.brand] / count, 1) if count else None
    for provider in Provider:
        rows = [r for r in successful if r.provider == provider]
        mentions = sum(any(normalize(m.brand_name) == normalize(request.brand) for m in r.mentions) for r in rows)
        engines.append({"provider": provider, "successful": len(rows), "mentioned": mentions,
                        "visibility_pct": round(100 * mentions / len(rows), 1) if rows else None})
    brands = dict.fromkeys([request.brand, *points.keys()])
    leaderboard = sorted([{"brand": b, "rank_points": points[b], "mentions": visible[b],
                           "weighted_som_pct": round(100 * points[b] / total_points, 1) if total_points else None}
                          for b in brands], key=lambda b: (-b["rank_points"], b["brand"]))
    cited_domains = [{"domain": domain, "response_count": n} for domain, n in sorted(domains.items(), key=lambda row: (-row[1], row[0]))]
    return {"visibility_pct": visibility,
            "generic_visibility": {"percentage": round(100 * appearances / len(eligible_answers), 1) if eligible_answers else None,
                                   "appearances": appearances, "successful_answers": len(eligible_answers), "prompt_indices": eligible},
            "weighted_som_pct": round(100 * points[request.brand] / total_points, 1) if total_points else None,
            "mentioned_responses": visible[request.brand], "successful_queries": count,
            "total_queries": len(results), "failed_queries": len(results) - count,
            "rank_points": points[request.brand], "total_rank_points": total_points, "ranked_queries": ranked_queries,
            "brand_leaderboard": leaderboard, "engine_breakdown": engines,
            "cited_domains": cited_domains,
            "methodology": "Only successful responses contribute. Weighted share divides the brand's verified rank points by all verified rank points across the selected engines. First place earns 3, second 2, third 1, and fourth or lower 0.5. Unranked mentions earn zero."}
