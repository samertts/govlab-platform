from __future__ import annotations
from pathlib import Path


def detect_existing_stack(root: Path) -> dict[str, bool]:
    return {
        "node_backend": (root / "server" / "index.ts").exists(),
        "react_frontend": (root / "client" / "src" / "main.tsx").exists(),
        "drizzle_schema": (root / "shared" / "schema.ts").exists(),
    }
