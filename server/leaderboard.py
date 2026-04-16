"""SQLite-backed leaderboard for BazaarBot."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .models import LeaderboardEntry, LeaderboardResponse

DB_PATH = Path(__file__).parent.parent / "data" / "leaderboard.db"


def _get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS leaderboard (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_name TEXT NOT NULL,
            task TEXT NOT NULL,
            score REAL NOT NULL,
            episodes_completed INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            metadata TEXT DEFAULT '{}'
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_task_score
        ON leaderboard(task, score DESC)
    """)
    conn.commit()
    return conn


def record_score(
    agent_name: str,
    task: str,
    score: float,
    episodes_completed: int,
    metadata: dict | None = None,
) -> LeaderboardEntry:
    conn = _get_conn()
    ts = datetime.now(timezone.utc).isoformat()
    meta = json.dumps(metadata or {})
    conn.execute(
        "INSERT INTO leaderboard (agent_name, task, score, episodes_completed, timestamp, metadata) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (agent_name, task, score, episodes_completed, ts, meta),
    )
    conn.commit()
    conn.close()
    return LeaderboardEntry(
        agent_name=agent_name,
        task=task,
        score=score,
        episodes_completed=episodes_completed,
        timestamp=ts,
        metadata=metadata or {},
    )


def get_leaderboard(
    task: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> LeaderboardResponse:
    conn = _get_conn()
    if task:
        rows = conn.execute(
            "SELECT agent_name, task, score, episodes_completed, timestamp, metadata "
            "FROM leaderboard WHERE task = ? ORDER BY score DESC LIMIT ? OFFSET ?",
            (task, limit, offset),
        ).fetchall()
        total = conn.execute(
            "SELECT COUNT(*) FROM leaderboard WHERE task = ?", (task,)
        ).fetchone()[0]
    else:
        rows = conn.execute(
            "SELECT agent_name, task, score, episodes_completed, timestamp, metadata "
            "FROM leaderboard ORDER BY score DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        total = conn.execute("SELECT COUNT(*) FROM leaderboard").fetchone()[0]
    conn.close()

    entries = [
        LeaderboardEntry(
            agent_name=r[0],
            task=r[1],
            score=r[2],
            episodes_completed=r[3],
            timestamp=r[4],
            metadata=json.loads(r[5]) if r[5] else {},
        )
        for r in rows
    ]
    return LeaderboardResponse(entries=entries, total=total)


def get_best_scores() -> dict[str, LeaderboardEntry]:
    """Get the best score for each task."""
    conn = _get_conn()
    rows = conn.execute("""
        SELECT agent_name, task, MAX(score) as score, episodes_completed, timestamp, metadata
        FROM leaderboard
        GROUP BY task
        ORDER BY task
    """).fetchall()
    conn.close()

    return {
        r[1]: LeaderboardEntry(
            agent_name=r[0],
            task=r[1],
            score=r[2],
            episodes_completed=r[3],
            timestamp=r[4],
            metadata=json.loads(r[5]) if r[5] else {},
        )
        for r in rows
    }
