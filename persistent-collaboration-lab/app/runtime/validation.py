"""Syntactic vs. semantic validation, and the one-shot repair policy (§9).

  Syntactic failure — output does not parse as JSON matching the Message
  schema at all (bad JSON, missing required field, wrong type).
  Semantic failure — valid JSON matching the schema, but internally
  inconsistent: dangling reference IDs, an illegal status transition, a
  self-contradictory set of relations, an out-of-range confidence value, an
  impossible requested action, or a claim declared `verified` at creation
  time (creation can never start at `verified` — see ALLOWED_TRANSITIONS).

Both failure kinds get exactly one automatic repair attempt, and every
repair attempt is charged to the condition's cost — see
app.experiments.orchestrator, which calls into this module and then, on
failure, re-invokes the adapter with a repair instruction.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Optional

from pydantic import ValidationError

from app.models.message import ALLOWED_TRANSITIONS, Message, MessageType, Status
from app.runtime.tokens import count_tokens

ALLOWED_REQUESTED_ACTIONS = {
    None, "re_verify", "provide_evidence", "apply_fix", "retract",
    "answer_question", "none",
}

# ALLOWED_TRANSITIONS[None] (hypothesis/candidate/supported) is the right
# creation rule for a message minting a genuinely new, as-yet-unchecked
# proposition (claim/answer/evidence/question). But every structured
# message mints a claims-table row (see state_manager), including message
# types whose entire point is to report an already-performed check —
# verification declares its own outcome (verified/contested), a critique's
# own stance is inherently "contested", a retraction's replacement claim is
# a fresh candidate. Restricting *those* to {hypothesis, candidate,
# supported} would make it impossible to express what the message type is
# for. So creation-status legality is keyed by message_type; only claim/
# answer (bare new propositions) are held to the strict "can't start
# verified" rule from §9 ("claims marked verified without verification
# evidence").
CREATION_ALLOWED_BY_TYPE: dict[MessageType, set[Status]] = {
    MessageType.CLAIM: ALLOWED_TRANSITIONS[None],
    MessageType.ANSWER: ALLOWED_TRANSITIONS[None],
    MessageType.QUESTION: {Status.HYPOTHESIS, Status.CANDIDATE},
    MessageType.EVIDENCE: ALLOWED_TRANSITIONS[None],
    MessageType.CRITIQUE: {Status.CONTESTED, Status.HYPOTHESIS, Status.CANDIDATE},
    MessageType.DECISION: {Status.CANDIDATE, Status.SUPPORTED, Status.VERIFIED},
    MessageType.RETRACTION: {Status.CANDIDATE, Status.HYPOTHESIS, Status.SUPPORTED},
    # `supported` included alongside `verified`/`contested`: a verification
    # can reasonably conclude partial/weaker support rather than full
    # verification without that being illegitimate — both are still
    # *weaker* than `verified`, so allowing it doesn't reopen the "can't
    # start already verified" hole this table exists to close.
    MessageType.VERIFICATION: {Status.VERIFIED, Status.CONTESTED, Status.SUPPORTED},
}


@dataclass
class ValidationOutcome:
    ok: bool
    message: Optional[Message] = None
    failure_type: Optional[str] = None  # "syntactic" | "semantic"
    detail: str = ""
    violations: list[str] = field(default_factory=list)


_FENCE_RE = re.compile(r"^```[a-zA-Z]*\s*\n?|```\s*$")


def _unfence(raw_text: str) -> str:
    """Real models routinely wrap "JSON only" output in a markdown code
    fence despite instructions not to. Stripping it is delimiter-level
    robustness, not a change to how content is interpreted — MockAdapter
    output (plain json.dumps, no fence) passes through this untouched, so
    it doesn't affect plumbing_only behavior at all."""
    text = raw_text.strip()
    if text.startswith("```"):
        text = _FENCE_RE.sub("", text).strip()
    return text


def parse_agent_json(raw_text: str, *, message_id: str, run_id: str, task_id: str, sender: str) -> ValidationOutcome:
    """Syntactic stage: parse raw model output as JSON and validate against
    the Message schema. Protocol metadata (message_id/run_id/task_id/sender/
    created_at) is orchestrator-controlled and always wins over anything the
    model supplies for those keys — agents are not asked to invent IDs."""
    text = _unfence(raw_text)
    try:
        # raw_decode (not loads) so a model that appends extra content after
        # a complete JSON object — trailing prose, or a second message it
        # wasn't asked for — doesn't turn a perfectly parseable first object
        # into a syntactic failure. Only the first object is ever used;
        # anything after it is simply not looked at (not stored, not acted
        # on) — the one-message-per-turn protocol is still enforced by the
        # orchestrator only ever taking this one parsed message per turn.
        data, _end_index = json.JSONDecoder().raw_decode(text)
        if not isinstance(data, dict):
            raise ValueError("top-level JSON value must be an object")
    except (json.JSONDecodeError, ValueError) as e:
        return ValidationOutcome(ok=False, failure_type="syntactic", detail=f"invalid JSON: {e}")

    merged = {"target": "all", **data, "message_id": message_id, "run_id": run_id, "task_id": task_id, "sender": sender}
    try:
        msg = Message(**merged)
    except ValidationError as e:
        return ValidationOutcome(ok=False, failure_type="syntactic", detail=f"schema validation failed: {e}")
    return ValidationOutcome(ok=True, message=msg)


def semantic_validate(
    msg: Message, *, known_claim_ids: set[str], known_evidence_ids: set[str],
) -> ValidationOutcome:
    violations: list[str] = []

    for eid in msg.evidence_ids:
        if eid not in known_evidence_ids:
            violations.append(f"unknown evidence_id: {eid}")
    for cid in (*msg.depends_on, *msg.contradicts, *msg.supersedes):
        if cid not in known_claim_ids:
            violations.append(f"unknown claim reference: {cid}")

    overlap = set(msg.depends_on) & set(msg.contradicts)
    if overlap:
        violations.append(f"claim(s) both depended-on and contradicted: {sorted(overlap)}")
    overlap2 = set(msg.supersedes) & set(msg.contradicts)
    if overlap2:
        violations.append(f"claim(s) both superseded and contradicted: {sorted(overlap2)}")

    if not (0.0 <= msg.confidence <= 1.0):
        violations.append(f"confidence out of range [0,1]: {msg.confidence}")

    allowed_creation = CREATION_ALLOWED_BY_TYPE[msg.message_type]
    if msg.status not in allowed_creation:
        violations.append(
            f"illegal creation status {msg.status.value} for message_type {msg.message_type.value}; "
            f"must be one of {sorted(s.value for s in allowed_creation)}"
        )

    if msg.requested_action not in ALLOWED_REQUESTED_ACTIONS:
        violations.append(f"impossible requested_action: {msg.requested_action!r}")

    if violations:
        return ValidationOutcome(
            ok=False, message=msg, failure_type="semantic",
            detail="; ".join(violations), violations=violations,
        )
    return ValidationOutcome(ok=True, message=msg)


def check_overlength(
    content: str, rationale: str, *, message_type: MessageType,
    max_message_tokens: int, max_rationale_tokens: int, max_final_answer_tokens: int,
) -> list[str]:
    """Message caps (§9), applied identically to structured (B/C) messages
    and to Condition A prose (the orchestrator calls this with `content` =
    the whole prose turn and `rationale` = "" for A) so structured agents
    are not uniquely penalized by the cap."""
    violations = []
    content_tokens = count_tokens(content)
    rationale_tokens = count_tokens(rationale)
    cap = max_final_answer_tokens if message_type in (MessageType.DECISION, MessageType.ANSWER) else max_message_tokens
    if content_tokens > cap:
        violations.append(f"content exceeds token cap: {content_tokens} > {cap}")
    if rationale_tokens > max_rationale_tokens:
        violations.append(f"rationale exceeds token cap: {rationale_tokens} > {max_rationale_tokens}")
    return violations
