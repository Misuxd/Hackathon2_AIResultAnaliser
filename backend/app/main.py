import asyncio
import json
import os
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from . import store
from .evaluator import summarize
from .models import AuditRequest, OptimizationRequest
from .optimizer import optimize
from .providers import ProviderAccessError, key_for, provider_status, run_query
from .scraper import allowed_hosts

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.init()
    app.state.tasks = set()
    app.state.query_limit = asyncio.Semaphore(4)
    app.state.optimizing = False
    async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
        app.state.client = client
        yield
        for task in app.state.tasks:
            task.cancel()
        await asyncio.gather(*app.state.tasks, return_exceptions=True)


app = FastAPI(title="AIResultsAssistant", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("GEO_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Last-Event-ID"])


@app.get("/api/v1/health")
async def health():
    return {"status": "ok", "providers": provider_status(), "fetch_hosts": allowed_hosts(), "deployment": "single-user"}


@app.get("/api/v1/audits")
async def history():
    return store.history()


async def run_audit(audit_id, request):
    client, limit = app.state.client, app.state.query_limit
    first = {provider: asyncio.create_task(run_query(client, limit, request, 0, provider)) for provider in request.providers}
    children = [*first.values(), *(asyncio.create_task(run_query(client, limit, request, index, provider,
                                                               first[provider] if request.mode == "live" else None))
                                  for index in range(1, len(request.prompts)) for provider in request.providers)]
    try:
        results = []
        for completed in asyncio.as_completed(children):
            result = await completed
            results.append(result)
            store.append(audit_id, "result", result.model_dump())
        store.finish(audit_id, summarize(request, results))
    except asyncio.CancelledError:
        store.fail(audit_id, "Server stopped. Start a new audit.")
        raise
    except Exception:
        store.fail(audit_id, "Audit could not finish. Inspect server configuration and retry.")
    finally:
        for child in children:
            if not child.done():
                child.cancel()
        await asyncio.gather(*children, return_exceptions=True)


@app.post("/api/v1/audits", status_code=202)
async def create_audit(request: AuditRequest):
    if len(app.state.tasks) >= 3:
        raise HTTPException(429, "Three audits are already running. Wait for one to finish.")
    if request.mode == "live":
        missing = [str(p) for p in request.providers if not key_for(p)]
        if missing:
            raise HTTPException(503, "Configure API keys before a live audit: " + ", ".join(missing))
    audit_id = store.create(request.model_dump())
    task = asyncio.create_task(run_audit(audit_id, request))
    app.state.tasks.add(task)
    task.add_done_callback(app.state.tasks.discard)
    return {"audit_id": audit_id, "total_queries": len(request.prompts) * len(request.providers), "mode": request.mode}


@app.get("/api/v1/audits/{audit_id}")
async def get_audit(audit_id: str):
    audit = store.get(audit_id)
    if audit is None:
        raise HTTPException(404, "Audit not found")
    return audit


@app.get("/api/v1/audits/{audit_id}/stream")
async def stream(audit_id: str, request: Request, after: int = 0):
    if store.get(audit_id) is None:
        raise HTTPException(404, "Audit not found")
    try:
        cursor = max(0, int(request.headers.get("last-event-id", after)))
    except ValueError:
        raise HTTPException(400, "Invalid event cursor")

    async def events():
        nonlocal cursor
        heartbeats = 0
        while not await request.is_disconnected():
            for event in store.events(audit_id, cursor):
                cursor = event["seq"]
                yield f"id: {cursor}\nevent: {event['kind']}\ndata: {event['data']}\n\n"
                if event["kind"] in ("complete", "failed"):
                    return
            audit = store.get(audit_id)
            if audit["status"] != "running":
                # Reconnecting after the terminal event must still close the client cleanly.
                kind = "complete" if audit["status"] == "complete" else "failed"
                payload = audit["summary"] or {"error": "Audit interrupted. Start a new audit."}
                yield f"event: {kind}\ndata: {json.dumps(payload)}\n\n"
                return
            heartbeats += 1
            if heartbeats % 20 == 0:
                yield ": heartbeat\n\n"
            await asyncio.sleep(0.25)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/v1/optimize")
async def optimize_page(request: OptimizationRequest):
    if app.state.optimizing:
        raise HTTPException(429, "An optimization is already running. Please wait.")
    app.state.optimizing = True
    try:
        return await optimize(request)
    except ProviderAccessError as exc:
        raise HTTPException(502, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc) if type(exc) is ValueError else "Provider returned an invalid rewrite. Retry or use source-only export.")
    except (httpx.HTTPError, OSError, TimeoutError, KeyError, IndexError, TypeError):
        raise HTTPException(502, "Could not fetch the page or generate the rewrite. Check destination access, provider keys, and model availability.")
    finally:
        app.state.optimizing = False
