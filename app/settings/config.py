from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import os


@dataclass(frozen=True)
class AppPaths:
    root: Path
    storage: Path
    data: Path
    backups: Path
    exports: Path
    logs: Path
    temp: Path
    db_file: Path


def build_paths(base: Path | None = None) -> AppPaths:
    root = (base or Path(__file__).resolve().parents[2]).resolve()
    storage = root / "storage"
    return AppPaths(
        root=root,
        storage=storage,
        data=storage / "data",
        backups=storage / "backups",
        exports=storage / "exports",
        logs=storage / "logs",
        temp=storage / "temp",
        db_file=storage / "data" / os.getenv("APP_SQLITE_FILE", "app.db"),
    )
