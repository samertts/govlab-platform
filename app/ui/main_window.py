from __future__ import annotations
from PySide6.QtWidgets import QApplication, QLabel, QMainWindow


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("GovLab Platform Desktop")
        self.setMinimumSize(960, 640)
        label = QLabel(
            "GovLab Desktop bootstrap is ready.\n"
            "Existing TypeScript services and workflows remain unchanged.\n"
            "Use production build artifacts for full runtime integration.",
            self,
        )
        label.setWordWrap(True)
        self.setCentralWidget(label)


def launch_ui() -> int:
    app = QApplication.instance() or QApplication([])
    app.setLayoutDirection(app.layoutDirection())
    window = MainWindow()
    window.show()
    return app.exec()
