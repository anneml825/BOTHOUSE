"""Claim creation, dependency graph, cycle rejection, and propagation rules
(§6, §16). Uses the StateManager directly on synthetic claims so the
propagation rules are pinned down precisely, independent of any particular
task's scripted narrative."""

from __future__ import annotations

import pytest

from app.models.message import Message, MessageType, Sender, Status, Target
from app.runtime.state_manager import StateManager


def _msg(mid, content, status, message_type=MessageType.CLAIM, **kw):
    return Message(
        message_id=mid, run_id="run-1", task_id="task-1", sender=Sender.AGENT_A, target=Target.ALL,
        message_type=message_type, content=content, rationale="", confidence=0.7, status=status, **kw,
    )


@pytest.fixture()
def sm(conn):
    conn.execute(
        "INSERT INTO runs (run_id, task_id, condition, stage, model_config_json, config_snapshot_json, status, started_at) "
        "VALUES ('run-1', 'task-1', 'C', 'plumbing_only', '{}', '{}', 'running', '2026-01-01T00:00:00Z')"
    )
    conn.commit()
    return StateManager(conn, "run-1", "task-1")


def test_claim_creation_logs_status_history(sm, conn):
    sm.ingest_message(_msg("c1", "root cause is X", Status.HYPOTHESIS))
    claim = sm.get_claim("c1")
    assert claim["status"] == "hypothesis"
    hist = list(conn.execute("SELECT * FROM status_history WHERE run_id='run-1'"))
    assert len(hist) == 1
    assert hist[0]["reason"] == "created"


def test_dependency_creation(sm):
    sm.ingest_message(_msg("c1", "base claim", Status.HYPOTHESIS))
    sm.ingest_message(_msg("c2", "derived claim", Status.CANDIDATE, depends_on=["c1"]))
    dependents = sm.get_direct_dependents("c1")
    assert dependents == ["c2"]


def test_cycle_rejected(sm):
    sm.ingest_message(_msg("c1", "A", Status.HYPOTHESIS))
    sm.ingest_message(_msg("c2", "B", Status.CANDIDATE, depends_on=["c1"]))
    result = sm.ingest_message(_msg("c3", "C tries to complete a cycle", Status.CANDIDATE, depends_on=["c2"]))
    # c1 -> depends on nothing; c2 -> depends on c1; now try c1 depends on c2 (cycle)
    added = sm.add_dependency("c1", "c2")
    assert added is False  # rejected: c2 already (transitively) depends on c1
    assert sm.get_direct_dependents("c2") == ["c3"]


def test_direct_self_dependency_rejected(sm):
    sm.ingest_message(_msg("c1", "A", Status.HYPOTHESIS))
    assert sm.add_dependency("c1", "c1") is False


def test_contested_propagates_to_direct_and_transitive_dependents(sm):
    sm.ingest_message(_msg("c1", "root", Status.HYPOTHESIS))
    sm.ingest_message(_msg("c2", "depends on root", Status.CANDIDATE, depends_on=["c1"]))
    sm.ingest_message(_msg("c3", "depends on c2", Status.CANDIDATE, depends_on=["c2"]))
    sm.ingest_message(_msg("c4", "unrelated", Status.HYPOTHESIS))

    sm.ingest_message(_msg("critic1", "disputes root", Status.CONTESTED, message_type=MessageType.CRITIQUE, contradicts=["c1"]))

    assert sm.get_claim("c1")["status"] == "contested"
    c2 = sm.get_claim("c2")
    c3 = sm.get_claim("c3")
    assert c2["status"] == "contested" and c2["dependency_warning"] == 1
    assert c3["status"] == "contested" and c3["dependency_warning"] == 1  # transitive
    assert sm.get_claim("c4")["status"] == "hypothesis"  # unrelated claim untouched


def test_contested_does_not_auto_retract(sm):
    sm.ingest_message(_msg("c1", "root", Status.HYPOTHESIS))
    sm.ingest_message(_msg("c2", "dependent", Status.CANDIDATE, depends_on=["c1"]))
    sm.ingest_message(_msg("critic1", "disputes root", Status.CONTESTED, message_type=MessageType.CRITIQUE, contradicts=["c1"]))
    assert sm.get_claim("c2")["status"] == "contested"  # not "retracted"


def test_retraction_propagates_transitively_without_auto_retract(sm):
    sm.ingest_message(_msg("c1", "root", Status.HYPOTHESIS))
    sm.ingest_message(_msg("c2", "depends on root", Status.CANDIDATE, depends_on=["c1"]))
    sm.ingest_message(_msg("c3", "depends on c2", Status.CANDIDATE, depends_on=["c2"]))

    sm.ingest_message(_msg("r1", "retracting root", Status.CANDIDATE, message_type=MessageType.RETRACTION, supersedes=["c1"]))

    assert sm.get_claim("c1")["status"] == "retracted"
    c2 = sm.get_claim("c2")
    c3 = sm.get_claim("c3")
    assert c2["status"] == "contested" and c2["dependency_warning"] == 1  # not auto-retracted
    assert c3["status"] == "contested" and c3["dependency_warning"] == 1  # transitive


def test_explicit_verification_required_to_leave_contested(sm):
    sm.ingest_message(_msg("c1", "root", Status.HYPOTHESIS))
    sm.ingest_message(_msg("c2", "dependent", Status.CANDIDATE, depends_on=["c1"]))
    sm.ingest_message(_msg("r1", "retract root", Status.CANDIDATE, message_type=MessageType.RETRACTION, supersedes=["c1"]))
    assert sm.get_claim("c2")["status"] == "contested"

    # Re-evaluation eligibility does not itself restore status:
    sm.mark_superseded("c1", "r1")
    assert sm.get_claim("c2")["status"] == "contested"  # still contested, no auto-restore

    # Only an explicit verification action can move it back.
    sm.ingest_message(_msg("v1", "verified after re-check", Status.VERIFIED, message_type=MessageType.VERIFICATION, depends_on=["c2"]))
    assert sm.get_claim("c2")["status"] == "verified"


def test_superseding_does_not_auto_restore_dependents(sm):
    sm.ingest_message(_msg("c1", "root", Status.HYPOTHESIS))
    sm.ingest_message(_msg("c2", "dependent", Status.CANDIDATE, depends_on=["c1"]))
    sm.ingest_message(_msg("r1", "retract root", Status.CANDIDATE, message_type=MessageType.RETRACTION, supersedes=["c1"]))
    sm.ingest_message(_msg("c1b", "corrected root, supersedes c1", Status.CANDIDATE, supersedes=["c1"]))
    # c2 should remain contested even though a superseding replacement for c1 now exists
    assert sm.get_claim("c2")["status"] == "contested"
    assert sm.get_claim("c1")["superseded_by"] in ("r1", "c1b")
