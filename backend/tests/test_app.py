import asyncio
import json
import os
import socket
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import store
from app.evaluator import has_brand, observed_visibility, summarize
from app.main import app
from app.models import AuditRequest, OptimizationRequest, Provider, QueryResult, public_url
from app.optimizer import optimize, rewrite_with_ai
from app.providers import demo_result, live_result, parse_extraction, post_json, run_query
from app.scraper import fetch_page, inspect_html, validate_fetch_url


def request(**changes):
    return AuditRequest.model_validate({"brand": "Acme", "target_url": "https://acme.com/product",
                                        "prompts": ["Best CRM?"], "mode": "demo", **changes})


class MetricsTests(unittest.TestCase):
    def test_success_denominator_rank_points_and_failed_exclusion(self):
        req = request()
        good = QueryResult(query_id="0:openai", prompt_index=0, provider="openai", status="success", mode="live", mentions=[
            {"brand_name": "Acme Inc.", "rank_position": 2, "evidence": "Acme Inc.", "reason_for_inclusion": "Fact"},
            {"brand_name": "Other CRM", "rank_position": 1, "evidence": "Other CRM", "reason_for_inclusion": "Fact"}])
        failed = QueryResult(query_id="0:perplexity", prompt_index=0, provider="perplexity", status="error", mode="live")
        summary = summarize(req, [good, failed])
        self.assertEqual(summary["visibility_pct"], 100)
        self.assertEqual(summary["weighted_som_pct"], 40)
        self.assertEqual(summary["failed_queries"], 1)
        self.assertEqual(summary["ranked_queries"], 1)

    def test_unranked_mentions_have_no_rank_points(self):
        result = demo_result(request(), 0, Provider.openai)
        result.mentions = [result.mentions[0].model_copy(update={"brand_name": "Acme", "rank_position": None})]
        summary = summarize(request(), [result])
        self.assertEqual(summary["visibility_pct"], 100)
        self.assertIsNone(summary["weighted_som_pct"])

    def test_all_failures_are_unavailable_not_zero(self):
        s = summarize(request(offering="CRM"), [QueryResult(query_id="x", prompt_index=0, provider="openai", mode="live", status="error")])
        self.assertIsNone(s["visibility_pct"])
        self.assertIsNone(s["generic_visibility"]["percentage"])
        self.assertIsNone(s["weighted_som_pct"])

    def test_generic_visibility_and_citation_counts_have_separate_denominators(self):
        req = request(offering="CRM", prompts=["Best CRM?", "Does Acme sell CRM?", "Best payroll tools?", "Compare CRM with Named Product"])
        def row(index, **fields):
            return QueryResult.model_validate({"query_id": f"{index}:openai", "prompt_index": index,
                                               "provider": "openai", "status": "success", "mode": "live", **fields})
        summary = summarize(req, [
            row(0, answer="Acme", citations=["https://www.acme.com/product", "https://acme.com/docs"]),
            row(0, query_id="0:perplexity", provider="perplexity", answer="AcmeCloud", citations=["https://acme.com.example.org/"]),
            row(1, answer="Acme"), row(2, answer="Acme"), row(3, answer="Acme", generic_buyer_question=False),
        ])
        self.assertEqual(summary["generic_visibility"], {"percentage": 50, "appearances": 1, "successful_answers": 2, "prompt_indices": [0]})
        self.assertIn({"domain": "acme.com", "response_count": 1}, summary["cited_domains"])
        self.assertEqual(summary["successful_queries"], 5)
        self.assertEqual(summary["total_rank_points"], 0)

    def test_boundaries_avoid_fuzzy_false_positives(self):
        self.assertFalse(has_brand("AcmeCloud", "Acme"))
        self.assertTrue(has_brand("Try ACME, Inc.", "Acme"))

    def test_observed_visibility_weights_distinct_questions_and_excludes_failures(self):
        req = request(prompts=["Best tools for small teams?", "Which are the top tools for small teams?",
                               "Tools with offline access?", "Tools without offline access?", "Is Acme good?"])
        def result(index, provider="openai", answer="", status="success", citations=(), **fields):
            return QueryResult(query_id=f"{index}:{provider}", prompt_index=index, provider=provider, mode="live",
                               answer=answer, status=status, citations=list(citations), **fields)
        report = observed_visibility(req, [
            result(0, answer="See the [product details](https://shop.acme.com/product).", citations=["https://shop.acme.com/product"]),
            result(0, "perplexity", status="error"), result(1, answer="Try other products."),
            result(2, answer="Acme has an offline mode.", citations=["https://acme.com.example.org/"]),
            result(2, "perplexity", answer="Try Rival.", mentions=[{"brand_name": "Rival", "evidence": "Try Rival.",
                                                                   "reason_for_inclusion": "Offline mode", "is_recommendation": True}]),
            result(3, status="error"), result(3, "perplexity", status="error"),
            result(4, answer="Acme is an option.", citations=["https://www.acme.com/product"]),
        ])
        score = report["categories"]["discovery"]
        self.assertEqual((score["percentage"], score["brand_mention_pct"]), (50, 33.3))
        self.assertEqual((score["distinct_questions"], score["answered_questions"]), (3, 2))
        self.assertEqual((score["valid_answers"], score["planned_answers"]), (3, 6))
        self.assertEqual([row["percentage"] for row in score["providers"]], [50, 0])
        self.assertEqual(report["categories"]["brand_knowledge"]["percentage"], 100)
        self.assertEqual(report["questions"][0]["prompt_indices"], [0, 1])
        self.assertEqual([a["classification"] for a in report["questions"][1]["answers"]], ["brand_only", "neither"])
        self.assertEqual(report["questions"][1]["answers"][1]["competitors"], ["Rival"])

    def test_website_weight_uses_relevance_before_citation_frequency(self):
        direct = "https://www.retailer.example/electronics"
        related = "https://alternatives.example/electronics"
        incidental = "https://anpc.ro/consumer-rights"
        first = QueryResult(query_id="0:openai", prompt_index=0, provider="openai", mode="live", status="success",
                            citations=[direct, "https://retailer.example/related", related, incidental],
                            citation_weights={direct: 100, "https://retailer.example/related": 50, related: 50})
        second = first.model_copy(update={"query_id": "0:perplexity", "provider": Provider.perplexity,
                                         "citations": [related, incidental], "citation_weights": {related: 50}})
        summary = summarize(request(offering="electronics"), [first, second])
        self.assertEqual(summary["relevant_sites"], [
            {"domain": "retailer.example", "url": direct, "relevance_score": 100, "response_count": 1},
            {"domain": "alternatives.example", "url": related, "relevance_score": 50, "response_count": 2},
        ])

    def test_input_validation(self):
        for url in ["http://acme.com", "https://localhost", "https://127.0.0.1", "https://169.254.169.254/latest", "https://user:pass@acme.com", "https://acme.com:8443", "javascript:alert(1)"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                public_url(url)
        self.assertEqual(public_url("https://ACME.com/x#fragment"), "https://acme.com/x")
        self.assertEqual(request(prompts=["Same question?", "same  question?"]).prompts, ["Same question?"])
        for changes in [{"prompts": []}, {"providers": ["openai", "openai"]}]:
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                request(**changes)


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_grounding_and_evidence_for_both_native_adapters(self):
        extracted = {"answer": "1. Acme — documented product.[3] Consumer rights also apply.[5]", "mentions": [{"brand_name": "Acme", "rank_position": 1,
                     "sentiment": "neutral", "evidence": "1. Acme", "reason_for_inclusion": "Documented product"}],
                     "structural_winner_patterns": [], "relevant_sources": [
                         {"citation": "https://acme.com/product#offer", "match": "direct"},
                         {"citation": "[4]", "match": "direct"},
                         {"citation": "https://acme.com/uncited", "match": "direct"},
                     ]}
        text = json.dumps(extracted)
        calls = []
        def handler(req):
            calls.append(req)
            if req.url.host == "api.openai.com":
                body = {"output": [{"type": "web_search_call", "status": "completed"}, {"type": "message", "content": [{"type": "output_text", "text": text,
                        "annotations": [{"type": "url_citation", "url": "https://acme.com/product"},
                                        {"type": "url_citation", "url": "https://anpc.ro/consumer-rights"}]}]}]}
            else:
                numbered = {**extracted, "relevant_sources": [{"citation": "[3]", "match": "direct"}, *extracted["relevant_sources"][1:]]}
                body = {"output": [{"type": "search_results", "results": [{"id": 3, "url": "https://acme.com/product"},
                        {"id": 4, "url": "https://acme.com/uncited"}, {"id": 5, "url": "https://anpc.ro/consumer-rights"}]},
                        {"type": "message", "content": [{"type": "output_text", "text": json.dumps(numbered)}]}]}
            return httpx.Response(200, json=body)
        with patch.dict(os.environ, {"GEO_OPENAI_KEY": "test-key", "GEO_PERPLEXITY_KEY": "test-key", "GEO_PERPLEXITY_MODEL": "sonar-pro"}):
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                for provider in Provider:
                    result = await live_result(client, request(mode="live"), 0, provider)
                    self.assertEqual(result.mode, "live")
                    self.assertEqual(result.mentions[0].brand_name, "Acme")
                    self.assertEqual(result.citations, ["https://acme.com/product", "https://anpc.ro/consumer-rights"])
                    self.assertEqual(result.citation_weights, {"https://acme.com/product": 100})
                self.assertEqual(json.loads(calls[0].content)["tools"], [{"type": "web_search"}])
                self.assertNotIn("Acme", json.loads(calls[0].content)["input"])
                self.assertEqual(calls[1].url.path, "/v1/agent")
                self.assertEqual(json.loads(calls[1].content)["effort"], "fast")

    async def test_connect_and_transient_http_failures_retry_but_access_failure_does_not(self):
        attempts = [httpx.ConnectError("private transport detail"), httpx.Response(503), httpx.Response(200, json={"ok": True}), httpx.Response(401), httpx.Response(200)]
        def handler(_):
            attempt = attempts.pop(0)
            if isinstance(attempt, Exception):
                raise attempt
            return attempt
        with patch("app.providers.asyncio.sleep", new=AsyncMock()):
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                self.assertEqual(await post_json(client, "https://example.com", {}, {}), {"ok": True})
                with self.assertRaisesRegex(ValueError, "rejected access"):
                    await post_json(client, "https://example.com", {}, {})
        self.assertEqual(len(attempts), 1)

    async def test_perplexity_billing_error_skips_later_calls(self):
        calls = []
        def handler(req):
            calls.append(req.url.path)
            return httpx.Response(403, json={"error": {"message": "Billing is disabled for this project. Private detail."}})
        with patch("app.providers.key_for", return_value="test-key"):
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                req = request(mode="live", prompts=["Best CRM?", "Compare CRM options"])
                limit = asyncio.Semaphore(1)
                first = asyncio.create_task(run_query(client, limit, req, 0, Provider.perplexity))
                later = await run_query(client, limit, req, 1, Provider.perplexity, first)
        self.assertEqual(calls, ["/v1/agent"])
        self.assertTrue(first.result().access_error)
        self.assertTrue(later.skipped)
        self.assertIn("Perplexity API billing", later.error)
        self.assertNotIn("Private detail", later.error)

    async def test_live_missing_key_never_falls_back_to_mock(self):
        with patch("app.providers.key_for", return_value=None):
            async with httpx.AsyncClient() as client:
                result = await run_query(client, asyncio.Semaphore(1), request(mode="live"), 0, Provider.openai)
        self.assertEqual(result.status, "error")
        self.assertEqual(result.mode, "live")
        self.assertEqual(result.answer, "")

    async def test_ungrounded_response_is_rejected(self):
        with patch("app.providers.key_for", return_value="test-key"):
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"output": []}))) as client:
                with self.assertRaisesRegex(ValueError, "grounding"):
                    await live_result(client, request(mode="live"), 0, Provider.openai)

    async def test_grounded_answer_without_citations_succeeds(self):
        response = {"output": [{"type": "web_search_call", "status": "completed"},
                               {"type": "message", "content": [{"type": "output_text", "text": '{"answer":"Try Acme.","mentions":[]}'}]}]}
        with patch("app.providers.key_for", return_value="test-key"):
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=response))) as client:
                result = await live_result(client, request(mode="live"), 0, Provider.openai)
        self.assertEqual(result.status, "success")
        self.assertEqual(result.citations, [])

    async def test_bad_mention_is_removed_and_valid_rank_is_recovered_from_answer(self):
        value = {"answer": "1. **Other CRM**\n2. Acme is another option.", "mentions": [
            {"brand_name": "Invented Brand", "rank_position": 1, "evidence": "Invented Brand", "reason_for_inclusion": "Invented"},
            {"brand_name": "Other CRM", "rank_position": None, "evidence": "Other CRM is recommended.", "reason_for_inclusion": "Inexact quote"}]}
        parsed = parse_extraction(json.dumps(value), request())
        self.assertEqual([(m.brand_name, m.rank_position) for m in parsed.mentions], [("Other CRM", 1), ("Acme", 2)])
        self.assertTrue(all(m.evidence in parsed.answer for m in parsed.mentions))

    async def test_unverifiable_rank_is_not_scored(self):
        value = {"answer": "Acme is an option to consider.", "mentions": [{"brand_name": "Acme", "rank_position": 1,
                 "evidence": "Acme is an option", "reason_for_inclusion": "Listed as an option"}]}
        parsed = parse_extraction(json.dumps(value), request())
        self.assertIsNone(parsed.mentions[0].rank_position)


class ContentTests(unittest.IsolatedAsyncioTestCase):
    async def test_https_dns_fallback_checks_resolved_addresses(self):
        public = httpx.Response(200, json={"Status": 0, "Answer": [{"type": 1, "data": "8.8.8.8"}]})
        private = httpx.Response(200, json={"Status": 0, "Answer": [{"type": 1, "data": "127.0.0.1"}]})
        with patch.dict(os.environ, {"GEO_FETCH_HOSTS": "acme.com"}), patch("socket.getaddrinfo", side_effect=socket.gaierror()):
            with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=public)):
                self.assertEqual(await validate_fetch_url("https://acme.com", {"acme.com"}), ("https://acme.com/", "8.8.8.8"))
            with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=private)), self.assertRaisesRegex(ValueError, "non-public"):
                await validate_fetch_url("https://acme.com", {"acme.com"})

    async def test_allowlist_and_private_dns(self):
        with patch.dict(os.environ, {"GEO_FETCH_HOSTS": "acme.com"}):
            with self.assertRaisesRegex(ValueError, "server restricts"):
                await validate_fetch_url("https://other.com", {"other.com"})
            private = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]
            with patch("socket.getaddrinfo", return_value=private), self.assertRaisesRegex(ValueError, "non-public"):
                await validate_fetch_url("https://acme.com", {"acme.com"})

    async def test_custom_public_redirect_requires_opt_in_and_uses_validated_ip(self):
        def handler(req):
            self.assertEqual(req.url.host, "8.8.8.8")
            self.assertEqual(req.headers["Host"], req.extensions["sni_hostname"])
            if req.headers["Host"] == "acme.com":
                return httpx.Response(302, headers={"Location": "https://shop.example.com/product"})
            return httpx.Response(200, headers={"Content-Type": "text/html"}, text="<main><h1>Public product page</h1></main>")
        create_client = httpx.AsyncClient
        public = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]
        with patch.dict(os.environ, {"GEO_FETCH_HOSTS": ""}), patch("socket.getaddrinfo", return_value=public), \
             patch("app.scraper.httpx.AsyncClient", side_effect=lambda **kw: create_client(transport=httpx.MockTransport(handler), **kw)):
            with self.assertRaisesRegex(ValueError, "Allowed redirect hostnames"):
                await fetch_page("https://acme.com", [])
            page = await fetch_page("https://acme.com", ["shop.example.com"])
        self.assertEqual(page["url"], "https://shop.example.com/product")
        self.assertEqual(page["headings"], ["Public product page"])

    async def test_source_export_has_parseable_safe_schema_and_matching_faq(self):
        content = '<main><h1>Acme CRM</h1><p>Acme provides pipeline management for B2B sales teams.</p><table><tr><td>Feature</td></tr></table></main>'
        result = await optimize(OptimizationRequest(brand="Acme", target_url="https://acme.com/product", page_content=content, mode="source"))
        schema = json.loads(result["json_ld_script"].split("\n", 1)[1].rsplit("\n", 1)[0])
        self.assertEqual(schema["@graph"][0]["@type"], "Product")
        self.assertNotIn("AggregateRating", result["json_ld_script"])
        for question in schema["@graph"][1]["mainEntity"]:
            self.assertIn(question["name"], result["optimized_markdown"])
            self.assertIn(question["acceptedAnswer"]["text"], result["optimized_markdown"])
        self.assertTrue(result["checks"][0]["present"])
        self.assertIn("Review the existing table", result["recommendations"][-1]["change"])
        self.assertNotIn("User-agent", result["llms_txt"])

    async def test_html_inspection_ignores_scripts_and_reads_graph(self):
        inspected = inspect_html('<main><h2>What is Acme?</h2><p>Useful content</p></main><script>hidden</script><script type="application/ld+json">{"@graph":[{"@type":"Product"}]}</script>')
        self.assertNotIn("hidden", inspected["text"])
        self.assertEqual(inspected["json_ld"][0]["@graph"][0]["@type"], "Product")

    async def test_ai_rewrite_rejects_invented_numeric_claims(self):
        response = {"output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps({"optimized_markdown": "Acme promises 99.99% availability and is best for every team.", "recommendations": []})}]}]}
        with patch("app.optimizer.key_for", return_value="test-key"), patch("app.optimizer.post_json", new=AsyncMock(return_value=response)):
            with self.assertRaisesRegex(ValueError, "unsupported numbers"):
                await rewrite_with_ai(OptimizationRequest(brand="Acme", target_url="https://acme.com"), "Acme CRM manages pipelines for sales teams.")

    async def test_geo_review_fetches_page_and_returns_question_specific_evidence(self):
        page = {"url": "https://www.acme.com/product", **inspect_html(
            "<title>Acme billing</title><main><h1>Invoicing</h1><p>Schedule automatic reminders for overdue invoices.</p></main>")}
        question = "Which accounting tools support automated invoice reminders?"
        draft = {"optimized_markdown": "# Acme invoicing\n\nSchedule automatic reminders for overdue invoices.",
                 "recommendations": [
                     {"title": "Surface invoice reminders", "evidence_quote": "Schedule automatic reminders for overdue invoices.",
                      "change": "Add an Invoice reminders heading above the reminder sentence.", "why": "The heading directly matches the buyer question."},
                     {"title": "Fabricated", "evidence_quote": "Reminders work offline.", "change": "Repeat it.", "why": "A false claim."},
                 ]}
        response = {"output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(draft)}]}]}
        req = OptimizationRequest(brand="Acme", target_url="https://acme.com/product", fetch_page=True, buyer_question=question)
        with patch("app.optimizer.fetch_page", new=AsyncMock(return_value=page)) as fetch, \
             patch("app.optimizer.key_for", return_value="test-key"), \
             patch("app.optimizer.post_json", new=AsyncMock(return_value=response)) as provider:
            assets = await optimize(req)
        fetch.assert_awaited_once_with(req.target_url, [])
        self.assertIn(question, provider.call_args.args[-1]["input"])
        self.assertIn("Acme billing", provider.call_args.args[-1]["input"])
        self.assertEqual(assets["target_url"], page["url"])
        self.assertEqual([item["title"] for item in assets["recommendations"]], ["Surface invoice reminders"])


class APITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {"GEO_DB_PATH": self.temp.name + "/audits.sqlite3"})
        self.environment.start()
        self.client_context = TestClient(app)
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.environment.stop()
        self.temp.cleanup()

    def test_full_audit_stream_replay_persistence_and_source_export(self):
        payload = request(offering="CRM", prompts=[f"Buyer CRM question {i}?" for i in range(10)]).model_dump()
        response = self.client.post("/api/v1/audits", json=payload)
        self.assertEqual(response.status_code, 202)
        audit_id = response.json()["audit_id"]
        stream = self.client.get(f"/api/v1/audits/{audit_id}/stream")
        self.assertEqual(stream.text.count("event: result\n"), 20)
        self.assertEqual(stream.text.count("event: complete\n"), 1)
        audit = self.client.get(f"/api/v1/audits/{audit_id}").json()
        self.assertEqual(audit["summary"]["successful_queries"], 20)
        self.assertEqual(audit["summary"]["generic_visibility"]["successful_answers"], 20)
        self.assertEqual(audit["summary"]["observed_visibility"]["categories"]["discovery"]["valid_answers"], 20)
        self.assertEqual(audit["request"]["provider_models"], {"openai": "synthetic", "perplexity": "synthetic"})
        replay = self.client.get(f"/api/v1/audits/{audit_id}/stream", headers={"Last-Event-ID": "19"})
        self.assertEqual(replay.text.count("event: result\n"), 1)
        self.assertIn("event: complete", replay.text)
        store.init()
        self.assertEqual(store.get(audit_id)["status"], "complete")
        self.assertEqual(len(self.client.get("/api/v1/audits").json()), 1)
        result = self.client.post("/api/v1/optimize", json={"brand": "Acme", "target_url": "https://acme.com", "page_content": "Acme provides pipeline management for B2B sales teams.", "mode": "source"})
        self.assertEqual(result.status_code, 200)

    def test_live_preflight_unknown_audit_bad_cursor_and_invalid_url(self):
        with patch("app.main.key_for", return_value=None):
            result = self.client.post("/api/v1/audits", json=request(mode="live").model_dump())
        self.assertEqual(result.status_code, 503)
        self.assertEqual(self.client.get("/api/v1/audits/missing").status_code, 404)
        invalid = self.client.post("/api/v1/optimize", json={"brand": "Acme", "target_url": "https://127.0.0.1", "mode": "source"})
        self.assertEqual(invalid.status_code, 422)
        audit_id = store.create(request().model_dump())
        self.assertEqual(self.client.get(f"/api/v1/audits/{audit_id}/stream", headers={"Last-Event-ID": "bad"}).status_code, 400)

    def test_interrupted_audit_is_marked_failed_on_restart(self):
        audit_id = store.create(request().model_dump())
        store.init()
        self.assertEqual(store.get(audit_id)["status"], "failed")
        self.assertEqual(store.events(audit_id, 0)[0]["kind"], "failed")

    def test_previous_visibility_requires_matching_questions_and_models(self):
        req = request(providers=["openai"])
        result = demo_result(req, 0, Provider.openai)
        result.citations = []
        first = store.create(req.model_dump())
        store.finish(first, summarize(req, [result], {"openai": "model-a"}))
        result.citations = [req.target_url]
        different = store.create(req.model_dump())
        store.finish(different, summarize(req, [result], {"openai": "model-b"}))
        self.assertNotIn("previous", store.get(different)["summary"]["observed_visibility"])
        latest = store.create(req.model_dump())
        store.finish(latest, summarize(req, [result], {"openai": "model-a"}))
        self.assertEqual(store.get(latest)["summary"]["observed_visibility"]["previous"]["change_pp"], 100)

    def test_visibility_history_deduplicates_and_keeps_latest_valid_provider_answer(self):
        def save(prompts, answers, **changes):
            req = request(prompts=prompts, **changes)
            results = [QueryResult(query_id=f"{i}:{provider}", prompt_index=i, provider=provider, mode=req.mode,
                                   status="error" if cited is None else "success", answer="Try a CRM.",
                                   citations=[req.target_url] if cited else []) for i, provider, cited in answers]
            audit_id = store.create(req.model_dump())
            for result in results:
                store.append(audit_id, "result", result.model_dump())
            store.finish(audit_id, summarize(req, results))
            return audit_id

        prior = save(["Best CRM?", "Which CRM works offline?"], [(0, "openai", True), (1, "openai", True)], providers=["openai"])
        save(["What is CRM?"], [(0, "openai", True)], providers=["openai"], target_url="https://other.example/")
        save(["What is CRM?"], [(0, "openai", True)], providers=["openai"], mode="live")
        current = save(["Which are the top CRM?", "How much does a CRM cost?"], [
            (0, "openai", False), (0, "perplexity", True), (1, "openai", None), (1, "perplexity", False),
        ])
        last = save(["Best CRM?"], [(0, "openai", None)], providers=["openai"])
        for audit_id in (current, last):
            audit = self.client.get(f"/api/v1/audits/{audit_id}").json()
            report = audit["summary"]["history_visibility"]
            discovery = report["categories"]["discovery"]
            self.assertEqual((discovery["percentage"], discovery["distinct_questions"]), (50, 3))
            self.assertEqual((discovery["valid_answers"], discovery["planned_answers"]), (4, 5))
        prior_report = self.client.get(f"/api/v1/audits/{prior}").json()["summary"]["history_visibility"]
        self.assertEqual(prior_report["categories"]["discovery"]["distinct_questions"], 2)

    def test_category_scopes_history_and_weights_other_sites_by_question(self):
        retailer = "https://retailer.example/laptops"
        incidental = "https://anpc.ro/rights"

        def save(offering, prompt, cite_retailer):
            req = request(offering=offering, prompts=[prompt])
            results = [QueryResult(query_id=f"0:{provider}", prompt_index=0, provider=provider, mode="demo",
                                   status="success", answer="See these choices.",
                                   citations=[retailer, incidental, req.target_url] if cite_retailer and provider == Provider.openai else [],
                                   citation_weights={retailer: 100, req.target_url: 100}) for provider in req.providers]
            audit_id = store.create(req.model_dump())
            for result in results:
                store.append(audit_id, "result", result.model_dump())
            store.finish(audit_id, summarize(req, results))
            return audit_id

        save("Laptops", "Best laptops?", True)
        save("Appliances", "Where can I buy a dishwasher?", True)
        latest = save("LAPTOPS", "What laptops work offline?", False)
        report = self.client.get(f"/api/v1/audits/{latest}").json()["summary"]["history_visibility"]
        self.assertEqual(report["product_category"], "LAPTOPS")
        self.assertEqual(report["categories"]["discovery"]["distinct_questions"], 2)
        self.assertEqual(report["categories"]["discovery"]["percentage"], 25)
        self.assertEqual(report["relevant_sites"], [{"domain": "retailer.example", "url": retailer,
                                                     "response_count": 1, "relevance_score": 100, "visibility_pct": 25}])

    def test_question_history_migration_backfills_saved_attempts_once(self):
        req = request(offering="Laptop   Computers", providers=["openai"])
        result = demo_result(req, 0, Provider.openai)
        audit_id = store.create(req.model_dump() | {"provider_models": {"openai": "synthetic"}})
        store.append(audit_id, "result", result.model_dump())
        store.finish(audit_id, summarize(req, [result]))
        with store.connection() as db:
            db.execute("DROP TABLE question_attempts")
            db.execute("DROP TABLE audit_questions")
            db.execute("PRAGMA user_version = 0")
        store.init()
        store.init()
        with store.connection() as db:
            self.assertEqual(db.execute("SELECT product_category FROM audit_questions").fetchone()[0], "laptop computers")
            self.assertEqual(db.execute("SELECT COUNT(*) FROM question_attempts").fetchone()[0], 1)
        report = self.client.get(f"/api/v1/audits/{audit_id}").json()["summary"]["history_visibility"]
        self.assertEqual(report["questions"][0]["attempts"][0]["model"], "synthetic")

    def test_delete_history_removes_audits_and_events_and_protects_running_work(self):
        completed = store.create(request().model_dump())
        store.finish(completed, {"successful_queries": 0})
        running = store.create(request().model_dump())
        self.assertEqual(self.client.delete("/api/v1/audits").status_code, 409)
        self.assertEqual(len(store.history()), 2)
        store.fail(running, "Cancelled")
        self.assertEqual(self.client.delete("/api/v1/audits").json(), {"deleted": 2})
        self.assertEqual(self.client.get("/api/v1/audits").json(), [])
        self.assertEqual(self.client.get(f"/api/v1/audits/{completed}").status_code, 404)
        self.assertEqual(store.events(completed, 0), [])
        self.assertEqual(store.events(running, 0), [])
        with store.connection() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM audit_questions").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM question_attempts").fetchone()[0], 0)

    def test_saved_results_from_retired_engine_remain_readable(self):
        payload = request().model_dump() | {"providers": ["gemini"]}
        audit_id = store.create(payload)
        store.append(audit_id, "result", {"query_id": "0:gemini", "provider": "gemini"})
        store.finish(audit_id, {"successful_queries": 1})
        self.assertEqual(self.client.get(f"/api/v1/audits/{audit_id}").json()["results"][0]["provider"], "gemini")
        self.assertEqual(self.client.post("/api/v1/audits", json=payload).status_code, 422)


if __name__ == "__main__":
    unittest.main()
