"""Per-condition context assembly + budget/truncation/omission logging (§5, §16)."""

from app.models.message import Message, MessageType, Sender, Status, Target
from app.runtime.budget import HistoryUnit, assemble_within_budget
from app.runtime.history import build_history_a, build_history_b


def test_budget_fills_newest_to_oldest_and_logs_omissions():
    units = [
        HistoryUnit(unit_id=f"u{i}", token_count=100, payload=i, turn_index=i)
        for i in range(5)
    ]
    assembled = assemble_within_budget(units, budget_tokens=250)
    # Newest three (turns 4,3,2) = 300 tokens > 250, so only two fit (4,3) = 200.
    included_ids = {u.unit_id for u in assembled.included}
    assert included_ids == {"u4", "u3"}
    assert set(assembled.omitted_ids) == {"u2", "u1", "u0"}
    assert assembled.tokens_included == 200
    assert assembled.tokens_omitted == 300


def test_budget_never_splits_a_unit():
    # A single 150-token unit under a 100-token budget is omitted whole, not truncated.
    units = [HistoryUnit(unit_id="big", token_count=150, payload="x", turn_index=0)]
    assembled = assemble_within_budget(units, budget_tokens=100)
    assert assembled.included == []
    assert assembled.omitted_ids == ["big"]


def test_condition_a_unit_is_one_conversational_turn():
    turns = [
        {"message_id": "m0", "sender": "agent_a", "role_label": "Solver", "prose": "first turn", "turn_index": 0},
        {"message_id": "m1", "sender": "agent_b", "role_label": "Critic", "prose": "second turn", "turn_index": 1},
    ]
    ctx = build_history_a(turns, budget_tokens=1000)
    assert "first turn" in ctx.rendered_text
    assert "second turn" in ctx.rendered_text
    assert ctx.omitted_ids == []


def test_condition_b_unit_is_message_plus_rationale_no_db_retrieval():
    msgs = [
        Message(message_id="m0", run_id="r", task_id="t", sender=Sender.AGENT_A, target=Target.ALL,
                message_type=MessageType.CLAIM, content="claim text", rationale="rationale text",
                confidence=0.5, status=Status.HYPOTHESIS),
    ]
    ctx = build_history_b(msgs, budget_tokens=1000)
    assert "claim text" in ctx.rendered_text
    assert "rationale text" in ctx.rendered_text  # rationale is part of the unit, passed directly


def test_condition_b_omits_whole_messages_under_tight_budget():
    msgs = [
        Message(message_id=f"m{i}", run_id="r", task_id="t", sender=Sender.AGENT_A, target=Target.ALL,
                message_type=MessageType.CLAIM, content="x " * 200, rationale="y " * 200,
                confidence=0.5, status=Status.HYPOTHESIS)
        for i in range(5)
    ]
    ctx = build_history_b(msgs, budget_tokens=300)
    assert len(ctx.omitted_ids) > 0
    assert ctx.tokens_included <= 300


def test_conditions_receive_identical_token_budget_parameter():
    # §3: Condition C gets the same max input-token budget as A and B — the
    # budget value itself must be a single shared config number, not a
    # per-condition one.
    from app.experiments.config import load_config
    config = load_config()
    assert "history_token_budget_per_turn" in config.budgets
    # No per-condition override key exists anywhere in budgets.yaml.
    assert not any(k.startswith("history_token_budget_") and k != "history_token_budget_per_turn" for k in config.budgets)
