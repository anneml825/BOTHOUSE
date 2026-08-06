import pytest
from pydantic import ValidationError

from app.models.message import Message, Sender, Status, Target, MessageType, message_json_schema


def _base_kwargs(**overrides):
    kwargs = dict(
        run_id="run-1", task_id="task-1", sender=Sender.AGENT_A, target=Target.ALL,
        message_type=MessageType.CLAIM, content="the bug is X", rationale="because Y",
        confidence=0.8, status=Status.HYPOTHESIS,
    )
    kwargs.update(overrides)
    return kwargs


def test_valid_message_constructs():
    msg = Message(**_base_kwargs())
    assert msg.message_id.startswith("msg-")
    assert msg.confidence == 0.8


def test_uses_rationale_not_reasoning_field():
    schema = message_json_schema()
    assert "rationale" in schema["properties"]
    assert "reasoning" not in schema["properties"]


def test_extra_fields_forbidden():
    with pytest.raises(ValidationError):
        Message(**_base_kwargs(reasoning="hidden thoughts"))


def test_exported_schema_file_is_in_sync():
    import json
    from pathlib import Path

    exported = json.loads((Path(__file__).resolve().parents[1] / "app" / "schemas" / "message_schema.json").read_text())
    assert exported == message_json_schema()


def test_json_schema_generation_has_all_required_fields():
    schema = message_json_schema()
    expected = {
        "message_id", "run_id", "task_id", "sender", "target", "message_type",
        "content", "rationale", "confidence", "evidence_ids", "depends_on",
        "contradicts", "supersedes", "status", "requested_action", "created_at",
    }
    assert expected.issubset(schema["properties"].keys())


def test_missing_required_field_rejected():
    kwargs = _base_kwargs()
    kwargs.pop("content")
    with pytest.raises(ValidationError):
        Message(**kwargs)


def test_defaults_for_optional_relation_fields():
    msg = Message(**_base_kwargs())
    assert msg.evidence_ids == []
    assert msg.depends_on == []
    assert msg.contradicts == []
    assert msg.supersedes == []
    assert msg.requested_action is None
