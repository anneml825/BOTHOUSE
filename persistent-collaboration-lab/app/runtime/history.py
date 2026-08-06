"""Per-condition context assembly.

  Condition A: prior conversational turns, rendered as prose, newest->oldest
               fill of the shared history budget. Unit = one turn.
  Condition B: prior structured messages (content + rationale + all fields),
               passed *directly* from the in-memory run history — no DB
               retrieval. Unit = one message (+ its rationale).
  Condition C: a *retrieved relevant state view* built from the persistent
               store (claims/evidence/questions), not the accumulated
               transcript. Selection favors unresolved/contested material
               and recency; the runtime, not raw accumulation, decides what
               the agent sees.

All three are handed the same `history_token_budget` (§3: "Condition C
receives the same maximum input-token budget as A and B") and share the
budget/truncation mechanics in app/runtime/budget.py.
"""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass

from app.models.message import Message
from app.runtime.budget import HistoryUnit, assemble_within_budget
from app.runtime.tokens import count_tokens, count_tokens_json


@dataclass
class ContextResult:
    rendered_text: str
    tokens_available: int
    tokens_included: int
    tokens_omitted: int
    omitted_ids: list[str]
    state_items_retrieved: int = 0
    retrieved_token_count: int = 0
    retrieval_latency_ms: float = 0.0


# -- Condition A: transcript -----------------------------------------------------

def render_prose_turn(sender: str, role_label: str, prose: str) -> str:
    return f"[{role_label} / {sender}]: {prose}"


def build_history_a(turns: list[dict], budget_tokens: int) -> ContextResult:
    """`turns` is the in-memory list of {message_id, sender, role_label, prose,
    turn_index} dicts accumulated so far this run (plain text, condition A
    stores no structured claim graph)."""
    units = [
        HistoryUnit(
            unit_id=t["message_id"],
            token_count=count_tokens(t["prose"]),
            payload=t,
            turn_index=t["turn_index"],
        )
        for t in turns
    ]
    assembled = assemble_within_budget(units, budget_tokens)
    text = "\n".join(render_prose_turn(u.payload["sender"], u.payload["role_label"], u.payload["prose"]) for u in assembled.included)
    return ContextResult(
        rendered_text=text,
        tokens_available=assembled.tokens_available,
        tokens_included=assembled.tokens_included,
        tokens_omitted=assembled.tokens_omitted,
        omitted_ids=assembled.omitted_ids,
    )


# -- Condition B: structured messages passed directly ----------------------------

def render_structured_unit(msg: Message) -> str:
    payload = msg.model_dump(mode="json")
    return json.dumps(payload, sort_keys=True)


def build_history_b(messages: list[Message], budget_tokens: int) -> ContextResult:
    units = []
    for i, msg in enumerate(messages):
        text = render_structured_unit(msg)
        units.append(HistoryUnit(unit_id=msg.message_id, token_count=count_tokens(text), payload=msg, turn_index=i))
    assembled = assemble_within_budget(units, budget_tokens)
    text = "\n".join(render_structured_unit(u.payload) for u in assembled.included)
    return ContextResult(
        rendered_text=text,
        tokens_available=assembled.tokens_available,
        tokens_included=assembled.tokens_included,
        tokens_omitted=assembled.tokens_omitted,
        omitted_ids=assembled.omitted_ids,
    )


# -- Condition C: retrieved relevant state view ----------------------------------

def _relevance_score(row: sqlite3.Row, query_terms: set[str]) -> tuple[int, int]:
    """(salience, keyword_overlap) — salience prioritizes unresolved/contested
    material (the whole point of a runtime-managed store: surface what
    matters, not just what's recent), keyword_overlap gives light topical
    relevance to the current request."""
    salience = 0
    status = row["status"] if "status" in row.keys() else None
    if status in ("contested",):
        salience += 3
    if "dependency_warning" in row.keys() and row["dependency_warning"]:
        salience += 2
    if status in ("candidate", "hypothesis"):
        salience += 1
    content = (row["content"] if "content" in row.keys() else "") or ""
    overlap = len(query_terms.intersection(content.lower().split()))
    return (salience, overlap)


def retrieve_relevant_state(
    conn: sqlite3.Connection, run_id: str, task_id: str, query_text: str, budget_tokens: int, top_k: int = 50,
) -> ContextResult:
    start = time.perf_counter()
    query_terms = set(query_text.lower().split())

    claim_rows = list(conn.execute(
        "SELECT * FROM claims WHERE run_id = ? AND task_id = ?", (run_id, task_id)
    ))
    question_rows = list(conn.execute(
        "SELECT * FROM questions WHERE run_id = ? AND status = 'open'", (run_id,)
    ))
    evidence_rows = list(conn.execute(
        "SELECT * FROM evidence WHERE run_id = ? AND task_id = ?", (run_id, task_id)
    ))

    scored = []
    for r in claim_rows:
        scored.append((_relevance_score(r, query_terms), r["updated_at"], "claim", r))
    for r in question_rows:
        scored.append(((2, 0), r["created_at"], "question", r))
    for r in evidence_rows:
        # Evidence is retrieved as evidence, never labeled "verified" or
        # flagged as injected — the runtime never discloses that marker.
        scored.append(((1, 0), r["created_at"], "evidence", r))

    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    scored = scored[:top_k]

    units = []
    for i, (_score, _ts, kind, row) in enumerate(scored):
        rendered = _render_state_item(kind, row)
        units.append(HistoryUnit(unit_id=f"{kind}:{row[0]}", token_count=count_tokens(rendered), payload=rendered, turn_index=len(scored) - i))

    assembled = assemble_within_budget(units, budget_tokens)
    text = "\n".join(u.payload for u in assembled.included)
    latency_ms = (time.perf_counter() - start) * 1000
    return ContextResult(
        rendered_text=text,
        tokens_available=assembled.tokens_available,
        tokens_included=assembled.tokens_included,
        tokens_omitted=assembled.tokens_omitted,
        omitted_ids=assembled.omitted_ids,
        state_items_retrieved=len(assembled.included),
        retrieved_token_count=assembled.tokens_included,
        retrieval_latency_ms=latency_ms,
    )


def _render_state_item(kind: str, row: sqlite3.Row) -> str:
    if kind == "claim":
        return json.dumps({
            "kind": "claim", "claim_id": row["claim_id"], "content": row["content"],
            "status": row["status"], "confidence": row["confidence"],
            "dependency_warning": bool(row["dependency_warning"]),
        }, sort_keys=True)
    if kind == "question":
        return json.dumps({"kind": "question", "question_id": row["question_id"], "content": row["content"], "status": row["status"]}, sort_keys=True)
    if kind == "evidence":
        # Never include is_injected_false — agents must not see the marker.
        return json.dumps({
            "kind": "evidence", "evidence_id": row["evidence_id"], "content": row["content"],
            "source_type": row["source_type"], "provenance": row["provenance"], "reliability": row["reliability"],
        }, sort_keys=True)
    return ""
