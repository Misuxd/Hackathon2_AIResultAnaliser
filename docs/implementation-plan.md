# AIResults Assistant — refined plan

## Goal

A real, single-user GEO application: query grounded provider APIs, retain evidence, measure brand visibility, inspect citations, and generate reviewable product assets. Live mode is the default. Explicit demo mode exercises the workflow without API spend and never replaces failed live calls.

The supplied document is a product brief. Its traffic-loss, revenue, ranking-cause and projected-boost claims are unverified assumptions, not facts to encode as measurements.

## Refinements

| Proposal | Decision |
| --- | --- |
| Fixed metrics / “engines connected” badge | Calculate from saved answers. Show key presence separately from authenticated API success. No fake credits or trends. |
| Automatic mock fallback | Explicit modes. Live failures stay visible. |
| LiteLLM + Instructor | Native HTTP adapters retain provider grounding metadata. Pydantic validates answer/extraction in one call, avoiding another billed extraction request. Exact supporting answer text is required for every mention. |
| Fuzzy partial matching | Normalize case, punctuation and company suffixes; use word boundaries. Avoid counting `AcmeCloud` as `Acme`. Explicit aliases are a future feature. |
| Visibility / SoM | Generic visibility uses successful answers to unbranded questions about the declared category. Count each answer once if it names the brand or cites the target hostname. Rank 1/2/3/4+ earns 3/2/1/0.5 in the separate share metric. Count each cited domain once per successful answer. |
| Browser crawling | Opt-in HTML fetches use HTTPS, public DNS checks, validated IP connections, and per-request redirect hostnames. An optional server allowlist restricts fetch destinations further. |
| Fabricated ratings and boosts | Never generate invented ratings, offers, or forecast gains. Product + FAQ JSON-LD must be parseable and its FAQ text included in Markdown. |
| llms.txt bot directives | Markdown proposal, not robots.txt permissions or guaranteed indexing. |
| Supabase, billing, auth | SQLite persists real audits/events. Single-user deployment is explicit; public SaaS security and billing are separate milestones. |
| Exact nested scaffold / skill bootstrapping | Work directly in this repository with `backend/`, `frontend/`, `docs/`. Use native CSS, local fonts and a small dependency set. No arbitrary remote skills installed. |

## Implemented scope

- Four responsive workflow views with keyboard-accessible forms, chart data tables, and reduced-motion handling. Project Guide adds setup instructions, downloadable source documents, and an implementation summary.
- OpenAI Responses with web search and the Perplexity Agent API. Both require cited web evidence for audit results and retry transient connection and service failures within bounds.
- One to ten buyer prompts across selected providers. Four provider requests can run concurrently across up to three active audits. A provider access or billing failure on the first request skips the remaining calls for that engine.
- Sequence-numbered SQLite event log, SSE progress/replay, persisted audit JSON, recent history, explicit failure states and interrupted-job recovery without automatic paid retries.
- Dynamic visibility, weighted share of model, and per-engine coverage. Overview charts and evidence tables use the recorded rank points and cited domain counts.
- Citation filters, expandable engine answers, exact mention evidence and source links; full evidence export and optimizer deep link.
- Real AI rewriting from supplied or fetched content, plus source-only formatting. Numeric claim validation, source diagnosis, and copy/download for Markdown, Product + FAQ JSON-LD and llms.txt.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/health` | Provider configuration presence and fetch allowlist; never keys |
| POST | `/api/v1/audits` | Validate and create asynchronous audit |
| GET | `/api/v1/audits` | Recent audit history |
| GET | `/api/v1/audits/{id}` | Persisted request/results/summary |
| GET | `/api/v1/audits/{id}/stream` | SSE replay using `Last-Event-ID` |
| POST | `/api/v1/optimize` | Source inspection and asset generation |

## Acceptance gates

1. Python tests cover metric denominators, rank verification, input boundaries, both provider contracts, failure handling, content exports, and audit persistence and replay.
2. TypeScript and production build pass.
3. Real-browser workflow covers the 20-query demo audit, visibility result, saved reload, citation evidence, optimizer recommendations, exports, engine readiness, and mobile layout.
4. Verify live calls separately for each provider. The last recorded check succeeded for one OpenAI audit query. Perplexity returned a billing-related 403 and requires an API project with available credits. Live AI rewrite still needs separate end-to-end verification.

## Production follow-ups

Before public hosting, add authentication, authorization, CSRF protection, tenant-scoped data, retention policies, rate limits, durable workers, isolated outbound network policy, and monitoring. Review security before exposure. Before billing customers, verify providers on representative audits and define reproducibility limits.

Browser-rendered crawling, Supabase, trend deltas and automated website publishing are deferred. No environment publication or Git push is included. Generated content requires editorial review; no provider appearance or search uplift is guaranteed.

Public HTTPS fetching passed a live check on the local setup. If DNS is unavailable, the fetcher can resolve through Google Public DNS over HTTPS, which requires access to `dns.google`. The page fetch still needs a direct connection to the validated public IP. Pasted-source processing works independently.
