from __future__ import annotations
from datetime import datetime, UTC
from pathlib import Path
import json


def write_diagnostics(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    envelope = {"generated_at": datetime.now(UTC).isoformat(), "payload": payload}
    path.write_text(json.dumps(envelope, indent=2), encoding="utf-8")
