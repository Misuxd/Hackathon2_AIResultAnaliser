"""Small SQLite event log. Background jobs use one Uvicorn worker; events survive reloads."""
import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager


@contextmanager
def connection():
    path = os.getenv("GEO_DB_PATH", ".data/audits.sqlite3")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with sqlite3.connect(path, timeout=10) as db:
        db.row_factory = sqlite3.Row
        yield db


def init():
    with connection() as db:
        db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS audits (
                id TEXT PRIMARY KEY, created REAL NOT NULL, request TEXT NOT NULL,
                status TEXT NOT NULL, summary TEXT
            );
            CREATE TABLE IF NOT EXISTS events (
                audit_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL,
                data TEXT NOT NULL, PRIMARY KEY(audit_id, seq)
            );
        """)
        interrupted = db.execute("SELECT id FROM audits WHERE status = 'running'").fetchall()
        for row in interrupted:
            _append(db, row["id"], "failed", {"error": "Server restarted. Start a new audit."})
        db.execute("UPDATE audits SET status = 'failed' WHERE status = 'running'")


def create(request: dict) -> str:
    audit_id = str(uuid.uuid4())
    with connection() as db:
        db.execute("INSERT INTO audits VALUES (?, ?, ?, 'running', NULL)",
                   (audit_id, time.time(), json.dumps(request)))
    return audit_id


def _append(db, audit_id, kind, data):
    seq = db.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE audit_id = ?", (audit_id,)).fetchone()[0]
    db.execute("INSERT INTO events VALUES (?, ?, ?, ?)", (audit_id, seq, kind, json.dumps(data)))


def append(audit_id: str, kind: str, data: dict):
    with connection() as db:
        _append(db, audit_id, kind, data)


def finish(audit_id: str, summary: dict):
    with connection() as db:
        db.execute("UPDATE audits SET status = 'complete', summary = ? WHERE id = ?", (json.dumps(summary), audit_id))
        _append(db, audit_id, "complete", summary)


def fail(audit_id: str, error: str):
    with connection() as db:
        db.execute("UPDATE audits SET status = 'failed' WHERE id = ?", (audit_id,))
        _append(db, audit_id, "failed", {"error": error})


def get(audit_id: str):
    with connection() as db:
        row = db.execute("SELECT * FROM audits WHERE id = ?", (audit_id,)).fetchone()
        if row is None:
            return None
        results = db.execute("SELECT data FROM events WHERE audit_id = ? AND kind = 'result' ORDER BY seq", (audit_id,)).fetchall()
        return {"id": row["id"], "created": row["created"], "request": json.loads(row["request"]),
                "status": row["status"], "summary": json.loads(row["summary"]) if row["summary"] else None,
                "results": [json.loads(r["data"]) for r in results]}


def events(audit_id: str, after: int):
    with connection() as db:
        rows = db.execute("SELECT seq, kind, data FROM events WHERE audit_id = ? AND seq > ? ORDER BY seq", (audit_id, after)).fetchall()
        return [dict(row) for row in rows]


def history():
    with connection() as db:
        rows = db.execute("SELECT id, created, request, status FROM audits ORDER BY created DESC LIMIT 20").fetchall()
        return [{"id": row["id"], "created": row["created"], "brand": json.loads(row["request"])["brand"],
                 "mode": json.loads(row["request"])["mode"], "status": row["status"]} for row in rows]
