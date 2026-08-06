"""Batch execution across tasks, conditions, and seeds (§12).

A thin loop over `app.experiments.orchestrator.run_task` — everything about
fairness (identical config, budgets, roles) is already enforced inside
`run_task` itself; this module just sequences many calls and, when
`inject` is set, pairs each injected run with a matching clean run on the
same task/seed/condition (§7's matched-pair requirement).
"""

from __future__ import annotations

import itertools
import sqlite3
from dataclasses import dataclass

from app.experiments.config import LabConfig
from app.experiments.orchestrator import RunReport, run_task


@dataclass
class BatchSpec:
    task_ids: list[str]
    conditions: list[str]
    seeds: list[int]
    inject: bool = False  # if True, run BOTH a clean and injected run per (task, condition, seed)


def run_batch(
    conn: sqlite3.Connection, config: LabConfig, tasks_by_id: dict[str, dict], spec: BatchSpec,
    stage: str = "plumbing_only", run_id_prefix: str = "batch",
) -> dict[str, RunReport]:
    reports: dict[str, RunReport] = {}
    for task_id, condition, seed in itertools.product(spec.task_ids, spec.conditions, spec.seeds):
        task_definition = tasks_by_id[task_id]
        clean_id = f"{run_id_prefix}-{task_id}-{condition}-{seed}-clean"
        reports[clean_id] = run_task(
            conn, config, task_definition, condition, clean_id, seed=seed,
            injection_enabled=False, stage=stage,
        )
        if spec.inject:
            injected_id = f"{run_id_prefix}-{task_id}-{condition}-{seed}-injected"
            reports[injected_id] = run_task(
                conn, config, task_definition, condition, injected_id, seed=seed,
                injection_enabled=True, matched_clean_run_id=clean_id, stage=stage,
            )
    return reports
