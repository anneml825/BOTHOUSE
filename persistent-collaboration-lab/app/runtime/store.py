"""Generic persistence layer used by every condition.

All three conditions write `runs`, `messages`, and accounting rows here so
that audit/replay/analysis work uniformly regardless of condition. Only
Condition C additionally drives `app.runtime.state_manager`, which owns the
claims/dependencies/contradictions/status_history tables.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional

from app.models.message import Message


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    # -- runs / tasks / agents -------------------------------------------------

    def create_run(
        self,
        run_id: str,
        task_id: str,
        condition: str,
        stage: str,
        model_config: dict,
        config_snapshot: dict,
        seed: Optional[int] = None,
        injection_enabled: bool = False,
        injection_type: Optional[str] = None,
        matched_clean_run_id: Optional[str] = None,
    ) -> None:
        self.conn.execute(
            """INSERT INTO runs (run_id, task_id, condition, stage, model_config_json,
                seed, injection_enabled, injection_type, matched_clean_run_id,
                config_snapshot_json, status, started_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)""",
            (
                run_id, task_id, condition, stage, json.dumps(model_config),
                seed, int(injection_enabled), injection_type, matched_clean_run_id,
                json.dumps(config_snapshot), _now(),
            ),
        )
        self.conn.commit()

    def finish_run(self, run_id: str, status: str) -> None:
        self.conn.execute(
            "UPDATE runs SET status = ?, finished_at = ? WHERE run_id = ?",
            (status, _now(), run_id),
        )
        self.conn.commit()

    def upsert_task(self, task_id: str, family: str, name: str, version_hash: str, definition: dict) -> None:
        self.conn.execute(
            """INSERT INTO tasks (task_id, family, name, version_hash, definition_json)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(task_id) DO UPDATE SET
                 family=excluded.family, name=excluded.name,
                 version_hash=excluded.version_hash, definition_json=excluded.definition_json""",
            (task_id, family, name, version_hash, json.dumps(definition)),
        )
        self.conn.commit()

    def add_agent(self, agent_id: str, run_id: str, role: str, adapter_name: str, model_name: str) -> None:
        self.conn.execute(
            "INSERT INTO agents (agent_id, run_id, role, adapter_name, model_name) VALUES (?, ?, ?, ?, ?)",
            (agent_id, run_id, role, adapter_name, model_name),
        )
        self.conn.commit()

    # -- messages ---------------------------------------------------------------

    def add_message(self, msg: Message, turn_index: int, is_prose: bool = False) -> None:
        self.conn.execute(
            """INSERT INTO messages (message_id, run_id, task_id, turn_index, sender, target,
                message_type, content, rationale, confidence, evidence_ids_json, depends_on_json,
                contradicts_json, supersedes_json, status, requested_action, created_at, is_prose)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                msg.message_id, msg.run_id, msg.task_id, turn_index, msg.sender.value, msg.target.value,
                msg.message_type.value, msg.content, msg.rationale, msg.confidence,
                json.dumps(msg.evidence_ids), json.dumps(msg.depends_on),
                json.dumps(msg.contradicts), json.dumps(msg.supersedes),
                msg.status.value, msg.requested_action, msg.created_at, int(is_prose),
            ),
        )
        self.conn.commit()

    def get_messages(self, run_id: str) -> list[sqlite3.Row]:
        return list(self.conn.execute(
            "SELECT * FROM messages WHERE run_id = ? ORDER BY turn_index ASC", (run_id,)
        ))

    # -- evidence -----------------------------------------------------------

    def add_evidence(self, run_id: str, task_id: str, evidence: dict) -> None:
        self.conn.execute(
            """INSERT INTO evidence (evidence_id, run_id, task_id, source_type, content,
                provenance, reliability, is_injected_false, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(evidence_id) DO NOTHING""",
            (
                evidence["evidence_id"], run_id, task_id, evidence["source_type"],
                evidence["content"], evidence["provenance"], evidence.get("reliability", "unspecified"),
                int(evidence.get("is_injected_false", False)), _now(),
            ),
        )
        self.conn.commit()

    def get_evidence(self, run_id: str) -> list[sqlite3.Row]:
        return list(self.conn.execute("SELECT * FROM evidence WHERE run_id = ?", (run_id,)))

    def log_injected_evidence(self, run_id: str, evidence_id: str, injection_type: str, ground_truth: str) -> None:
        self.conn.execute(
            """INSERT INTO injected_false_evidence (run_id, evidence_id, injection_type, ground_truth,
                disclosed_to_agents, created_at) VALUES (?, ?, ?, ?, 0, ?)""",
            (run_id, evidence_id, injection_type, ground_truth, _now()),
        )
        self.conn.commit()

    # -- validation / raw outputs / context log ------------------------------

    def log_validation_failure(
        self, run_id: str, turn_index: int, failure_type: str, detail: str,
        repair_attempted: bool, repair_succeeded: bool,
    ) -> None:
        self.conn.execute(
            """INSERT INTO validation_failures (run_id, turn_index, failure_type, detail,
                repair_attempted, repair_succeeded, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (run_id, turn_index, failure_type, detail, int(repair_attempted), int(repair_succeeded), _now()),
        )
        self.conn.commit()

    def log_raw_output(self, run_id: str, **kwargs: Any) -> None:
        self.conn.execute(
            """INSERT INTO raw_model_outputs (run_id, agent_role, turn_index, prompt_tokens,
                completion_tokens, raw_text, schema_validation_passed, repair_attempted,
                repair_tokens, repair_succeeded, runtime_validation_error, operation_rejected,
                latency_ms, provider_cost_usd, repair_cost_usd, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run_id, kwargs["agent_role"], kwargs["turn_index"], kwargs["prompt_tokens"],
                kwargs["completion_tokens"], kwargs["raw_text"], int(kwargs["schema_validation_passed"]),
                int(kwargs.get("repair_attempted", False)), kwargs.get("repair_tokens", 0),
                int(kwargs.get("repair_succeeded", False)), kwargs.get("runtime_validation_error"),
                int(kwargs.get("operation_rejected", False)), kwargs["latency_ms"],
                kwargs.get("provider_cost_usd", 0.0), kwargs.get("repair_cost_usd", 0.0), _now(),
            ),
        )
        self.conn.commit()

    def log_context(self, run_id: str, turn_index: int, condition: str, **kwargs: Any) -> None:
        self.conn.execute(
            """INSERT INTO context_log (run_id, turn_index, condition, history_tokens_available,
                history_tokens_included, history_tokens_omitted, messages_omitted_json,
                state_items_retrieved, retrieved_token_count, retrieval_latency_ms, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run_id, turn_index, condition, kwargs["history_tokens_available"],
                kwargs["history_tokens_included"], kwargs["history_tokens_omitted"],
                json.dumps(kwargs.get("messages_omitted", [])), kwargs.get("state_items_retrieved", 0),
                kwargs.get("retrieved_token_count", 0), kwargs.get("retrieval_latency_ms", 0.0), _now(),
            ),
        )
        self.conn.commit()

    def add_evaluation(
        self, evaluation_id: str, run_id: str, task_score: float, details: dict,
        objective_score: Optional[float] = None, model_judge_score: Optional[float] = None,
        blinded_condition: bool = True,
    ) -> None:
        self.conn.execute(
            """INSERT INTO evaluations (evaluation_id, run_id, objective_score, model_judge_score,
                task_score, details_json, blinded_condition, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (evaluation_id, run_id, objective_score, model_judge_score, task_score,
             json.dumps(details), int(blinded_condition), _now()),
        )
        self.conn.commit()

    # -- cost / raw output aggregation ---------------------------------------

    def cost_breakdown(self, run_id: str) -> dict:
        rows = list(self.conn.execute(
            "SELECT provider_cost_usd, repair_cost_usd FROM raw_model_outputs WHERE run_id = ?",
            (run_id,),
        ))
        agent_cost = sum(r["provider_cost_usd"] for r in rows)
        repair_cost = sum(r["repair_cost_usd"] for r in rows)
        eval_rows = list(self.conn.execute(
            "SELECT details_json FROM evaluations WHERE run_id = ?", (run_id,)
        ))
        evaluator_cost = 0.0
        for r in eval_rows:
            details = json.loads(r["details_json"])
            evaluator_cost += float(details.get("evaluator_cost_usd", 0.0))
        total = agent_cost + repair_cost + evaluator_cost
        return {
            "agent_cost": agent_cost,
            "repair_cost": repair_cost,
            "evaluator_cost": evaluator_cost,
            "total_cost": total,
        }

    def total_tokens(self, run_id: str) -> int:
        row = self.conn.execute(
            "SELECT COALESCE(SUM(prompt_tokens + completion_tokens + repair_tokens), 0) AS t "
            "FROM raw_model_outputs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        return int(row["t"])
