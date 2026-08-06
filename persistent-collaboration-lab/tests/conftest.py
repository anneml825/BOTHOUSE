from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app.db.init import apply_migrations
from app.experiments.config import load_config
from app.experiments.task_loader import load_task


@pytest.fixture()
def conn() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    apply_migrations(c)
    yield c
    c.close()


@pytest.fixture()
def config():
    return load_config()


@pytest.fixture()
def bug_task() -> dict:
    return load_task("bug_diagnosis_001")
