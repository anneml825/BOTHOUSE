"""Identical task/role config across conditions, except formatting (§3, §16)."""

from app.agents.roles import build_system_prompt
from app.experiments.task_loader import build_task_material


def test_system_prompts_share_identical_role_base_across_conditions():
    for role in ("agent_a", "agent_b"):
        prompts = {c: build_system_prompt(role, c) for c in ("A", "B", "C")}
        # Every condition's prompt must contain the exact same role-base text
        # (the shared, condition-independent instructions).
        from app.agents.roles import ROLE_BASE_PROMPTS
        base = ROLE_BASE_PROMPTS[role]
        for c, p in prompts.items():
            assert base in p, f"condition {c} prompt missing shared role base"


def test_prompts_differ_only_in_formatting_instruction():
    for role in ("agent_a", "agent_b"):
        a = build_system_prompt(role, "A")
        b = build_system_prompt(role, "B")
        c = build_system_prompt(role, "C")
        assert "plain natural language prose" in a
        assert "message_id" in b and "message_id" in c  # schema injected into B/C prompts only
        assert "message_id" not in a


def test_task_material_identical_modulo_injected_artifact(bug_task):
    clean = build_task_material(bug_task, include_injected=False)
    injected = build_task_material(bug_task, include_injected=True)
    assert clean != injected
    assert bug_task["injected_evidence"]["content"] not in clean
    assert bug_task["injected_evidence"]["content"] in injected
    # Everything else (prompt, non-injected evidence) is identical.
    assert bug_task["prompt"] in clean and bug_task["prompt"] in injected
    for ev in bug_task["evidence_pool"]:
        assert ev["content"] in clean and ev["content"] in injected


def test_turn_limits_and_budgets_shared_across_conditions():
    from app.experiments.config import load_config
    config = load_config()
    # A single config object feeds all three conditions' orchestrator runs —
    # there is no per-condition budgets.yaml section to diverge.
    assert set(config.budgets.keys()) >= {
        "max_turns_per_run", "max_total_tokens_per_run", "max_run_cost_usd",
        "max_tokens_per_message", "max_rationale_tokens", "max_final_answer_tokens",
    }
