"""Small SQLite event log. Background jobs use one Uvicorn worker; events survive reloads."""
import json
import os
import sqlite3
import time
import uuid
from contextlib import closing, contextmanager

from .evaluator import category_key, host_of, question_id


@contextmanager
def connection():
    path = os.getenv("GEO_DB_PATH", ".data/audits.sqlite3")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with closing(sqlite3.connect(path, timeout=10)) as db, db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        yield db


def init():
    with connection() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
            BEGIN IMMEDIATE;
            CREATE TABLE IF NOT EXISTS audits (
                id TEXT PRIMARY KEY, created REAL NOT NULL, request TEXT NOT NULL,
                status TEXT NOT NULL, summary TEXT
            );
            CREATE TABLE IF NOT EXISTS events (
                audit_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL,
                data TEXT NOT NULL, PRIMARY KEY(audit_id, seq)
            );
            CREATE TABLE IF NOT EXISTS audit_questions (
                audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
                prompt_index INTEGER NOT NULL, intent_id TEXT NOT NULL, prompt TEXT NOT NULL,
                site TEXT NOT NULL, product_category TEXT NOT NULL, mode TEXT NOT NULL,
                PRIMARY KEY(audit_id, prompt_index)
            );
            CREATE INDEX IF NOT EXISTS audit_questions_scope
                ON audit_questions(site, product_category, mode, audit_id);
            CREATE TABLE IF NOT EXISTS question_attempts (
                audit_id TEXT NOT NULL, event_seq INTEGER NOT NULL, prompt_index INTEGER NOT NULL,
                provider TEXT NOT NULL, status TEXT NOT NULL,
                PRIMARY KEY(audit_id, event_seq),
                FOREIGN KEY(audit_id, prompt_index) REFERENCES audit_questions(audit_id, prompt_index) ON DELETE CASCADE,
                FOREIGN KEY(audit_id, event_seq) REFERENCES events(audit_id, seq) ON DELETE CASCADE
            );
        """)
        if db.execute("PRAGMA user_version").fetchone()[0] == 0:
            for row in db.execute("SELECT id, request FROM audits"):
                _record_questions(db, row["id"], json.loads(row["request"]))
            for row in db.execute("SELECT audit_id, seq, data FROM events WHERE kind = 'result'"):
                _record_attempt(db, row["audit_id"], row["seq"], json.loads(row["data"]))
            db.execute("PRAGMA user_version = 1")
        interrupted = db.execute("SELECT id FROM audits WHERE status = 'running'").fetchall()
        for row in interrupted:
            _append(db, row["id"], "failed", {"error": "Server restarted. Start a new audit."})
        db.execute("UPDATE audits SET status = 'failed' WHERE status = 'running'")


def create(request: dict) -> str:
    audit_id = str(uuid.uuid4())
    with connection() as db:
        db.execute("INSERT INTO audits VALUES (?, ?, ?, 'running', NULL)",
                   (audit_id, time.time(), json.dumps(request)))
        _record_questions(db, audit_id, request)
    return audit_id


def _record_questions(db, audit_id, request):
    scope = (host_of(request["target_url"]), category_key(request.get("offering", "")), request["mode"])
    db.executemany("INSERT INTO audit_questions VALUES (?, ?, ?, ?, ?, ?, ?)",
                   ((audit_id, i, question_id(prompt), prompt, *scope) for i, prompt in enumerate(request["prompts"])))


def _record_attempt(db, audit_id, seq, data):
    # Early event payloads without question metadata stay readable in the original event log.
    if data.get("provider") and data.get("status"):
        db.execute("""
            INSERT INTO question_attempts
            SELECT audit_id, ?, prompt_index, ?, ? FROM audit_questions WHERE audit_id = ? AND prompt_index = ?
        """, (seq, data["provider"], data["status"], audit_id, data.get("prompt_index")))


def _append(db, audit_id, kind, data):
    seq = db.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE audit_id = ?", (audit_id,)).fetchone()[0]
    db.execute("INSERT INTO events VALUES (?, ?, ?, ?)", (audit_id, seq, kind, json.dumps(data)))
    if kind == "result":
        _record_attempt(db, audit_id, seq, data)


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


def _read_audit(db, row, question_history=False):
    request = json.loads(row["request"])
    indexed = {}
    if question_history:
        questions = db.execute("SELECT intent_id, prompt FROM audit_questions WHERE audit_id = ? ORDER BY prompt_index",
                               (row["id"],)).fetchall()
        request["prompts"] = [q["prompt"] for q in questions]
        indexed["intent_ids"] = [q["intent_id"] for q in questions]
        results = db.execute("""
            SELECT e.data FROM question_attempts AS a JOIN events AS e
              ON e.audit_id = a.audit_id AND e.seq = a.event_seq
            WHERE a.audit_id = ? ORDER BY a.event_seq
        """, (row["id"],)).fetchall()
    else:
        results = db.execute("SELECT data FROM events WHERE audit_id = ? AND kind = 'result' ORDER BY seq", (row["id"],)).fetchall()
    return {"id": row["id"], "created": row["created"], "request": request, **indexed,
            "status": row["status"], "summary": json.loads(row["summary"]) if row["summary"] else None,
            "results": [json.loads(r["data"]) for r in results]}


def get(audit_id: str):
    with connection() as db:
        row = db.execute("SELECT * FROM audits WHERE id = ?", (audit_id,)).fetchone()
        return _read_audit(db, row) if row else None


def category_audits(audit):
    request = audit["request"]
    with connection() as db:
        db.execute("BEGIN")
        rows = db.execute("""
            SELECT a.* FROM audits AS a JOIN (
                SELECT DISTINCT audit_id FROM audit_questions WHERE site = ? AND product_category = ? AND mode = ?
            ) AS q ON q.audit_id = a.id
            WHERE a.status = 'complete' AND (a.created < ? OR a.id = ?)
            ORDER BY (a.id = ?) DESC, a.created DESC
        """, (host_of(request["target_url"]), category_key(request.get("offering", "")), request["mode"],
              audit["created"], audit["id"], audit["id"]))
        return [_read_audit(db, row, question_history=True) for row in rows]


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
