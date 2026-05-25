from __future__ import annotations
import sqlite3
from pathlib import Path


def initialize_sqlite(db_file: Path) -> None:
    db_file.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_file)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("CREATE TABLE IF NOT EXISTS app_health (id INTEGER PRIMARY KEY, checked_at TEXT NOT NULL)")
    conn.commit()
    conn.close()


def check_integrity(db_file: Path) -> tuple[bool, str]:
    try:
        conn = sqlite3.connect(db_file)
        result = conn.execute("PRAGMA integrity_check").fetchone()
        conn.close()
        status = (result[0] if result else "unknown")
        return status == "ok", status
    except sqlite3.Error as exc:
        return False, str(exc)
