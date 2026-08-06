"""Event replay must deterministically reconstruct final state (§6, §16)."""

from app.experiments.config import load_config
from app.experiments.orchestrator import run_task
from app.experiments.task_loader import load_task
from app.runtime.replay import reconstruct_claims, turn_by_turn_audit, verify_replay_matches_live_state


def test_replay_matches_live_state_for_condition_c(conn, bug_task, config):
    run_task(conn, config, bug_task, "C", "run-replay-1", seed=1, injection_enabled=True)
    matches, mismatches = verify_replay_matches_live_state(conn, "run-replay-1")
    assert matches, mismatches


def test_replay_is_deterministic_given_same_event_log(conn, bug_task, config):
    run_task(conn, config, bug_task, "C", "run-replay-2", seed=1, injection_enabled=True)
    first = reconstruct_claims(conn, "run-replay-2")
    second = reconstruct_claims(conn, "run-replay-2")
    assert {k: (v.status, v.dependency_warning) for k, v in first.items()} == \
           {k: (v.status, v.dependency_warning) for k, v in second.items()}


def test_turn_by_turn_audit_covers_every_message(conn, bug_task, config):
    run_task(conn, config, bug_task, "C", "run-replay-3", seed=1, injection_enabled=True)
    steps = turn_by_turn_audit(conn, "run-replay-3")
    n_messages = conn.execute("SELECT COUNT(*) AS c FROM messages WHERE run_id='run-replay-3'").fetchone()["c"]
    assert len(steps) == n_messages
    # The contested/retraction propagation caused by the critique/retraction
    # turns must show up as caused_events somewhere in the audit trail.
    all_caused = [e for step in steps for e in step["caused_events"]]
    assert any(e["reason"].startswith("contradicted by") for e in all_caused)
    assert any(e["reason"].startswith("retracted by") for e in all_caused)
