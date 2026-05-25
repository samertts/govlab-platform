from __future__ import annotations
import logging
from app.settings.config import AppPaths


def ensure_storage(paths: AppPaths) -> list[str]:
    repaired = []
    for p in [paths.storage, paths.data, paths.backups, paths.exports, paths.logs, paths.temp]:
        if not p.exists():
            p.mkdir(parents=True, exist_ok=True)
            repaired.append(str(p))
    if repaired:
        logging.getLogger(__name__).info("Auto-repaired missing paths: %s", repaired)
    return repaired
