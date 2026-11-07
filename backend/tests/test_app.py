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
from app.evaluator import has_brand, summarize
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

    def test_input_validation(self):
        for url in ["http://acme.com", "https://localhost", "https://127.0.0.1", "https://169.254.169.254/latest", "https://user:pass@acme.com", "https://acme.com:8443", "javascript:alert(1)"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                public_url(url)
        self.assertEqual(public_url("https://ACME.com/x#fragment"), "https://acme.com/x")
        for changes in [{"prompts": []}, {"prompts": ["same", "same"]}, {"providers": ["openai", "openai"]}]:
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                request(**changes)


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_grounding_and_evidence_for_both_native_adapters(self):
        extracted = {"answer": "1. Acme — documented product.[3]", "mentions": [{"brand_name": "Acme", "rank_position": 1,
                     "sentiment": "neutral", "evidence": "1. Acme", "reason_for_inclusion": "Documented product"}], "structural_winner_patterns": []}
        text = json.dumps(extracted)
        calls = []
        def handler(req):
            calls.append(req)
            if req.url.host == "api.openai.com":
                body = {"output": [{"type": "web_search_call", "status": "completed"}, {"type": "message", "content": [{"type": "output_text", "text": text,
                        "annotations": [{"type": "url_citation", "url": "https://acme.com/product"}]}]}]}
            else:
                body = {"output": [{"type": "search_results", "results": [{"id": 3, "url": "https://acme.com/product"},
                        {"id": 4, "url": "https://acme.com/uncited"}]},
                        {"type": "message", "content": [{"type": "output_text", "text": text}]}]}
            return httpx.Response(200, json=body)
        with patch.dict(os.environ, {"GEO_OPENAI_KEY": "test-key", "GEO_PERPLEXITY_KEY": "test-key", "GEO_PERPLEXITY_MODEL": "sonar-pro"}):
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                for provider in Provider:
                    result = await live_result(client, request(mode="live"), 0, provider)
                    self.assertEqual(result.mode, "live")
                    self.assertEqual(result.mentions[0].brand_name, "Acme")
                    self.assertEqual(result.citations, ["https://acme.com/product"])
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
        response = {"output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps({"optimized_markdown": "Acme promises 99.99% availability and is best for every team."})}]}]}
        with patch("app.optimizer.key_for", return_value="test-key"), patch("app.optimizer.post_json", new=AsyncMock(return_value=response)):
            with self.assertRaisesRegex(ValueError, "unsupported numbers"):
                await rewrite_with_ai(OptimizationRequest(brand="Acme", target_url="https://acme.com"), "Acme CRM manages pipelines for sales teams.")


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

    def test_saved_results_from_retired_engine_remain_readable(self):
        payload = request().model_dump() | {"providers": ["gemini"]}
        audit_id = store.create(payload)
        store.append(audit_id, "result", {"query_id": "0:gemini", "provider": "gemini"})
        store.finish(audit_id, {"successful_queries": 1})
        self.assertEqual(self.client.get(f"/api/v1/audits/{audit_id}").json()["results"][0]["provider"], "gemini")
        self.assertEqual(self.client.post("/api/v1/audits", json=payload).status_code, 422)


if __name__ == "__main__":
    unittest.main()
