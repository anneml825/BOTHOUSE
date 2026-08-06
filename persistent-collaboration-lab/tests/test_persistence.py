"""State persistence and the never-delete guarantee (§6, §16)."""

from app.models.message import Message, MessageType, Sender, Status, Target
from app.runtime.state_manager import StateManager
from app.runtime.store import Store


def _make_run(store: Store):
    store.create_run(
        run_id="run-1", task_id="task-1", condition="C", stage="plumbing_only",
        model_config={"provider": "mock"}, config_snapshot={},
    )


def test_store_message_roundtrip(conn):
    store = Store(conn)
    _make_run(store)
    msg = Message(
        message_id="m1", run_id="run-1", task_id="task-1", sender=Sender.AGENT_A, target=Target.ALL,
        message_type=MessageType.CLAIM, content="hello", rationale="because", confidence=0.5, status=Status.HYPOTHESIS,
    )
    store.add_message(msg, turn_index=0)
    rows = store.get_messages("run-1")
    assert len(rows) == 1
    assert rows[0]["content"] == "hello"
    assert rows[0]["rationale"] == "because"


def test_status_history_is_append_only_across_transitions(conn):
    store = Store(conn)
    _make_run(store)
    sm = StateManager(conn, "run-1", "task-1")
    msg1 = Message(message_id="c1", run_id="run-1", task_id="task-1", sender=Sender.AGENT_A, target=Target.ALL,
                   message_type=MessageType.CLAIM, content="X", rationale="", confidence=0.6, status=Status.HYPOTHESIS)
    sm.ingest_message(msg1)
    msg2 = Message(message_id="c2", run_id="run-1", task_id="task-1", sender=Sender.AGENT_B, target=Target.ALL,
                   message_type=MessageType.CRITIQUE, content="disagree", rationale="", confidence=0.6,
                   status=Status.CONTESTED, contradicts=["c1"])
    sm.ingest_message(msg2)

    rows_before = list(conn.execute("SELECT * FROM status_history WHERE run_id='run-1'"))
    assert len(rows_before) >= 2  # c1 created, c1 contested (at least)

    # No UPDATE or DELETE ever touches status_history; only inserts.
    seqs = [r["seq"] for r in rows_before]
    assert seqs == sorted(seqs)
    assert len(seqs) == len(set(seqs))


def test_evidence_never_overwritten_on_reinsert(conn):
    store = Store(conn)
    _make_run(store)
    ev = {"evidence_id": "e1", "source_type": "provided_task_artifact", "content": "original", "provenance": "task"}
    store.add_evidence("run-1", "task-1", ev)
    store.add_evidence("run-1", "task-1", {**ev, "content": "attempted overwrite"})
    rows = store.get_evidence("run-1")
    assert len(rows) == 1
    assert rows[0]["content"] == "original"


def test_validation_failures_logged_and_never_deleted(conn):
    store = Store(conn)
    _make_run(store)
    store.log_validation_failure("run-1", 0, "syntactic", "bad json", True, False)
    store.log_validation_failure("run-1", 1, "semantic", "dangling ref", True, True)
    rows = list(conn.execute("SELECT * FROM validation_failures WHERE run_id='run-1'"))
    assert len(rows) == 2
