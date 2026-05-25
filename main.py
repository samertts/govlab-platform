from __future__ import annotations
import logging
import sys
import traceback
from app.settings.config import build_paths
from app.logging.logger import configure_logging
from app.recovery.recovery_manager import ensure_storage
from app.database.sqlite_manager import initialize_sqlite, check_integrity
from app.validation.startup_validator import validate_entrypoint
from app.compatibility.validator import detect_existing_stack
from app.services.diagnostics import write_diagnostics


def _install_excepthook() -> None:
    def _hook(exc_type, exc_value, exc_tb):
        logging.getLogger("crash").critical("Unhandled exception", exc_info=(exc_type, exc_value, exc_tb))
        traceback.print_exception(exc_type, exc_value, exc_tb)
    sys.excepthook = _hook


def main() -> int:
    paths = build_paths()
    configure_logging(paths.logs)
    _install_excepthook()
    ensure_storage(paths)
    initialize_sqlite(paths.db_file)
    valid = validate_entrypoint(paths.root)
    ok, detail = check_integrity(paths.db_file)
    diagnostics = {
        "startup_ok": valid.ok,
        "startup_messages": valid.messages,
        "sqlite_integrity_ok": ok,
        "sqlite_integrity": detail,
        "compatibility": detect_existing_stack(paths.root),
    }
    write_diagnostics(paths.logs / "startup_diagnostics.json", diagnostics)
    if not valid.ok:
        logging.getLogger(__name__).error("Startup validation failed: %s", valid.messages)
        return 1
    try:
        from app.ui.main_window import launch_ui
        return launch_ui()
    except Exception:
        logging.getLogger(__name__).exception("Desktop UI launch failed")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
