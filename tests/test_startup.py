from app.settings.config import build_paths
from app.recovery.recovery_manager import ensure_storage
from app.database.sqlite_manager import initialize_sqlite, check_integrity


def test_storage_and_sqlite_bootstrap(tmp_path):
    paths = build_paths(tmp_path)
    ensure_storage(paths)
    initialize_sqlite(paths.db_file)
    ok, detail = check_integrity(paths.db_file)
    assert ok, detail
