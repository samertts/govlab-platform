# GovLab Platform - Desktop Productionization Layer

This repository keeps the existing TypeScript/React/Express architecture intact and adds a **non-destructive Windows desktop production layer**.

## What was added
- Python desktop bootstrap entrypoint: `main.py`
- Resilience modules under `app/` (logging, recovery, validation, compatibility, diagnostics, SQLite bootstrap)
- Storage structure under `storage/`
- PyInstaller-compatible dependency manifest: `requirements.txt`
- Inno Setup installer script: `installer/setup.iss`
- GitHub Actions build workflow: `.github/workflows/build.yml`
- Basic smoke test: `tests/test_startup.py`

## Build locally (Windows)
1. `py -3.11 -m venv .venv`
2. `.venv\Scripts\activate`
3. `pip install -r requirements.txt`
4. `pyinstaller --noconfirm --clean --onefile --windowed --name Application main.py`
5. `iscc installer/setup.iss`

Artifacts:
- `dist/Application.exe`
- `installer/Output/ApplicationSetup.exe`

## Compatibility promise
The existing backend/frontend modules are not replaced. The new layer validates their presence and records diagnostics in `storage/logs/startup_diagnostics.json`.
