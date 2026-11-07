# AIResults Assistant

A functioning single-user GEO workspace: search-grounded OpenAI, Perplexity and Gemini audits, persisted results, replayable SSE progress, citation inspection, and AI product-copy / JSON-LD / llms.txt generation.

**Live mode is the default.** It requires provider credentials and may incur API charges. Synthetic demo mode is a separate testing option; failed live requests never become mock successes. Provider APIs simulate grounded research, not the exact behavior of their consumer chat interfaces.

See the [refined implementation plan](docs/implementation-plan.md) for corrected assumptions, scope and release gates.

## Install

Requires Python 3.12+, Node.js 22.12+ and npm. Use the existing checkout; a worktree is unnecessary.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock
cd frontend
npm ci
```

Configure credentials securely in environment settings, or create an ignored `backend/.env` using `backend/.env.example`. Never commit credentials.

| Setting | Purpose |
| --- | --- |
| `GEO_OPENAI_KEY` | OpenAI Responses API access |
| `GEO_PERPLEXITY_KEY` | Perplexity Sonar API access |
| `GEO_GEMINI_KEY` | Gemini API access |
| `GEO_OPENAI_MODEL` | Default `gpt-4.1-mini`; requires web search support for audits |
| `GEO_PERPLEXITY_MODEL` | Default `sonar-pro` |
| `GEO_GEMINI_MODEL` | Default `gemini-2.5-flash`; requires Google Search grounding |
| `GEO_FETCH_HOSTS` | Comma-separated exact public hostnames for HTML fetching; empty disables fetching |
| `GEO_DB_PATH` | Default `.data/audits.sqlite3`, relative to backend working directory |
| `GEO_CORS_ORIGINS` | Default local Vite origins on port 5173 |

Standard `OPENAI_API_KEY`, `PERPLEXITY_API_KEY` and `GEMINI_API_KEY` also work where supported. In managed cloud settings use `GEO_*_KEY`; `OPENAI_*` names are reserved. Outbound API hosts: `api.openai.com`, `api.perplexity.ai`, `generativelanguage.googleapis.com`. Page fetching requires the target and redirect hosts in both `GEO_FETCH_HOSTS` and the environment network policy.

## Run

Start the API from the backend directory:

```bash
cd backend
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal, start the frontend:

```bash
cd frontend
npm run dev -- --port 5173
```

Vite serves the UI on port 5173 and proxies `/api` to the local backend. API documentation is at backend `/docs`. `GET /api/v1/health` reports key presence, not successful authentication.

## Workflow

1. Create a live audit using your brand, HTTPS product URL, competitor names and 1–10 unique buyer prompts. Select engines for which you configured credentials. Ten prompts and three engines produce 30 requests.
2. Watch the query radar, then inspect the overview and expandable citation matrix. Reload or open recent history to restore saved evidence without repeating paid requests. Export the full audit JSON.
3. Open the optimizer from a citation row. Paste actual product content or enable fetching for an allowed hostname. Optionally inspect three competitor pages.
4. Choose a provider for a real AI rewrite; source-only formatting is a separate option. Review, copy or download Markdown, Product + FAQ JSON-LD, and llms.txt. No website publishing is performed.

Visibility uses successful answers only. SoM uses rank weights 3/2/1/0.5; unranked mentions earn zero rank points. All failures means metrics are unavailable, not zero. Revenue figures are optional scenarios from your assumptions, not measured losses. No ratings, ranking gains, historical deltas or customer listings are fabricated. FAQ markup must correspond to visible page content; rich-result eligibility is not guaranteed. llms.txt is an emerging Markdown convention, not crawler permissions.

## Validate

```bash
cd backend
../.venv/bin/python -m unittest discover -s tests -v
../.venv/bin/python -m compileall -q app
cd ../frontend
npm run build
npm run test:e2e
```

Browser checks use installed Google Chrome on Windows and `/usr/bin/chromium` on Linux. Set `CHROMIUM_PATH` to use a different Chromium executable. Playwright starts services if needed. Backend tests use temporary databases; browser tests create labelled synthetic audits in the local database. Screenshots/traces go to ignored `frontend/test-results/`.

## Deployment boundaries

This is a working **single-user MVP**, not a public multi-tenant SaaS. Keep it in a trusted workspace. Authentication, tenant isolation and billing are not implemented; CORS is not authentication. Run one Uvicorn worker. Jobs run in the API process and are marked failed after interruption rather than automatically re-billed. SQLite retains audit requests, results and events; back up `backend/.data/` for history. Optimizer exports are not retained by the API.

HTML fetching uses exact host allowlists, public DNS checks, HTTPS, per-redirect validation, size/time limits and no JavaScript execution. If local DNS is unavailable, it uses Google Public DNS over HTTPS (`dns.google` must be allowed); it never skips address checks. Production needs isolated outbound access and DNS pinning against rebinding. Rewrites reject newly invented numbers; qualitative claims still require review. Live provider/model compatibility must be verified with actual credentials.
