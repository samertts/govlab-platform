from __future__ import annotations
import importlib.util
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ValidationResult:
    ok: bool
    messages: list[str]


def validate_entrypoint(root: Path) -> ValidationResult:
    messages = []
    ok = True
    if not (root / "server" / "index.ts").exists():
        ok = False
        messages.append("Missing existing server entrypoint: server/index.ts")
    if not (root / "package.json").exists():
        ok = False
        messages.append("Missing package.json")
    if importlib.util.find_spec("PySide6") is None:
        messages.append("PySide6 not installed; desktop UI disabled until dependency is installed")
    return ValidationResult(ok=ok, messages=messages)
