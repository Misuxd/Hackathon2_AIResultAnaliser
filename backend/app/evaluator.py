import re
from collections import Counter
from hashlib import sha256
import json
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
    try:
        return (urlsplit(url).hostname or "").rstrip(".").removeprefix("www.")
    except ValueError:
        return ""


def intent_key(question: str) -> str:
    # ponytail: conservative text grouping; use reviewed intent labels for broader semantic matches.
    text = " ".join(re.sub(r"[^\w.+#]+", " ", question.casefold().strip().rstrip(".?!")).split())
    text = re.sub(r"^(?:please )?(?:can you |could you )?(?:recommend |suggest )", "", text)
    text = re.sub(r"^(?:what are |what is the (?=(?:best|top) )|what (?!is )|which (?:(?:are|is) )?)(?:the )?", "", text)
    text = re.sub(r"^(?:best|top|recommended) ", "", text)
    text = re.sub(r"\b(?:suits?|(?:is|are) (?:best|suitable) for)\b", "for", text)
    return " ".join(text.split()) or question.casefold()


def observed_visibility(request: AuditRequest, results: list[QueryResult], models: dict | None = None) -> dict:
    target = host_of(request.target_url)
    groups: dict[str, list[int]] = {}
    branded = {r.prompt_index for r in results if r.status == "success" and r.generic_buyer_question is False}
    for index, prompt in enumerate(request.prompts):
        if has_brand(prompt, request.brand) or re.search(r"\b[\w-]+\.[a-z]{2,}\b", prompt, re.I):
            branded.add(index)
        groups.setdefault(intent_key(prompt), []).append(index)

    responses: dict[int, list[dict]] = {}
    for result in results:
        valid = result.status == "success" and bool(result.answer.strip())
        cited = list(dict.fromkeys(url for url in result.citations if valid and url.startswith(("https://", "http://"))
                                   and ((source := host_of(url)) == target or source.endswith("." + target))))
        answer_text = re.sub(r"https?://[^\s)>]+", " ", result.answer, flags=re.I)
        mentioned = valid and has_brand(answer_text, request.brand)
        classification = "api_failure" if not valid else "website_cited" if cited else "brand_only" if mentioned else "neither"
        competitors = sorted({m.brand_name for m in result.mentions if valid and not cited and not mentioned
                              and (m.is_recommendation or m.rank_position is not None)
                              and has_brand(answer_text, m.brand_name)})
        responses.setdefault(result.prompt_index, []).append({
            "query_id": result.query_id, "prompt_index": result.prompt_index, "provider": result.provider,
            "classification": classification, "brand_mentioned": mentioned, "website_citations": cited,
            "competitors": competitors, "counted": False,
        })

    questions = []
    for key, indices in groups.items():
        category = "brand_knowledge" if branded.intersection(indices) else "discovery"
        answers = [answer for index in indices for answer in sorted(responses.get(index, []), key=lambda a: a["provider"])]
        counted = {}
        for answer in answers:
            provider = answer["provider"]
            if answer["classification"] != "api_failure" and provider in request.providers and provider not in counted:
                answer["counted"] = True
                counted[provider] = answer
        questions.append({"id": sha256(key.encode()).hexdigest()[:16], "category": category,
                          "prompt_indices": indices, "answers": answers, "valid_answers": len(counted),
                          "cited_answers": sum(a["classification"] == "website_cited" for a in counted.values())})

    comparison = [target, normalize(request.brand), request.mode, models,
                  sorted((q["category"], [" ".join(request.prompts[i].casefold().split()) for i in q["prompt_indices"]])
                         for q in questions)]
    return {"categories": visibility_categories(questions, request.providers, models), "questions": questions,
            "comparison_key": sha256(json.dumps(comparison, sort_keys=True).encode()).hexdigest() if models else None}


def visibility_categories(questions, selected_providers, models=None):
    categories = {}
    for category in ("discovery", "brand_knowledge"):
        rows = [q for q in questions if q["category"] == category]
        answered = [q for q in rows if q["valid_answers"]]
        counted = [a for q in answered for a in q["answers"] if a["counted"]]
        providers = []
        for provider in selected_providers:
            valid = [a for a in counted if a["provider"] == provider]
            cited = sum(a["classification"] == "website_cited" for a in valid)
            planned = sum(provider in q.get("planned_providers", selected_providers) for q in rows)
            providers.append({"provider": provider, "model": (models or {}).get(provider),
                              "cited_answers": cited, "valid_answers": len(valid), "planned_answers": planned,
                              "percentage": round(100 * cited / len(valid), 1) if valid else None})
        categories[category] = {
            "percentage": round(100 * sum(q["cited_answers"] / q["valid_answers"] for q in answered) / len(answered), 1) if answered else None,
            "brand_mention_pct": round(100 * sum(a["brand_mentioned"] for a in counted) / len(counted), 1) if counted else None,
            "valid_answers": len(counted), "planned_answers": sum(p["planned_answers"] for p in providers),
            "distinct_questions": len(rows), "answered_questions": len(answered), "providers": providers,
        }

    return categories


def historical_visibility(audits):
    questions = {}
    providers = set()
    for request, results, created in audits:  # Newest audit first.
        report = observed_visibility(request, results)
        raw = {r.query_id: r for r in results}
        providers.update(request.providers)
        for question in report["questions"]:
            prompt = request.prompts[question["prompt_indices"][0]]
            group = questions.setdefault(question["id"], {"id": question["id"], "category": question["category"],
                                                           "prompt": prompt, "prompt_indices": [],
                                                           "planned_providers": set(), "slots": {}})
            if question["category"] == "brand_knowledge":
                group["category"] = "brand_knowledge"
            group["planned_providers"].update(request.providers)
            for answer in question["answers"]:
                provider = answer["provider"]
                previous = group["slots"].get(provider)
                if previous and (previous["counted"] or not answer["counted"]):
                    continue
                if not answer["counted"] and answer["classification"] != "api_failure":
                    continue
                result = raw[answer["query_id"]]
                group["slots"][provider] = {**answer, "prompt": request.prompts[answer["prompt_index"]],
                                             "excerpt": result.answer[:301], "error": result.error, "skipped": result.skipped,
                                             "audit_created": created}
    for question in questions.values():
        answers = list(question.pop("slots").values())
        question["answers"] = answers
        question["valid_answers"] = sum(a["counted"] for a in answers)
        question["cited_answers"] = sum(a["classification"] == "website_cited" for a in answers)
        question["planned_providers"] = sorted(question["planned_providers"])
    rows = list(questions.values())
    return {"categories": visibility_categories(rows, sorted(providers)), "questions": rows}


def summarize(request: AuditRequest, results: list[QueryResult], models: dict | None = None) -> dict:
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
    relevant_counts: Counter = Counter()
    relevant_pages: dict[str, tuple[int, str]] = {}
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
        cited = set()
        relevant = set()
        for url in result.citations:
            domain = host_of(url)
            if not domain:
                continue
            cited.add(domain)
            if weight := result.citation_weights.get(url):
                relevant.add(domain)
                relevant_pages[domain] = max(relevant_pages.get(domain, (0, "")), (weight, url))
        domains.update(cited)
        relevant_counts.update(relevant)
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
    relevant_sites = sorted([
        {"domain": domain, "url": url, "relevance_score": weight, "response_count": relevant_counts[domain]}
        for domain, (weight, url) in relevant_pages.items()
    ], key=lambda site: (-site["relevance_score"], -site["response_count"], site["domain"]))
    return {"visibility_pct": visibility,
            "observed_visibility": observed_visibility(request, results, models),
            "generic_visibility": {"percentage": round(100 * appearances / len(eligible_answers), 1) if eligible_answers else None,
                                   "appearances": appearances, "successful_answers": len(eligible_answers), "prompt_indices": eligible},
            "weighted_som_pct": round(100 * points[request.brand] / total_points, 1) if total_points else None,
            "mentioned_responses": visible[request.brand], "successful_queries": count,
            "total_queries": len(results), "failed_queries": len(results) - count,
            "rank_points": points[request.brand], "total_rank_points": total_points, "ranked_queries": ranked_queries,
            "brand_leaderboard": leaderboard, "engine_breakdown": engines,
            "cited_domains": cited_domains,
            "relevant_sites": relevant_sites,
            "methodology": "Only successful responses contribute. Weighted share divides the brand's verified rank points by all verified rank points across the selected engines. First place earns 3, second 2, third 1, and fourth or lower 0.5. Unranked mentions earn zero."}
