"""SQLite review store. WAL + transactions: a review, its revision row and its idempotency record are committed
atomically or not at all. Runs left 'running' by a crash are marked as errors on startup (recover)."""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

from .models import Review

SCHEMA = """
CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, created TEXT NOT NULL, mode TEXT NOT NULL,
  question TEXT, endpoint TEXT, parent_id TEXT, saved_example INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revisions(review_id TEXT NOT NULL, revision INTEGER NOT NULL, created TEXT NOT NULL, reason TEXT, body TEXT NOT NULL,
  PRIMARY KEY(review_id, revision));
CREATE TABLE IF NOT EXISTS idempotency(scope TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(scope, key));
CREATE TABLE IF NOT EXISTS runs(run_id TEXT PRIMARY KEY, status TEXT NOT NULL, stage TEXT, error TEXT, review_id TEXT, updated TEXT);
"""


class IdempotencyConflict(Exception):
    pass


class Store:
    def __init__(self, path: str | Path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.executescript(SCHEMA)

    def close(self):
        self.conn.close()

    def _tx(self):
        return _Tx(self)

    # ---- runs
    def create_run(self, run_id: str, status: str = "queued", stage: str | None = None):
        with self.lock:
            self.conn.execute("INSERT INTO runs(run_id,status,stage,updated) VALUES(?,?,?,datetime('now'))", (run_id, status, stage))

    def update_run(self, run_id: str, status: str, stage: str | None = None, error: str | None = None, review_id: str | None = None):
        with self.lock:
            self.conn.execute("UPDATE runs SET status=?, stage=COALESCE(?,stage), error=?, review_id=COALESCE(?,review_id), updated=datetime('now') WHERE run_id=?",
                              (status, stage, error, review_id, run_id))

    def get_run(self, run_id: str) -> dict | None:
        with self.lock:
            r = self.conn.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)).fetchone()
        return dict(r) if r else None

    def recover(self) -> int:
        with self.lock:
            cur = self.conn.execute("UPDATE runs SET status='error', error='interrupted by a server restart before completion; resubmit with the same Idempotency-Key' "
                                    "WHERE status IN ('queued','running')")
            return cur.rowcount

    # ---- reviews
    def save_review(self, r: Review, idem: tuple[str, str, str, dict] | None = None, run: tuple[str, str] | None = None, saved_example: bool = False):
        """Atomic: review + revision 1 + optional idempotency record + optional run completion."""
        body = r.model_dump_json()
        with self.lock, self._tx():
            if idem:
                row = self.conn.execute("SELECT request_hash FROM idempotency WHERE scope=? AND key=?", (idem[0], idem[1])).fetchone()
                if row:
                    raise IdempotencyConflict(idem[1])
            self.conn.execute("INSERT INTO reviews(id,revision,created,mode,question,endpoint,parent_id,saved_example,body) VALUES(?,?,?,?,?,?,?,?,?)",
                              (r.id, r.revision, r.created, r.mode, r.query.question, r.query.endpoint, r.parent_id, int(saved_example), body))
            self.conn.execute("INSERT INTO revisions(review_id,revision,created,reason,body) VALUES(?,?,?,?,?)", (r.id, r.revision, r.created, "created", body))
            if idem:
                self.conn.execute("INSERT INTO idempotency(scope,key,request_hash,response) VALUES(?,?,?,?)", (idem[0], idem[1], idem[2], json.dumps(idem[3])))
            if run:
                self.conn.execute("UPDATE runs SET status='done', stage='complete', error=NULL, review_id=?, updated=datetime('now') WHERE run_id=?", (r.id, run[0]))

    def update_review(self, r: Review, reason: str) -> Review:
        with self.lock, self._tx():
            row = self.conn.execute("SELECT revision FROM reviews WHERE id=?", (r.id,)).fetchone()
            if not row:
                raise KeyError(r.id)
            new = r.model_copy(update={"revision": row["revision"] + 1})
            body = new.model_dump_json()
            self.conn.execute("UPDATE reviews SET revision=?, mode=?, body=? WHERE id=?", (new.revision, new.mode, body, new.id))
            self.conn.execute("INSERT INTO revisions(review_id,revision,created,reason,body) VALUES(?,?,datetime('now'),?,?)", (new.id, new.revision, reason, body))
        return new

    def get_review(self, review_id: str) -> Review | None:
        with self.lock:
            row = self.conn.execute("SELECT body FROM reviews WHERE id=?", (review_id,)).fetchone()
        return Review.model_validate_json(row["body"]) if row else None

    def list_reviews(self) -> list[dict]:
        with self.lock:
            rows = self.conn.execute("SELECT id,revision,created,mode,question,endpoint,parent_id,saved_example FROM reviews ORDER BY saved_example DESC, created DESC, id").fetchall()
        return [dict(r) for r in rows]

    def revisions(self, review_id: str) -> list[dict]:
        with self.lock:
            rows = self.conn.execute("SELECT revision,created,reason FROM revisions WHERE review_id=? ORDER BY revision", (review_id,)).fetchall()
        return [dict(r) for r in rows]

    def revision_body(self, review_id: str, revision: int) -> Review | None:
        with self.lock:
            row = self.conn.execute("SELECT body FROM revisions WHERE review_id=? AND revision=?", (review_id, revision)).fetchone()
        return Review.model_validate_json(row["body"]) if row else None

    # ---- idempotency
    def idem_get(self, scope: str, key: str) -> tuple[str, dict] | None:
        with self.lock:
            row = self.conn.execute("SELECT request_hash,response FROM idempotency WHERE scope=? AND key=?", (scope, key)).fetchone()
        return (row["request_hash"], json.loads(row["response"])) if row else None

    def idem_put(self, scope: str, key: str, request_hash: str, response: dict):
        with self.lock:
            self.conn.execute("INSERT OR IGNORE INTO idempotency(scope,key,request_hash,response) VALUES(?,?,?,?)", (scope, key, request_hash, json.dumps(response)))


class _Tx:
    def __init__(self, s: Store):
        self.s = s

    def __enter__(self):
        self.s.conn.execute("BEGIN IMMEDIATE")

    def __exit__(self, et, ev, tb):
        self.s.conn.execute("ROLLBACK" if et else "COMMIT")
        return False
