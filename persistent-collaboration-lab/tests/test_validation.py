"""Syntactic + semantic validation, message caps (§9)."""

import json

from app.models.message import MessageType
from app.runtime.validation import check_overlength, parse_agent_json, semantic_validate


def test_syntactic_failure_on_bad_json():
    outcome = parse_agent_json("not json at all {{{", message_id="m1", run_id="r1", task_id="t1", sender="agent_a")
    assert not outcome.ok
    assert outcome.failure_type == "syntactic"


def test_syntactic_failure_on_schema_mismatch():
    raw = json.dumps({"message_type": "claim", "content": "x", "confidence": 0.5, "status": "hypothesis", "extra_bogus_field": True})
    outcome = parse_agent_json(raw, message_id="m1", run_id="r1", task_id="t1", sender="agent_a")
    assert not outcome.ok
    assert outcome.failure_type == "syntactic"


def test_syntactic_success_fills_protocol_fields():
    raw = json.dumps({"message_type": "claim", "content": "x", "rationale": "y", "confidence": 0.5, "status": "hypothesis"})
    outcome = parse_agent_json(raw, message_id="m1", run_id="r1", task_id="t1", sender="agent_a")
    assert outcome.ok
    assert outcome.message.message_id == "m1"
    assert outcome.message.run_id == "r1"
    assert outcome.message.sender.value == "agent_a"


def test_semantic_failure_dangling_reference():
    raw = json.dumps({
        "message_type": "claim", "content": "x", "confidence": 0.5, "status": "hypothesis",
        "depends_on": ["nonexistent-claim"],
    })
    outcome = parse_agent_json(raw, message_id="m1", run_id="r1", task_id="t1", sender="agent_a")
    assert outcome.ok
    sem = semantic_validate(outcome.message, known_claim_ids=set(), known_evidence_ids=set())
    assert not sem.ok
    assert "unknown claim reference" in sem.detail


def test_semantic_failure_confidence_out_of_range():
    raw = json.dumps({"message_type": "claim", "content": "x", "confidence": 1.5, "status": "hypothesis"})
    outcome = parse_agent_json(raw, message_id="m1", run_id="r1", task_id="t1", sender="agent_a")
    assert outcome.ok  # syntactically fine — type-correct number
    sem = semantic_validate(outcome.message, known_claim_ids=set(), known_evidence_ids=set())
    assert not sem.ok
    assert "confidence out of range" in sem.detail


def test_semantic_failure_illegal_creation_status():
    raw = json.dumps({"message_type": "claim", "content": "x", "confidence": 0.5, "status": "verified"})
    outcome = parse_agent_json(raw, message_id="m1", run_id="r1", task_id="t1", sender="agent_a")
    sem = semantic_validate(outcome.message, known_claim_ids=set(), known_evidence_ids=set())
    assert not sem.ok
    assert "illegal creation status" in sem.detail


def test_verification_may_legally_start_verified():
    raw = json.dumps({"message_type": "verification", "content": "x", "confidence": 0.9, "status": "verified", "depends_on": ["c1"]})
    outcome = parse_agent_json(raw, message_id="m1", run_id="r1", task_id="t1", sender="agent_a")
    sem = semantic_validate(outcome.message, known_claim_ids={"c1"}, known_evidence_ids=set())
    assert sem.ok


def test_semantic_failure_self_contradictory_relations():
    raw = json.dumps({
        "message_type": "claim", "content": "x", "confidence": 0.5, "status": "hypothesis",
        "depends_on": ["c1"], "contradicts": ["c1"],
    })
    outcome = parse_agent_json(raw, message_id="m1", run_id="r1", task_id="t1", sender="agent_a")
    sem = semantic_validate(outcome.message, known_claim_ids={"c1"}, known_evidence_ids=set())
    assert not sem.ok
    assert "both depended-on and contradicted" in sem.detail


def test_semantic_failure_impossible_requested_action():
    raw = json.dumps({"message_type": "claim", "content": "x", "confidence": 0.5, "status": "hypothesis", "requested_action": "launch_missiles"})
    outcome = parse_agent_json(raw, message_id="m1", run_id="r1", task_id="t1", sender="agent_a")
    sem = semantic_validate(outcome.message, known_claim_ids=set(), known_evidence_ids=set())
    assert not sem.ok
    assert "impossible requested_action" in sem.detail


def test_semantic_failure_unknown_evidence_id():
    raw = json.dumps({"message_type": "claim", "content": "x", "confidence": 0.5, "status": "hypothesis", "evidence_ids": ["ghost"]})
    outcome = parse_agent_json(raw, message_id="m1", run_id="r1", task_id="t1", sender="agent_a")
    sem = semantic_validate(outcome.message, known_claim_ids=set(), known_evidence_ids=set())
    assert not sem.ok
    assert "unknown evidence_id" in sem.detail


def test_overlength_content_flagged():
    violations = check_overlength(
        "word " * 3000, "", message_type=MessageType.CLAIM,
        max_message_tokens=2000, max_rationale_tokens=1200, max_final_answer_tokens=2500,
    )
    assert any("content exceeds" in v for v in violations)


def test_overlength_rationale_flagged():
    violations = check_overlength(
        "short content", "word " * 2000, message_type=MessageType.CLAIM,
        max_message_tokens=2000, max_rationale_tokens=1200, max_final_answer_tokens=2500,
    )
    assert any("rationale exceeds" in v for v in violations)


def test_decision_uses_final_answer_cap():
    # A decision's content is allowed up to max_final_answer_tokens even
    # though that's larger than max_message_tokens.
    content = "x " * 2100  # ~1050 tokens, over max_message_tokens=1000 but under final cap
    violations = check_overlength(
        content, "", message_type=MessageType.DECISION,
        max_message_tokens=1000, max_rationale_tokens=1200, max_final_answer_tokens=2500,
    )
    assert violations == []
