"""Locks in the full Stage 3 task suite (§19 pilot plan): every task under
tasks/ must run cleanly across all three conditions in mock mode, so a
future task addition/edit that silently breaks a scenario is caught here
rather than only discovered mid-pilot with a real (paid) adapter."""

from __future__ import annotations

import itertools

import pytest

from app.experiments.orchestrator import run_task
from app.experiments.task_loader import TASKS_DIR, load_task


def _discover_task_ids() -> list[str]:
    ids = []
    for family_dir in sorted(TASKS_DIR.iterdir()):
        if not family_dir.is_dir():
            continue
        for task_dir in sorted(family_dir.iterdir()):
            if (task_dir / "task.json").exists():
                ids.append(task_dir.name)
    return ids


ALL_TASK_IDS = _discover_task_ids()


def test_suite_has_at_least_ten_tasks_across_three_families():
    assert len(ALL_TASK_IDS) >= 10
    families = {load_task(t)["family"] for t in ALL_TASK_IDS}
    assert families == {"bug_diagnosis", "evidence_synthesis", "constraint_planning"}


@pytest.mark.parametrize("task_id,condition", list(itertools.product(ALL_TASK_IDS, ("A", "B", "C"))))
def test_every_task_clean_run_completes_and_scores_full(conn, config, task_id, condition):
    task = load_task(task_id)
    report = run_task(conn, config, task, condition, f"suite-{task_id}-{condition}-clean", seed=1, injection_enabled=False)
    assert report.status == "completed", f"{task_id}/{condition} clean run did not complete: {report.status}"
    assert report.evaluation["task_score"] == 1.0, f"{task_id}/{condition} clean run scored {report.evaluation}"


@pytest.mark.parametrize("task_id,condition", list(itertools.product(ALL_TASK_IDS, ("A", "B", "C"))))
def test_every_task_injected_run_completes_scores_full_and_corrects(conn, config, task_id, condition):
    task = load_task(task_id)
    report = run_task(conn, config, task, condition, f"suite-{task_id}-{condition}-injected", seed=1, injection_enabled=True)
    assert report.status == "completed", f"{task_id}/{condition} injected run did not complete: {report.status}"
    assert report.evaluation["task_score"] == 1.0, f"{task_id}/{condition} injected run scored {report.evaluation}"
    cm = report.correction_metrics
    assert cm.get("exposed") is True, f"{task_id}/{condition} injected run never cited the injected evidence"
    assert cm.get("correction_success_rate") == 1.0, f"{task_id}/{condition} injected run never corrected: {cm}"
