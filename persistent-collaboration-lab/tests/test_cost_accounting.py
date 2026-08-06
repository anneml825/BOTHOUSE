"""Cost accounting split (§10, §16)."""

from app.runtime.store import Store


def test_cost_breakdown_fields_present_and_zero_for_mock(conn, bug_task, config):
    from app.experiments.orchestrator import run_task
    run_task(conn, config, bug_task, "B", "run-cost-1", seed=1, injection_enabled=False)
    store = Store(conn)
    breakdown = store.cost_breakdown("run-cost-1")
    assert set(breakdown.keys()) == {"agent_cost", "repair_cost", "evaluator_cost", "total_cost"}
    # Mock adapter costs $0 by construction — but the split must still exist.
    assert breakdown["total_cost"] == breakdown["agent_cost"] + breakdown["repair_cost"] + breakdown["evaluator_cost"]


def test_repair_cost_separated_from_agent_cost(conn):
    store = Store(conn)
    store.create_run(run_id="run-1", task_id="t", condition="B", stage="plumbing_only",
                      model_config={"provider": "mock"}, config_snapshot={})
    store.log_raw_output(
        "run-1", agent_role="agent_a", turn_index=0, prompt_tokens=10, completion_tokens=10,
        raw_text="x", schema_validation_passed=True, repair_attempted=False, provider_cost_usd=0.02,
        latency_ms=1.0,
    )
    store.log_raw_output(
        "run-1", agent_role="agent_a", turn_index=0, prompt_tokens=10, completion_tokens=10,
        raw_text="repair", schema_validation_passed=True, repair_attempted=True, repair_succeeded=True,
        provider_cost_usd=0.0, repair_cost_usd=0.01, latency_ms=1.0,
    )
    breakdown = store.cost_breakdown("run-1")
    assert breakdown["agent_cost"] == 0.02
    assert breakdown["repair_cost"] == 0.01
    assert breakdown["total_cost"] == 0.03


def test_total_tokens_includes_repair_tokens(conn):
    store = Store(conn)
    store.create_run(run_id="run-1", task_id="t", condition="B", stage="plumbing_only",
                      model_config={"provider": "mock"}, config_snapshot={})
    store.log_raw_output(
        "run-1", agent_role="agent_a", turn_index=0, prompt_tokens=10, completion_tokens=10,
        raw_text="x", schema_validation_passed=False, repair_attempted=True, repair_tokens=15, latency_ms=1.0,
    )
    assert store.total_tokens("run-1") == 35
