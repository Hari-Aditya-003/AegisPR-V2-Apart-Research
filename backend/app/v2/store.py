"""SQLite V2 migration and transactional run, feedback, and delivery storage."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


class DuplicateDelivery(ValueError):
    """The same webhook has already been atomically admitted."""


class ReviewStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS v2_reviews(id TEXT PRIMARY KEY, payload TEXT NOT NULL, created TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS v2_feedback(run_id TEXT NOT NULL, finding_id TEXT NOT NULL,
                    state TEXT NOT NULL, PRIMARY KEY(run_id,finding_id));
                CREATE TABLE IF NOT EXISTS v2_deliveries(id TEXT PRIMARY KEY, digest TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS v2_benchmarks(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
                PRAGMA user_version=1;
            ''')

    def connect(self):
        return sqlite3.connect(self.path, timeout=10)

    def save(self, run: dict):
        with self.connect() as db:
            db.execute('INSERT INTO v2_reviews VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
                       (run['id'], json.dumps(run, allow_nan=False), run['created_at']))

    def admit(self, run: dict, *, daily_limit: int = 30, delivery: tuple[str, str] | None = None):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if delivery:
                previous = db.execute('SELECT digest FROM v2_deliveries WHERE id=?', (delivery[0],)).fetchone()
                if previous:
                    if previous[0] != delivery[1]:
                        raise ValueError('Delivery replay has a different payload')
                    raise DuplicateDelivery('Webhook delivery was already admitted')
            rows = db.execute('SELECT payload FROM v2_reviews WHERE created >= ?',
                              (datetime.now(timezone.utc).date().isoformat(),)).fetchall()
            runs = [json.loads(row[0]) for row in rows]
            if len(runs) >= daily_limit:
                raise ValueError('Daily review limit reached')
            recent = [r for r in runs if r['status'] in {'QUEUED', 'RUNNING'} and
                      (datetime.now(timezone.utc) - datetime.fromisoformat(r['created_at'])).total_seconds() < 600]
            if len(recent) >= 2:
                raise ValueError('Two reviews are already active; retry after one completes')
            db.execute('INSERT INTO v2_reviews VALUES(?,?,?)', (run['id'], json.dumps(run), run['created_at']))
            if delivery:
                db.execute('INSERT INTO v2_deliveries VALUES(?,?)', delivery)

    def get(self, run_id: str) -> dict | None:
        with self.connect() as db:
            row = db.execute('SELECT payload FROM v2_reviews WHERE id=?', (run_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self, limit=30):
        with self.connect() as db:
            rows = db.execute('SELECT payload FROM v2_reviews ORDER BY created DESC LIMIT ?', (min(100, max(1, limit)),)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def claim_delivery(self, delivery: str, digest: str) -> bool:
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT digest FROM v2_deliveries WHERE id=?', (delivery,)).fetchone()
            if row:
                if row[0] != digest:
                    raise ValueError('Delivery replay has a different payload')
                return False
            db.execute('INSERT INTO v2_deliveries VALUES(?,?)', (delivery, digest))
        return True

    def feedback(self, run_id: str, finding_id: str, state: str):
        with self.connect() as db:
            db.execute('INSERT INTO v2_feedback VALUES(?,?,?) ON CONFLICT(run_id,finding_id) DO UPDATE SET state=excluded.state',
                       (run_id, finding_id, state))

    def get_feedback(self, run_id: str):
        with self.connect() as db:
            return dict(db.execute('SELECT finding_id,state FROM v2_feedback WHERE run_id=?', (run_id,)))

    def save_benchmark(self, report: dict):
        with self.connect() as db:
            db.execute('INSERT INTO v2_benchmarks VALUES(?,?)', (report['id'], json.dumps(report, allow_nan=False)))

    def benchmarks(self):
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute('SELECT payload FROM v2_benchmarks ORDER BY rowid DESC LIMIT 20')]
