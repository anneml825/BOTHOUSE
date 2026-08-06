"""End-to-end mock batch run across all three conditions, clean + injected
(§12, §16, §19 Milestone 1 required demonstration)."""

import itertools

from app.experiments.orchestrator import run_task
from app.runtime.replay import verify_replay_matches_live_state


def test_all_three_conditions_run_clean_and_injected(conn, bug_task, config):
    reports = {}
    for condition, injected in itertools.product(("A", "B", "C"), (False, True)):
        run_id = f"batch-{condition}-{int(injected)}"
        reports[(condition, injected)] = run_task(
            conn, config, bug_task, condition, run_id, seed=1, injection_enabled=injected,
        )

    for key, report in reports.items():
        assert report.status == "completed", f"{key} did not complete: {report.status}"
        assert report.evaluation["task_score"] == 1.0, f"{key} did not solve the task"

    # Clean runs finish faster (no detection/correction cycle needed).
    for condition in ("A", "B", "C"):
        assert reports[(condition, False)].turns_executed < reports[(condition, True)].turns_executed

    # Injected runs all detect + correct the false evidence.
    for condition in ("A", "B", "C"):
        cm = reports[(condition, True)].correction_metrics
        assert cm["exposed"] is True
        assert cm["turns_to_correction"] is not None
        assert cm["correction_success_rate"] == 1.0

    # Condition C's persistent state is deterministically replayable.
    ok, mismatches = verify_replay_matches_live_state(conn, "batch-C-1")
    assert ok, mismatches


def test_condition_c_builds_claim_graph_but_a_and_b_do_not(conn, bug_task, config):
    for condition in ("A", "B", "C"):
        run_task(conn, config, bug_task, condition, f"graph-{condition}", seed=1, injection_enabled=True)

    a_claims = conn.execute("SELECT COUNT(*) AS c FROM claims WHERE run_id='graph-A'").fetchone()["c"]
    b_claims = conn.execute("SELECT COUNT(*) AS c FROM claims WHERE run_id='graph-B'").fetchone()["c"]
    c_claims = conn.execute("SELECT COUNT(*) AS c FROM claims WHERE run_id='graph-C'").fetchone()["c"]
    assert a_claims == 0
    assert b_claims == 0
    assert c_claims == 5  # one claim row per structured message, only Condition C runs the state manager


def test_identical_task_and_roles_produce_identical_turn_counts_across_conditions(conn, bug_task, config):
    # Same scripted scenario length regardless of condition — role logic and
    # turn structure are shared; only representation/state differ.
    reports = {}
    for condition in ("A", "B", "C"):
        reports[condition] = run_task(conn, config, bug_task, condition, f"parity-{condition}", seed=1, injection_enabled=True)
    turns = {r.turns_executed for r in reports.values()}
    assert len(turns) == 1
