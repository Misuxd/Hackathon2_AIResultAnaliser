# AIResults Assistant

A single-user GEO workspace for search-grounded OpenAI and Perplexity audits, saved evidence, product-page recommendations, and copy, JSON-LD, and llms.txt exports.

**Live mode is the default.** It requires provider credentials and may incur API charges. Synthetic demo mode is a separate testing option; failed live requests never become mock successes. Provider APIs simulate grounded research, not the exact behavior of their consumer chat interfaces.

Open **Project guide** in the app sidebar for setup instructions, a summary of the work completed, and downloads of this README and the [implementation plan](docs/implementation-plan.md).

## Install

Requires Python 3.12+, Node.js 22.12+ and npm. Start in the project root.

**Windows PowerShell**

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.lock
cd frontend
npm.cmd ci
```

**macOS and Linux**

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
| `GEO_PERPLEXITY_KEY` | Perplexity Agent API access |
| `GEO_OPENAI_MODEL` | Default `gpt-4.1-mini`; requires web search support for audits |
| `GEO_PERPLEXITY_MODEL` | Agent API effort level (default `fast`) or a provider-qualified model ID. Existing `sonar-pro` settings map to `fast`. |
| `GEO_FETCH_HOSTS` | Optional server allowlist of exact public hostnames. Leave empty to fetch the public HTTPS URL entered in the optimizer. |
| `GEO_DB_PATH` | Default `.data/audits.sqlite3`, relative to backend working directory |
| `GEO_CORS_ORIGINS` | Default local Vite origins on port 5173 |

Standard `OPENAI_API_KEY` and `PERPLEXITY_API_KEY` also work where supported. In managed cloud settings use `GEO_*_KEY`. The backend calls `api.openai.com` and `api.perplexity.ai`. Perplexity calls require an API project with billing enabled. The optimizer lets you allow additional redirect hosts per fetch, subject to any server restrictions and network policy.

## Run

On Windows, start the backend and frontend in separate PowerShell terminals opened in the project root. Leave both terminals running.

```powershell
cd backend
& ..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
cd frontend
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

On macOS and Linux, start the API from the backend directory.

```bash
cd backend
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal opened in the project root, start the frontend.

```bash
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

Vite serves the UI on port 5173 and proxies `/api` to the local backend. API documentation is at backend `/docs`. `GET /api/v1/health` reports key presence, not successful authentication.

## Workflow

1. Enter your brand, HTTPS product URL, and product category or buyer need. Use **Suggest prompts** to generate unbranded questions, or write up to ten. Ten questions across both engines plan 20 answers.
2. Read the circular visibility result at the end of Live Audit. It counts successful answers to eligible generic questions that name the brand or cite the target hostname. Overview shows which answers contributed, ranked brand shares, and how often each website was cited. Use the Citation Matrix to inspect or export the original evidence.
3. Open the optimizer from a citation row. Paste product content or select **Fetch the public product page**. You can add allowed redirect hostnames for that request.
4. Review recommended changes for buyer intent, retrieval, authority, and page structure. Choose AI rewrite or source-only export, then review and copy or download the drafts you want to apply.

Visibility uses successful answers only. Weighted share uses rank weights of 3, 2, 1, and 0.5. Unranked mentions earn zero rank points. Each cited domain counts once per successful answer. FAQ markup must correspond to visible page content. llms.txt is a Markdown export for review.

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

HTML fetching validates every redirect and connects directly to a validated public IP while verifying TLS against the original hostname. If local DNS is unavailable, it can resolve through Google Public DNS over HTTPS. Fetching has size and time limits. Rewrites reject newly invented numbers, and qualitative claims still require review.
