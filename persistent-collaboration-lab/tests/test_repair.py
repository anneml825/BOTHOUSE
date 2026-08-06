"""Malformed-output repair: exactly one automatic attempt, charged to cost (§9, §16)."""

import json

from app.agents.mock_adapter import MockAdapter
from app.experiments.orchestrator import run_task
from app.runtime.store import Store

MINIMAL_TASK = {
    "task_id": "synthetic_repair_test",
    "family": "bug_diagnosis",
    "name": "repair test",
    "prompt": "test task",
    "evidence_pool": [],
    "mock_script": {"clean": [{"role": "agent_a"}]},
}

VALID_CLAIM = json.dumps({
    "message_type": "claim", "content": "ok now valid", "rationale": "fixed",
    "confidence": 0.6, "status": "hypothesis",
})


def test_malformed_output_triggers_one_repair_and_succeeds(conn, config):
    adapter = MockAdapter(["not valid json {{{", VALID_CLAIM])
    report = run_task(conn, config, MINIMAL_TASK, "B", "run-repair-1", seed=1, adapter=adapter)

    failures = list(conn.execute("SELECT * FROM validation_failures WHERE run_id='run-repair-1'"))
    assert len(failures) == 1
    assert failures[0]["failure_type"] == "syntactic"
    assert failures[0]["repair_attempted"] == 1

    raw = list(conn.execute("SELECT * FROM raw_model_outputs WHERE run_id='run-repair-1'"))
    assert len(raw) == 1  # one turn logged, repair folded into it
    assert raw[0]["repair_attempted"] == 1
    assert raw[0]["repair_succeeded"] == 1
    assert raw[0]["schema_validation_passed"] == 0  # first attempt failed

    messages = list(conn.execute("SELECT * FROM messages WHERE run_id='run-repair-1'"))
    assert len(messages) == 1
    assert messages[0]["content"] == "ok now valid"


def test_failed_repair_is_charged_and_terminates_run(conn, config):
    adapter = MockAdapter(["still not json", "also not json"])
    report = run_task(conn, config, MINIMAL_TASK, "B", "run-repair-2", seed=1, adapter=adapter)
    assert report.status == "failed"

    raw = list(conn.execute("SELECT * FROM raw_model_outputs WHERE run_id='run-repair-2'"))
    assert len(raw) == 1
    assert raw[0]["repair_attempted"] == 1
    assert raw[0]["repair_succeeded"] == 0
    assert raw[0]["operation_rejected"] == 1

    store = Store(conn)
    breakdown = store.cost_breakdown("run-repair-2")
    # Repair attempt cost is tracked separately even when it fails and costs $0 (mock).
    assert "repair_cost" in breakdown

    messages = list(conn.execute("SELECT * FROM messages WHERE run_id='run-repair-2'"))
    assert messages == []  # never stored — repair failed, message rejected
