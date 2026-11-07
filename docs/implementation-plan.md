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
| Visibility / SoM | Use successful responses only; all failures means unavailable. Rank 1/2/3/4+ earns 3/2/1/0.5. Unranked mentions count for visibility only. Deduplicate brands per answer. All observed brands contribute rank points. |
| “Why AI preferred competitor” | Expose observations and answer evidence, not proven ranking causes. |
| Revenue at risk | Optional scenario = supplied monthly revenue × unmentioned fraction × supplied displacement assumption. No default dollar amount. |
| Browser crawling | Opt-in, bounded HTML fetches; exact hostname allowlist, HTTPS, public DNS checks, and redirect validation. Paste source content when fetching is disabled. JS rendering deferred. |
| Fabricated ratings and boosts | Never generate invented ratings, offers, or forecast gains. Product + FAQ JSON-LD must be parseable and its FAQ text included in Markdown. |
| llms.txt bot directives | Markdown proposal, not robots.txt permissions or guaranteed indexing. |
| Supabase, billing, auth | SQLite persists real audits/events. Single-user deployment is explicit; public SaaS security and billing are separate milestones. |
| Exact nested scaffold / skill bootstrapping | Work directly in this repository with `backend/`, `frontend/`, `docs/`. Use native CSS, local fonts and a small dependency set. No arbitrary remote skills installed. |

## Implemented scope

- Four responsive React/TypeScript views with Obsidian/Slate/Electric Lime hierarchy, keyboard-accessible forms, chart data tables and reduced-motion handling.
- OpenAI Responses with web search, Perplexity Sonar, Gemini with Google Search grounding; configurable model IDs. Grounding citations required, invalid output rejected, bounded retries on transient failures.
- One to ten buyer prompts across selected providers; up to ten concurrent queries and three active audits.
- Sequence-numbered SQLite event log, SSE progress/replay, persisted audit JSON, recent history, explicit failure states and interrupted-job recovery without automatic paid retries.
- Dynamic visibility, weighted SoM, per-engine breakdown and external citation counts; optional scenario calculation with disclosed assumptions.
- Citation filters, expandable engine answers, exact mention evidence and source links; full evidence export and optimizer deep link.
- Real AI rewriting from supplied/fetched content, plus separate source-only formatting. Optional competitor HTML inspection. Numeric hallucination guard, source diagnosis, copy/download for Markdown, Product + FAQ JSON-LD and llms.txt.

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

1. Python tests: metric denominators, rank weights, normalization, input/SSRF boundaries, three native adapter contracts, grounding/extraction rejection, missing-key behavior, source parsing, safe JSON-LD, matching FAQ, invented-number rejection, full 30-result stream, replay, persistence and interrupted jobs.
2. TypeScript and production build pass.
3. Real-browser workflow: explicit 30-query synthetic audit, saved reload, citation drawer/filter/deep link, source export, clipboard, download, missing-key handling and mobile layout.
4. Live provider audit and AI rewrite require actual credentials and allowed API destinations. Mocked contract tests do not prove access, quota or current model compatibility. Keep this gate pending until a real request succeeds.

## Production follow-ups

Before public hosting: authentication, authorization, CSRF protection, tenant-scoped data, encrypted retention/deletion policies, rate limiting/credit accounting, durable workers, isolated egress and DNS pinning against rebinding, monitoring and security review. Before billing customers: representative live-provider evaluation, ranking-extraction calibration, alias management and defined reproducibility limits.

Browser-rendered crawling, Supabase, trend deltas and automated website publishing are deferred. No environment publication or Git push is included. Generated content requires editorial review; no provider appearance or search uplift is guaranteed.

Managed-cloud network finding: local DNS resolution is unavailable even outside the command sandbox. The fetcher falls back to Google Public DNS over verified HTTPS, still checking all returned addresses. `dns.google` is therefore an additional outbound requirement here. Live page fetching remains pending until that network change is applied; pasted-source processing works independently.
