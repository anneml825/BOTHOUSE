#!/usr/bin/env python3
"""Stage 2 — smoke test (§11, §19 pilot plan).

Runs bug_diagnosis_001 across all three conditions, clean + injected (6
runs), against a real cheap model instead of the deterministic mock. Tests
adapter wiring, real schema adherence, retry/repair behavior, and real
token/cost accounting. Labeled `smoke_test` — still not evidence about the
research hypothesis (one task, one seed; see README "Staging").

Usage: python scripts/run_smoke_test.py
Requires OPENAI_API_KEY or ANTHROPIC_API_KEY in the environment (.env) and
config/models.yaml's active_adapter pointed at the matching *_smoke entry.
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
from app.experiments.task_loader import load_task  # noqa: E402


def main() -> None:
    config = load_config()
    adapter_cfg = config.active_adapter_config()
    if adapter_cfg["provider"] == "mock":
        print("config/models.yaml active_adapter is still 'mock' — set it to an openai_*/anthropic_* "
              "entry before running the smoke test.")
        sys.exit(1)
    print(f"Using adapter: {adapter_cfg['name']} ({adapter_cfg['provider']}/{adapter_cfg['model_name']})")

    results_dir = ROOT / "results"
    results_dir.mkdir(exist_ok=True)
    db_path = results_dir / "smoke_test.sqlite3"
    if db_path.exists():
        db_path.unlink()
    conn = init_db(str(db_path))

    task = load_task("bug_diagnosis_001")
    budget_cap = config.budgets["max_run_cost_usd"]

    runs_by_condition: dict[str, list[str]] = {"A": [], "B": [], "C": []}
    matched_pairs: dict[str, list[tuple[str, str]]] = {"A": [], "B": [], "C": []}
    reports = {}
    total_cost = 0.0

    for condition in ("A", "B", "C"):
        clean_id = f"smoke-{condition}-clean"
        r_clean = run_task(conn, config, task, condition, clean_id, seed=1, injection_enabled=False, stage="smoke_test")
        runs_by_condition[condition].append(clean_id)
        reports[(condition, "clean")] = r_clean
        total_cost += r_clean.cost_breakdown["total_cost"]
        print(f"  {clean_id}: status={r_clean.status} score={r_clean.evaluation.get('task_score')} "
              f"turns={r_clean.turns_executed} tokens={r_clean.total_tokens} "
              f"cost=${r_clean.cost_breakdown['total_cost']:.4f} validation_failures={r_clean.validation_failures}")

        injected_id = f"smoke-{condition}-injected"
        r_inj = run_task(conn, config, task, condition, injected_id, seed=1, injection_enabled=True,
                          matched_clean_run_id=clean_id, stage="smoke_test")
        runs_by_condition[condition].append(injected_id)
        matched_pairs[condition].append((clean_id, injected_id))
        reports[(condition, "injected")] = r_inj
        total_cost += r_inj.cost_breakdown["total_cost"]
        cm = r_inj.correction_metrics
        print(f"  {injected_id}: status={r_inj.status} score={r_inj.evaluation.get('task_score')} "
              f"turns={r_inj.turns_executed} tokens={r_inj.total_tokens} "
              f"cost=${r_inj.cost_breakdown['total_cost']:.4f} validation_failures={r_inj.validation_failures} "
              f"turns_to_correction={cm.get('turns_to_correction')} exposed={cm.get('exposed')}")

    print(f"\nTotal cost across all 6 runs: ${total_cost:.4f} (per-run cap: ${budget_cap})")

    report_obj = build_comparison_report(
        conn, runs_by_condition, stage="smoke_test", label="stage2_smoke_test", matched_pairs=matched_pairs,
    )
    out_path = results_dir / "smoke_test_report.json"
    out_path.write_text(json.dumps(report_obj.to_dict(), indent=2, default=str))
    print(f"Wrote {out_path}")
    conn.close()


if __name__ == "__main__":
    main()
