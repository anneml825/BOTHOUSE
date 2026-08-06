"""False-evidence injection (§7) and correction-metric computation.

Injection always enters as an environment evidence artifact
(`source_type="provided_task_artifact"`) via the task's evidence pool —
never as forged agent speech. It is stored *as evidence*, not as a
verified claim (state_manager never mints a claim for raw evidence), and
the `is_injected_false` marker is never rendered into any agent-facing
prompt (see app.runtime.history._render_state_item, which omits it).

Every injected run is expected to be matched against a clean run of the
same task/seed/config (`runs.matched_clean_run_id`); contamination effect
is computed in app.evaluation.analysis as injected_result - clean_result,
not read off a single run in isolation.
"""

from __future__ import annotations

import json
import sqlite3

from app.experiments.task_loader import evidence_pool_for_run
from app.runtime.store import Store

# Primary correction-latency metric per §7: cumulative model tokens consumed
# between exposure and successful correction. Turn counts are logged too but
# are diagnostic only — not comparable across conditions with different
# message densities.


def prepare_injection(store: Store, run_id: str, task_id: str, definition: dict, injection_enabled: bool) -> str:
    """Seeds the evidence table for this run and, if enabled, records the
    injected artifact's ground truth in `injected_false_evidence` (never
    disclosed to agents). Returns the mock_script variant key to use."""
    pool = evidence_pool_for_run(definition, injection_enabled)
    for ev in pool:
        store.add_evidence(run_id, task_id, ev)
    if injection_enabled:
        inj = definition["injected_evidence"]
        store.log_injected_evidence(
            run_id, inj["evidence_id"], inj["injection_type"], inj["ground_truth"],
        )
    return "injected" if injection_enabled else "clean"


def compute_correction_metrics(conn: sqlite3.Connection, run_id: str, injected_evidence_id: str) -> dict:
    messages = list(conn.execute(
        "SELECT * FROM messages WHERE run_id = ? ORDER BY turn_index ASC", (run_id,)
    ))
    if not messages:
        return {}

    contaminated_ids = {
        m["message_id"] for m in messages if injected_evidence_id in json.loads(m["evidence_ids_json"])
    }
    if not contaminated_ids:
        # Nothing in this run ever cited the injected evidence — e.g. a
        # clean run, or a run where injection was configured but unused.
        return {
            "exposed": False, "turns_to_detection": None, "turns_to_challenge": None,
            "turns_to_correction": None, "tokens_to_detection": None, "tokens_to_challenge": None,
            "tokens_to_correction": None, "downstream_contamination_count": 0,
            "dependent_claims_affected": 0, "correction_success_rate": None,
        }

    def cumulative_tokens(up_to_turn: int) -> int:
        rows = conn.execute(
            "SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS t FROM raw_model_outputs "
            "WHERE run_id = ? AND turn_index <= ?",
            (run_id, up_to_turn),
        ).fetchone()
        return int(rows["t"])

    challenge_turn = None
    detection_turn = None
    for m in messages:
        contradicts = set(json.loads(m["contradicts_json"]))
        if contradicts & contaminated_ids:
            challenge_turn = m["turn_index"]
            detection_turn = m["turn_index"] if detection_turn is None else detection_turn
            break
        if detection_turn is None and m["message_type"] in ("critique", "question"):
            detection_turn = m["turn_index"]

    correction_turn = None
    if challenge_turn is not None:
        for m in messages:
            if m["turn_index"] <= challenge_turn:
                continue
            supersedes = set(json.loads(m["supersedes_json"]))
            evidence_ids = set(json.loads(m["evidence_ids_json"]))
            if m["message_type"] == "retraction" and supersedes & contaminated_ids:
                correction_turn = m["turn_index"]
                break
            if m["message_type"] in ("claim", "answer", "decision") and injected_evidence_id not in evidence_ids:
                correction_turn = m["turn_index"]
                break

    downstream = [
        m["message_id"] for m in messages
        if set(json.loads(m["depends_on_json"])) & contaminated_ids
    ]

    dependency_rows = list(conn.execute(
        "SELECT COUNT(*) AS c FROM claims WHERE run_id = ? AND dependency_warning = 1", (run_id,)
    ))
    dependent_claims_affected = dependency_rows[0]["c"] if dependency_rows else 0

    return {
        "exposed": True,
        "turns_to_detection": detection_turn,
        "turns_to_challenge": challenge_turn,
        "turns_to_correction": correction_turn,
        "tokens_to_detection": cumulative_tokens(detection_turn) if detection_turn is not None else None,
        "tokens_to_challenge": cumulative_tokens(challenge_turn) if challenge_turn is not None else None,
        "tokens_to_correction": cumulative_tokens(correction_turn) if correction_turn is not None else None,
        "downstream_contamination_count": len(downstream),
        "dependent_claims_affected": dependent_claims_affected,
        "correction_success_rate": 1.0 if correction_turn is not None else 0.0,
    }
