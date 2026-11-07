"""Small SQLite event log. Background jobs use one Uvicorn worker; events survive reloads."""
import json
import os
import sqlite3
import time
import uuid
from contextlib import closing, contextmanager

from .evaluator import host_of


@contextmanager
def connection():
    path = os.getenv("GEO_DB_PATH", ".data/audits.sqlite3")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with closing(sqlite3.connect(path, timeout=10)) as db, db:
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
        score = summary.get("observed_visibility")
        if score and score["comparison_key"] and score["categories"]["discovery"]["percentage"] is not None:
            previous = db.execute("""
                SELECT created, json_extract(summary, '$.observed_visibility.categories.discovery') AS discovery
                FROM audits WHERE status = 'complete'
                  AND created < (SELECT created FROM audits WHERE id = ?)
                  AND json_extract(summary, '$.observed_visibility.comparison_key') = ?
                  AND json_extract(summary, '$.observed_visibility.categories.discovery.percentage') IS NOT NULL
                ORDER BY created DESC LIMIT 1
            """, (audit_id, score["comparison_key"])).fetchone()
            if previous:
                discovery = json.loads(previous["discovery"])
                score["previous"] = {"created": previous["created"], "percentage": discovery["percentage"],
                                     "valid_answers": discovery["valid_answers"], "planned_answers": discovery["planned_answers"],
                                     "change_pp": round(score["categories"]["discovery"]["percentage"] - discovery["percentage"], 1)}
        db.execute("UPDATE audits SET status = 'complete', summary = ? WHERE id = ?", (json.dumps(summary), audit_id))
        _append(db, audit_id, "complete", summary)


def fail(audit_id: str, error: str):
    with connection() as db:
        db.execute("UPDATE audits SET status = 'failed' WHERE id = ?", (audit_id,))
        _append(db, audit_id, "failed", {"error": error})


def _read_audit(db, row):
    results = db.execute("SELECT data FROM events WHERE audit_id = ? AND kind = 'result' ORDER BY seq", (row["id"],)).fetchall()
    return {"id": row["id"], "created": row["created"], "request": json.loads(row["request"]),
            "status": row["status"], "summary": json.loads(row["summary"]) if row["summary"] else None,
            "results": [json.loads(r["data"]) for r in results]}


def get(audit_id: str):
    with connection() as db:
        row = db.execute("SELECT * FROM audits WHERE id = ?", (audit_id,)).fetchone()
        return _read_audit(db, row) if row else None


def earlier_audits(audit):
    target = host_of(audit["request"]["target_url"])
    with connection() as db:
        db.execute("BEGIN")
        rows = db.execute("""
            SELECT * FROM audits WHERE status = 'complete' AND created < ?
              AND json_extract(request, '$.mode') = ? ORDER BY created DESC
        """, (audit["created"], audit["request"]["mode"]))
        return [_read_audit(db, row) for row in rows
                if host_of(json.loads(row["request"])["target_url"]) == target]


def delete_history():
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM audits WHERE status = 'running' LIMIT 1").fetchone():
            return None
        db.execute("DELETE FROM events")
        return db.execute("DELETE FROM audits").rowcount


def events(audit_id: str, after: int):
    with connection() as db:
        rows = db.execute("SELECT seq, kind, data FROM events WHERE audit_id = ? AND seq > ? ORDER BY seq", (audit_id, after)).fetchall()
        return [dict(row) for row in rows]


def history():
    with connection() as db:
        rows = db.execute("SELECT id, created, request, status FROM audits ORDER BY created DESC LIMIT 20").fetchall()
        return [{"id": row["id"], "created": row["created"], "brand": json.loads(row["request"])["brand"],
                 "mode": json.loads(row["request"])["mode"], "status": row["status"]} for row in rows]
