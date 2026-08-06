#!/usr/bin/env python3
"""Stage 3 pilot (§19 pilot plan): 10 tasks x 3 conditions x 1 seed = 30
clean runs, then 5 selected tasks x 3 conditions = 15 matched injected runs
(45 total). Writes a comparison report labeled with the active adapter's
stage — still `plumbing_only` in mock mode; only meaningful as an
`experimental_pilot` run once pointed at a real capability-relevant model
(see README "Staging").

Usage: python scripts/run_pilot.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from app.db.init import init_db  # noqa: E402
from app.evaluation.analysis import build_comparison_report  # noqa: E402
from app.experiments.config import load_config  # noqa: E402
from app.experiments.orchestrator import run_task  # noqa: E402
from app.experiments.task_loader import TASKS_DIR, load_task  # noqa: E402
from app.runtime.replay import verify_replay_matches_live_state  # noqa: E402

CONDITIONS = ("A", "B", "C")
SEED = 1
# Fixed, explicit subset (not "first N alphabetically") so the injected
# pairing is reproducible and reviewable rather than an accident of
# directory listing order.
INJECTED_SUBSET = [
    "bug_diagnosis_001", "bug_diagnosis_002",
    "evidence_synthesis_001", "evidence_synthesis_002",
    "constraint_planning_001",
]


def discover_task_ids() -> list[str]:
    task_ids = []
    for family_dir in sorted(TASKS_DIR.iterdir()):
        if not family_dir.is_dir():
            continue
        for task_dir in sorted(family_dir.iterdir()):
            if (task_dir / "task.json").exists():
                task_ids.append(task_dir.name)
    return task_ids


def main() -> None:
    config = load_config()
    stage = config.experiment.get("stage", "plumbing_only")
    adapter_cfg = config.active_adapter_config()
    print(f"Stage: {stage} | adapter: {adapter_cfg['name']} ({adapter_cfg['provider']}/{adapter_cfg['model_name']})")

    task_ids = discover_task_ids()
    print(f"Discovered {len(task_ids)} tasks: {task_ids}")
    if len(task_ids) < 10:
        print(f"WARNING: pilot plan calls for 10 tasks; only {len(task_ids)} found. Continuing with what exists.")

    results_dir = ROOT / "results"
    results_dir.mkdir(exist_ok=True)
    db_path = results_dir / "pilot.sqlite3"
    if db_path.exists():
        db_path.unlink()
    conn = init_db(str(db_path))

    runs_by_condition: dict[str, list[str]] = {c: [] for c in CONDITIONS}
    matched_pairs: dict[str, list[tuple[str, str]]] = {c: [] for c in CONDITIONS}
    clean_run_ids: dict[tuple[str, str], str] = {}  # (task_id, condition) -> run_id

    max_experiment_cost = config.budgets["max_experiment_cost_usd"]
    running_cost = 0.0
    budget_exhausted = False

    def _over_budget() -> bool:
        nonlocal budget_exhausted
        if running_cost >= max_experiment_cost:
            if not budget_exhausted:
                print(f"\n!! EXPERIMENT COST CAP REACHED (${running_cost:.4f} >= ${max_experiment_cost}) — stopping further runs.")
            budget_exhausted = True
            return True
        return False

    print("\n--- Clean runs (30 target: 10 tasks x 3 conditions x seed 1) ---")
    for task_id in task_ids:
        if _over_budget():
            break
        task = load_task(task_id)
        for condition in CONDITIONS:
            if _over_budget():
                break
            run_id = f"pilot-{task_id}-{condition}-clean"
            report = run_task(conn, config, task, condition, run_id, seed=SEED, injection_enabled=False, stage=stage)
            clean_run_ids[(task_id, condition)] = run_id
            runs_by_condition[condition].append(run_id)
            running_cost += report.cost_breakdown["total_cost"]
            print(f"  {run_id}: status={report.status} score={report.evaluation.get('task_score')} "
                  f"cost=${report.cost_breakdown['total_cost']:.4f} (running total ${running_cost:.4f})")

    print(f"\n--- Injected runs ({len(INJECTED_SUBSET)} tasks x 3 conditions = {len(INJECTED_SUBSET) * 3} target) ---")
    for task_id in INJECTED_SUBSET:
        if _over_budget():
            break
        if task_id not in task_ids:
            print(f"  skipping {task_id}: not found among discovered tasks")
            continue
        task = load_task(task_id)
        for condition in CONDITIONS:
            if _over_budget():
                break
            clean_id = clean_run_ids.get((task_id, condition))
            if clean_id is None:
                print(f"  skipping {task_id}/{condition}: no matched clean run (budget stopped before it ran)")
                continue
            run_id = f"pilot-{task_id}-{condition}-injected"
            report = run_task(
                conn, config, task, condition, run_id, seed=SEED, injection_enabled=True,
                matched_clean_run_id=clean_id, stage=stage,
            )
            runs_by_condition[condition].append(run_id)
            matched_pairs[condition].append((clean_id, run_id))
            running_cost += report.cost_breakdown["total_cost"]
            cm = report.correction_metrics
            print(f"  {run_id}: status={report.status} score={report.evaluation.get('task_score')} "
                  f"turns_to_correction={cm.get('turns_to_correction')} exposed={cm.get('exposed')} "
                  f"cost=${report.cost_breakdown['total_cost']:.4f} (running total ${running_cost:.4f})")

    total_runs = sum(len(v) for v in runs_by_condition.values())
    print(f"\nTotal runs: {total_runs} | Total cost: ${running_cost:.4f} (cap: ${max_experiment_cost})")
    if budget_exhausted:
        print("NOTE: experiment cost cap was reached before all planned runs completed — report below covers only what ran.")

    print("\n--- Replay determinism check (Condition C) ---")
    all_ok = True
    for run_id in runs_by_condition["C"]:
        ok, mismatches = verify_replay_matches_live_state(conn, run_id)
        if not ok:
            all_ok = False
            print(f"  {run_id}: MISMATCH {mismatches}")
    print(f"  {'All Condition C runs replay-consistent.' if all_ok else 'Some runs had replay mismatches — see above.'}")

    print("\n--- Writing comparison report ---")
    report_obj = build_comparison_report(
        conn, runs_by_condition, stage=stage, label="stage3_pilot", matched_pairs=matched_pairs,
    )
    out_path = results_dir / "pilot_comparison_report.json"
    out_path.write_text(json.dumps(report_obj.to_dict(), indent=2, default=str))
    print(f"Wrote {out_path}")
    if stage != "experimental_pilot":
        print(
            f"\nNOTE: stage={stage!r} — this report is NOT evidence about the research hypothesis "
            "(see README 'Staging'). Point config/models.yaml's active_adapter at a capability-relevant "
            "model and set config/experiment.yaml's stage to 'experimental_pilot' for a run that counts."
        )

    conn.close()


if __name__ == "__main__":
    main()
