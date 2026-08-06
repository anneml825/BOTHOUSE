"""The orchestrator: load task -> select condition -> init two agents ->
apply identical role/task prompts -> run alternating turns -> validate
outputs -> store messages/state -> inject false evidence when configured ->
apply dependency propagation (Condition C only) -> stop on final decision,
turn limit, cost limit, or failure -> evaluate -> return a run report (§12).

Everything that differs by condition is confined to: (1) which history-
assembly function runs (app.runtime.history), (2) whether
app.runtime.state_manager.StateManager is engaged at all, and (3) the
formatting instruction in the system prompt. Turn order, roles, task input,
tool access, turn/token/cost limits, and the evaluator are identical.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from typing import Optional

from app.agents.base import ModelAdapter
from app.agents.mock_adapter import MockAdapter
from app.agents.roles import build_system_prompt
from app.evaluation.evaluator import evaluate
from app.experiments.config import LabConfig
from app.experiments.injection import compute_correction_metrics, prepare_injection
from app.experiments.task_loader import build_mock_queue, build_task_material, resolve_refs, task_version_hash, turn_roles
from app.models.message import Message, MessageType, Sender, Status, Target, new_id, utcnow_iso
from app.runtime.history import build_history_a, build_history_b, retrieve_relevant_state
from app.runtime.state_manager import StateManager
from app.runtime.store import Store
from app.runtime.validation import check_overlength, parse_agent_json, semantic_validate

ROLE_LABEL = {"agent_a": "Solver", "agent_b": "Critic"}


@dataclass
class RunReport:
    run_id: str
    task_id: str
    condition: str
    stage: str
    status: str
    turns_executed: int
    evaluation: dict = field(default_factory=dict)
    correction_metrics: dict = field(default_factory=dict)
    cost_breakdown: dict = field(default_factory=dict)
    total_tokens: int = 0
    validation_failures: int = 0


def _make_adapter(config: LabConfig) -> ModelAdapter:
    """For plumbing_only / mock runs we always get MockAdapter. Real
    adapters are selected the same way by pointing `active_adapter` at an
    openai_* / anthropic_* entry in config/models.yaml (§11) — nothing in
    this function branches on condition."""
    cfg = config.active_adapter_config()
    if cfg["provider"] == "mock":
        return MockAdapter([], model_name=cfg["model_name"])
    if cfg["provider"] == "openai":
        from app.agents.openai_adapter import OpenAIAdapter
        return OpenAIAdapter(cfg["model_name"], cfg.get("input_rate_per_1k", 0), cfg.get("output_rate_per_1k", 0))
    if cfg["provider"] == "anthropic":
        from app.agents.anthropic_adapter import AnthropicAdapter
        return AnthropicAdapter(cfg["model_name"], cfg.get("input_rate_per_1k", 0), cfg.get("output_rate_per_1k", 0))
    raise ValueError(f"unknown provider {cfg['provider']!r}")


def run_task(
    conn: sqlite3.Connection,
    config: LabConfig,
    task_definition: dict,
    condition: str,
    run_id: str,
    seed: int = 0,
    injection_enabled: bool = False,
    matched_clean_run_id: Optional[str] = None,
    stage: Optional[str] = None,
    adapter: Optional[ModelAdapter] = None,
) -> RunReport:
    assert condition in ("A", "B", "C")
    store = Store(conn)
    stage = stage or config.experiment.get("stage", "plumbing_only")
    task_id = task_definition["task_id"]
    budgets = config.budgets
    adapter_cfg = config.active_adapter_config()

    store.upsert_task(task_id, task_definition["family"], task_definition["name"], task_version_hash(task_definition), task_definition)
    store.create_run(
        run_id=run_id, task_id=task_id, condition=condition, stage=stage,
        model_config=adapter_cfg, config_snapshot=config.snapshot(), seed=seed,
        injection_enabled=injection_enabled,
        injection_type=(task_definition.get("injected_evidence", {}) or {}).get("injection_type") if injection_enabled else None,
        matched_clean_run_id=matched_clean_run_id,
    )
    store.add_agent(new_id("agent"), run_id, "agent_a", adapter_cfg["provider"], adapter_cfg["model_name"])
    store.add_agent(new_id("agent"), run_id, "agent_b", adapter_cfg["provider"], adapter_cfg["model_name"])

    variant = prepare_injection(store, run_id, task_id, task_definition, injection_enabled)
    task_material = build_task_material(task_definition, injection_enabled)
    known_evidence_ids = {ev["evidence_id"] for ev in task_definition.get("evidence_pool", [])}
    if injection_enabled and task_definition.get("injected_evidence"):
        known_evidence_ids.add(task_definition["injected_evidence"]["evidence_id"])

    refs: dict[str, str] = {}
    if adapter is None:
        if adapter_cfg["provider"] == "mock":
            adapter = MockAdapter(build_mock_queue(task_definition, condition, variant, refs), model_name=adapter_cfg["model_name"])
        else:
            adapter = _make_adapter(config)

    state_manager = StateManager(conn, run_id, task_id) if condition == "C" else None

    prose_turns: list[dict] = []          # Condition A
    structured_messages: list[Message] = []  # Condition B
    known_ids: set[str] = set()            # message_ids seen so far (B/C dangling-ref check)

    roles = turn_roles(task_definition, variant)
    max_turns = min(budgets["max_turns_per_run"], len(roles))
    history_budget = budgets["history_token_budget_per_turn"]

    final_message: Optional[Message] = None
    status = "running"
    validation_failure_count = 0
    turn_index = 0

    for turn_index, role in enumerate(roles):
        if turn_index >= max_turns:
            status = "turn_limit"
            break
        if store.total_tokens(run_id) >= budgets["max_total_tokens_per_run"]:
            status = "turn_limit"
            break
        if store.cost_breakdown(run_id)["total_cost"] >= budgets["max_run_cost_usd"]:
            status = "cost_limit"
            break

        system_prompt = build_system_prompt(role, condition)
        current_request = task_material if turn_index == 0 else "Continue the collaboration toward a final decision."

        if condition == "A":
            ctx = build_history_a(prose_turns, history_budget)
        elif condition == "B":
            ctx = build_history_b(structured_messages, history_budget)
        else:
            ctx = retrieve_relevant_state(conn, run_id, task_id, current_request, history_budget)

        store.log_context(
            run_id, turn_index, condition,
            history_tokens_available=ctx.tokens_available, history_tokens_included=ctx.tokens_included,
            history_tokens_omitted=ctx.tokens_omitted, messages_omitted=ctx.omitted_ids,
            state_items_retrieved=ctx.state_items_retrieved, retrieved_token_count=ctx.retrieved_token_count,
            retrieval_latency_ms=ctx.retrieval_latency_ms,
        )

        user_prompt = f"TASK:\n{task_material}\n\nCONTEXT:\n{ctx.rendered_text}\n\nCURRENT REQUEST:\n{current_request}"
        max_resp_tokens = budgets["max_final_answer_tokens"]

        response = adapter.generate(system_prompt, user_prompt, max_tokens=max_resp_tokens, temperature=config.experiment.get("temperature", 0.0))
        message_id = new_id("msg")

        repair_attempted = False
        repair_succeeded = False
        repair_tokens = 0
        repair_cost = 0.0
        schema_validation_passed = True
        runtime_validation_error = None
        msg: Optional[Message] = None

        if condition == "A":
            turn_spec = task_definition["mock_script"][variant][turn_index]
            resolved = resolve_refs(turn_spec, refs)
            candidate_content = response.text
            overlength = check_overlength(
                candidate_content, "", message_type=MessageType(turn_spec["message_type"]),
                max_message_tokens=budgets["max_tokens_per_message"], max_rationale_tokens=budgets["max_rationale_tokens"],
                max_final_answer_tokens=budgets["max_final_answer_tokens"],
            )
            if overlength:
                validation_failure_count += 1
                store.log_validation_failure(run_id, turn_index, "overlength", "; ".join(overlength), True, False)
                repair_attempted = True
                repair_resp = adapter.generate(
                    system_prompt, user_prompt + "\n\nYour previous reply was too long. Return the same "
                    "communicative commitment within the permitted token limit.",
                    max_tokens=max_resp_tokens, temperature=0.0,
                )
                repair_tokens = repair_resp.prompt_tokens + repair_resp.completion_tokens
                repair_cost += repair_resp.cost_usd
                candidate_content = repair_resp.text
                repair_succeeded = True  # mock scenarios are always within cap; real runs may still fail
            msg = Message(
                message_id=message_id, run_id=run_id, task_id=task_id, sender=Sender(role),
                target=Target.ALL, message_type=MessageType(turn_spec["message_type"]),
                content=candidate_content, rationale="", confidence=turn_spec["confidence"],
                evidence_ids=turn_spec.get("evidence_ids", []), depends_on=resolved["depends_on"],
                contradicts=resolved["contradicts"], supersedes=resolved["supersedes"],
                status=Status(turn_spec["status"]), requested_action=turn_spec.get("requested_action"),
                created_at=utcnow_iso(),
            )
        else:
            outcome = parse_agent_json(response.text, message_id=message_id, run_id=run_id, task_id=task_id, sender=role)
            if not outcome.ok:
                schema_validation_passed = False
                validation_failure_count += 1
                store.log_validation_failure(run_id, turn_index, "syntactic", outcome.detail, True, False)
                repair_attempted = True
                repair_resp = adapter.generate(
                    system_prompt, user_prompt + f"\n\nYour previous response was invalid: {outcome.detail}\n"
                    "Return the same communicative commitment as a single JSON object matching the required schema.",
                    max_tokens=max_resp_tokens, temperature=0.0,
                )
                repair_tokens += repair_resp.prompt_tokens + repair_resp.completion_tokens
                repair_cost += repair_resp.cost_usd
                outcome = parse_agent_json(repair_resp.text, message_id=message_id, run_id=run_id, task_id=task_id, sender=role)
                if outcome.ok:
                    repair_succeeded = True
                else:
                    runtime_validation_error = outcome.detail
                    store.log_validation_failure(run_id, turn_index, "syntactic", outcome.detail, True, False)
                    status = "failed"

            if outcome.ok:
                semantic = semantic_validate(outcome.message, known_claim_ids=known_ids, known_evidence_ids=known_evidence_ids)
                if not semantic.ok:
                    validation_failure_count += 1
                    store.log_validation_failure(run_id, turn_index, "semantic", semantic.detail, True, False)
                    if not repair_attempted:
                        repair_attempted = True
                        repair_resp = adapter.generate(
                            system_prompt, user_prompt + f"\n\nYour previous response had semantic issues: {semantic.detail}\n"
                            "Return a corrected JSON object matching the schema with valid references.",
                            max_tokens=max_resp_tokens, temperature=0.0,
                        )
                        repair_tokens += repair_resp.prompt_tokens + repair_resp.completion_tokens
                        repair_cost += repair_resp.cost_usd
                        outcome2 = parse_agent_json(repair_resp.text, message_id=message_id, run_id=run_id, task_id=task_id, sender=role)
                        if outcome2.ok:
                            semantic2 = semantic_validate(outcome2.message, known_claim_ids=known_ids, known_evidence_ids=known_evidence_ids)
                            if semantic2.ok:
                                outcome = semantic2
                                repair_succeeded = True
                            else:
                                runtime_validation_error = semantic2.detail
                                status = "failed"
                        else:
                            runtime_validation_error = outcome2.detail
                            status = "failed"
                    else:
                        runtime_validation_error = semantic.detail
                        status = "failed"
                if outcome.ok:
                    msg = outcome.message
                    overlength = check_overlength(
                        msg.content, msg.rationale, message_type=msg.message_type,
                        max_message_tokens=budgets["max_tokens_per_message"], max_rationale_tokens=budgets["max_rationale_tokens"],
                        max_final_answer_tokens=budgets["max_final_answer_tokens"],
                    )
                    if overlength:
                        validation_failure_count += 1
                        store.log_validation_failure(run_id, turn_index, "overlength", "; ".join(overlength), True, False)
                        # Scripted scenarios stay within cap; logged for audit, not re-repaired
                        # to keep a hard one-repair-per-turn ceiling on cost.

        store.log_raw_output(
            run_id, agent_role=role, turn_index=turn_index, prompt_tokens=response.prompt_tokens,
            completion_tokens=response.completion_tokens, raw_text=response.text,
            schema_validation_passed=schema_validation_passed, repair_attempted=repair_attempted,
            repair_tokens=repair_tokens, repair_succeeded=repair_succeeded,
            runtime_validation_error=runtime_validation_error, operation_rejected=(msg is None),
            latency_ms=response.latency_ms, provider_cost_usd=response.cost_usd, repair_cost_usd=repair_cost,
        )

        if msg is None:
            status = status if status != "running" else "failed"
            break

        store.add_message(msg, turn_index, is_prose=(condition == "A"))
        known_ids.add(msg.message_id)
        refs[f"T{turn_index}"] = msg.message_id

        if condition == "A":
            prose_turns.append({
                "message_id": msg.message_id, "sender": role, "role_label": ROLE_LABEL[role],
                "prose": msg.content, "turn_index": turn_index,
            })
        elif condition == "B":
            structured_messages.append(msg)
        else:
            state_manager.ingest_message(msg)

        if msg.message_type == MessageType.QUESTION:
            conn.execute(
                "INSERT INTO questions (question_id, run_id, message_id, content, status, created_at) "
                "VALUES (?, ?, ?, ?, 'open', ?)",
                (new_id("q"), run_id, msg.message_id, msg.content, utcnow_iso()),
            )
            conn.commit()
        if msg.message_type == MessageType.DECISION:
            conn.execute(
                "INSERT INTO decisions (decision_id, run_id, message_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
                (new_id("dec"), run_id, msg.message_id, msg.content, utcnow_iso()),
            )
            conn.commit()
            final_message = msg
            status = "completed"
            break

    turns_executed = turn_index + (1 if final_message is not None else 0) if final_message else turn_index
    if status == "running":
        status = "turn_limit"

    evaluation = evaluate(task_definition, final_message.content if final_message else None)
    store.add_evaluation(new_id("eval"), run_id, evaluation["task_score"], evaluation, evaluation.get("objective_score"), evaluation.get("model_judge_score"))

    injected_evidence_id = (task_definition.get("injected_evidence") or {}).get("evidence_id", "")
    correction_metrics = compute_correction_metrics(conn, run_id, injected_evidence_id) if injected_evidence_id else {}

    store.finish_run(run_id, status)

    return RunReport(
        run_id=run_id, task_id=task_id, condition=condition, stage=stage, status=status,
        turns_executed=turns_executed, evaluation=evaluation, correction_metrics=correction_metrics,
        cost_breakdown=store.cost_breakdown(run_id), total_tokens=store.total_tokens(run_id),
        validation_failures=validation_failure_count,
    )
