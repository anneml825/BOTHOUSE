#!/usr/bin/env python3
"""Milestone 1 required demonstration (§19).

Single command that:
  1. runs the test suite,
  2. runs the bug_diagnosis_001 mock task under all three conditions, both
     clean and false-evidence-injected (6 runs total),
  3. demonstrates dependency propagation directly against the persistent
     store (contested + retracted propagation, re-verification requirement),
  4. prints each condition's detection/challenge/correction behavior,
  5. writes a plumbing_only comparison report to results/,
  6. confirms Condition C's state is deterministically reconstructible from
     its event history via replay.

Usage: python scripts/run_milestone1.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.db.init import init_db  # noqa: E402
from app.evaluation.analysis import build_comparison_report  # noqa: E402
from app.experiments.config import load_config  # noqa: E402
from app.experiments.orchestrator import run_task  # noqa: E402
from app.experiments.task_loader import load_task  # noqa: E402
from app.models.message import Message, MessageType, Sender, Status, Target  # noqa: E402
from app.runtime.replay import verify_replay_matches_live_state  # noqa: E402
from app.runtime.state_manager import StateManager  # noqa: E402
from app.runtime.store import Store  # noqa: E402


def run_tests() -> None:
    print("=" * 70)
    print("STEP 1/6 — running test suite")
    print("=" * 70)
    result = subprocess.run([sys.executable, "-m", "pytest", "-q"], cwd=ROOT)
    if result.returncode != 0:
        print("Test suite FAILED — stopping.")
        sys.exit(result.returncode)
    print("Test suite passed.\n")


def demonstrate_propagation(conn) -> None:
    print("=" * 70)
    print("STEP 3/6 — dependency propagation demonstration (isolated from the")
    print("           scripted narrative, exercising the rules in §6 directly)")
    print("=" * 70)
    store = Store(conn)
    store.create_run(run_id="propagation-demo", task_id="synthetic", condition="C", stage="plumbing_only",
                      model_config={"provider": "mock"}, config_snapshot={})
    sm = StateManager(conn, "propagation-demo", "synthetic")

    def claim(mid, content, status, **kw):
        return Message(message_id=mid, run_id="propagation-demo", task_id="synthetic", sender=Sender.AGENT_A,
                        target=Target.ALL, message_type=MessageType.CLAIM, content=content, rationale="",
                        confidence=0.7, status=status, **kw)

    sm.ingest_message(claim("X", "root claim", Status.HYPOTHESIS))
    sm.ingest_message(claim("Y", "depends on X", Status.CANDIDATE, depends_on=["X"]))
    sm.ingest_message(claim("Z", "depends on Y (transitive on X)", Status.CANDIDATE, depends_on=["Y"]))

    print(f"  Created X, Y(depends_on X), Z(depends_on Y). Statuses: "
          f"X={sm.get_claim('X')['status']} Y={sm.get_claim('Y')['status']} Z={sm.get_claim('Z')['status']}")

    sm.ingest_message(Message(message_id="critic-X", run_id="propagation-demo", task_id="synthetic",
                               sender=Sender.AGENT_B, target=Target.ALL, message_type=MessageType.CRITIQUE,
                               content="disputing X", rationale="", confidence=0.8, status=Status.CONTESTED,
                               contradicts=["X"]))
    print(f"  After contesting X: X={sm.get_claim('X')['status']} "
          f"Y={sm.get_claim('Y')['status']}(warning={bool(sm.get_claim('Y')['dependency_warning'])}) "
          f"Z={sm.get_claim('Z')['status']}(warning={bool(sm.get_claim('Z')['dependency_warning'])}) "
          "— contested propagated transitively, nothing auto-retracted.")

    sm.ingest_message(Message(message_id="retract-X", run_id="propagation-demo", task_id="synthetic",
                               sender=Sender.AGENT_A, target=Target.ALL, message_type=MessageType.RETRACTION,
                               content="retracting X", rationale="", confidence=0.6, status=Status.CANDIDATE,
                               supersedes=["X"]))
    print(f"  After retracting X: X={sm.get_claim('X')['status']} Y={sm.get_claim('Y')['status']} "
          f"Z={sm.get_claim('Z')['status']} — dependents stayed contested (not auto-retracted).")

    sm.ingest_message(Message(message_id="verify-Y", run_id="propagation-demo", task_id="synthetic",
                               sender=Sender.AGENT_B, target=Target.ALL, message_type=MessageType.VERIFICATION,
                               content="Y independently re-verified", rationale="", confidence=0.9,
                               status=Status.VERIFIED, depends_on=["Y"]))
    print(f"  After explicit re-verification of Y: Y={sm.get_claim('Y')['status']} "
          f"(Z stays {sm.get_claim('Z')['status']} — restoring Y did not auto-restore Z; "
          "each dependent needs its own re-verification).\n")


def main() -> None:
    run_tests()

    print("=" * 70)
    print("STEP 2/6 — running bug_diagnosis_001 under conditions A/B/C, clean + injected")
    print("=" * 70)
    results_dir = ROOT / "results"
    results_dir.mkdir(exist_ok=True)
    db_path = results_dir / "milestone1.sqlite3"
    if db_path.exists():
        db_path.unlink()
    conn = init_db(str(db_path))

    config = load_config()
    task = load_task("bug_diagnosis_001")

    runs_by_condition: dict[str, list[str]] = {"A": [], "B": [], "C": []}
    matched_pairs: dict[str, list[tuple[str, str]]] = {"A": [], "B": [], "C": []}
    reports = {}
    for condition in ("A", "B", "C"):
        clean_id = f"milestone1-{condition}-clean"
        run_task(conn, config, task, condition, clean_id, seed=1, injection_enabled=False, stage="plumbing_only")
        injected_id = f"milestone1-{condition}-injected"
        report = run_task(conn, config, task, condition, injected_id, seed=1, injection_enabled=True,
                           matched_clean_run_id=clean_id, stage="plumbing_only")
        runs_by_condition[condition] = [clean_id, injected_id]
        matched_pairs[condition] = [(clean_id, injected_id)]
        reports[condition] = report

    demonstrate_propagation(conn)

    print("=" * 70)
    print("STEP 4/6 — per-condition detection / challenge / correction (injected runs)")
    print("=" * 70)
    for condition, report in reports.items():
        cm = report.correction_metrics
        print(f"  Condition {condition}: turns_to_challenge={cm.get('turns_to_challenge')} "
              f"turns_to_correction={cm.get('turns_to_correction')} "
              f"tokens_to_correction={cm.get('tokens_to_correction')} "
              f"downstream_contamination_count={cm.get('downstream_contamination_count')} "
              f"correction_success_rate={cm.get('correction_success_rate')} "
              f"final_task_score={report.evaluation['task_score']}")

    print("\n" + "=" * 70)
    print("STEP 5/6 — writing plumbing_only comparison report")
    print("=" * 70)
    report_obj = build_comparison_report(
        conn, runs_by_condition, stage="plumbing_only", label="milestone1_required_demonstration",
        matched_pairs=matched_pairs,
    )
    report_dict = report_obj.to_dict()
    report_dict["per_condition_correction_metrics"] = {c: r.correction_metrics for c, r in reports.items()}
    report_dict["per_condition_validation_failures"] = {c: r.validation_failures for c, r in reports.items()}
    out_path = results_dir / "milestone1_comparison_report.json"
    out_path.write_text(json.dumps(report_dict, indent=2, default=str))
    print(f"  Wrote {out_path}")

    print("\n" + "=" * 70)
    print("STEP 6/6 — confirming Condition C replay reconstructs live state")
    print("=" * 70)
    for condition in ("A", "B", "C"):
        for suffix in ("clean", "injected"):
            run_id = f"milestone1-{condition}-{suffix}"
            if condition == "C":
                ok, mismatches = verify_replay_matches_live_state(conn, run_id)
                print(f"  {run_id}: replay {'MATCHES' if ok else 'MISMATCH ' + str(mismatches)}")

    conn.close()
    print("\nMilestone 1 demonstration complete. DB at", db_path)
    print("Dashboard: LAB_DB_PATH=results/milestone1.sqlite3 uvicorn app.api.main:app --reload")


if __name__ == "__main__":
    main()
