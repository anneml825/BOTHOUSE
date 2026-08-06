"""False-evidence injection (§7)."""

from app.experiments.injection import compute_correction_metrics, prepare_injection
from app.runtime.store import Store


def _make_run(store, run_id="run-1"):
    store.create_run(run_id=run_id, task_id="task-1", condition="C", stage="plumbing_only",
                      model_config={"provider": "mock"}, config_snapshot={})


def test_injected_evidence_stored_as_evidence_not_claim(conn, bug_task):
    store = Store(conn)
    _make_run(store)
    prepare_injection(store, "run-1", bug_task["task_id"], bug_task, injection_enabled=True)
    evidence_ids = {r["evidence_id"] for r in store.get_evidence("run-1")}
    assert bug_task["injected_evidence"]["evidence_id"] in evidence_ids
    # It must never appear in the claims table (nothing has ingested it as a claim yet).
    claims = list(conn.execute("SELECT * FROM claims WHERE run_id='run-1'"))
    assert claims == []


def test_injected_evidence_marker_recorded_but_not_disclosed_flag(conn, bug_task):
    store = Store(conn)
    _make_run(store)
    prepare_injection(store, "run-1", bug_task["task_id"], bug_task, injection_enabled=True)
    rows = list(conn.execute("SELECT * FROM injected_false_evidence WHERE run_id='run-1'"))
    assert len(rows) == 1
    assert rows[0]["disclosed_to_agents"] == 0
    assert rows[0]["ground_truth"] == bug_task["injected_evidence"]["ground_truth"]


def test_clean_run_has_no_injected_evidence(conn, bug_task):
    store = Store(conn)
    _make_run(store)
    prepare_injection(store, "run-1", bug_task["task_id"], bug_task, injection_enabled=False)
    evidence_ids = {r["evidence_id"] for r in store.get_evidence("run-1")}
    assert bug_task["injected_evidence"]["evidence_id"] not in evidence_ids
    rows = list(conn.execute("SELECT * FROM injected_false_evidence WHERE run_id='run-1'"))
    assert rows == []


def test_state_view_never_leaks_injected_marker(conn, bug_task):
    from app.runtime.history import retrieve_relevant_state
    store = Store(conn)
    _make_run(store)
    prepare_injection(store, "run-1", bug_task["task_id"], bug_task, injection_enabled=True)
    ctx = retrieve_relevant_state(conn, "run-1", bug_task["task_id"], "cache staleness", budget_tokens=5000)
    assert "is_injected_false" not in ctx.rendered_text
    assert "injected" not in ctx.rendered_text.lower() or bug_task["injected_evidence"]["evidence_id"] in ctx.rendered_text


def test_correction_metrics_from_end_to_end_injected_run(conn, bug_task, config):
    from app.experiments.orchestrator import run_task
    run_task(conn, config, bug_task, "C", "run-corr-1", seed=1, injection_enabled=True)
    metrics = compute_correction_metrics(conn, "run-corr-1", bug_task["injected_evidence"]["evidence_id"])
    assert metrics["exposed"] is True
    assert metrics["turns_to_challenge"] == 1
    assert metrics["turns_to_correction"] == 2
    assert metrics["tokens_to_correction"] is not None
    assert metrics["correction_success_rate"] == 1.0


def test_correction_metrics_clean_run_shows_no_exposure(conn, bug_task, config):
    from app.experiments.orchestrator import run_task
    run_task(conn, config, bug_task, "C", "run-corr-clean", seed=1, injection_enabled=False)
    metrics = compute_correction_metrics(conn, "run-corr-clean", bug_task["injected_evidence"]["evidence_id"])
    assert metrics["exposed"] is False
