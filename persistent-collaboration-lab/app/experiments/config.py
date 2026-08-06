"""Config loading. Nothing about models, budgets, or experiment parameters
is hardcoded in Python — it all comes from these YAML files, loaded fresh
per run and snapshotted into `runs.config_snapshot_json` for reproducibility
(§17)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"


def _load_yaml(name: str, base_dir: Path) -> dict:
    with open(base_dir / name) as f:
        return yaml.safe_load(f)


@dataclass
class LabConfig:
    models: dict[str, Any] = field(default_factory=dict)
    budgets: dict[str, Any] = field(default_factory=dict)
    experiment: dict[str, Any] = field(default_factory=dict)

    def snapshot(self) -> dict:
        return {"models": self.models, "budgets": self.budgets, "experiment": self.experiment}

    def active_adapter_config(self) -> dict:
        name = self.models["active_adapter"]
        return {"name": name, **self.models["adapters"][name]}


def load_config(config_dir: Path | None = None) -> LabConfig:
    base_dir = Path(config_dir) if config_dir is not None else CONFIG_DIR
    return LabConfig(
        models=_load_yaml("models.yaml", base_dir),
        budgets=_load_yaml("budgets.yaml", base_dir),
        experiment=_load_yaml("experiment.yaml", base_dir),
    )
