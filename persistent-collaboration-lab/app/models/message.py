"""Strict Pydantic schema for the inter-agent structured message.

This is THE communication contract used by Conditions B and C (and, in a
degraded/prose form, logged for Condition A too — see
`app/runtime/history.py`). The runtime parses and acts on the structured
fields below. It stores `rationale` but never interprets it: rationale text
is never auto-converted into claims, dependencies, or evidence, and it is
never treated as a report of hidden model cognition — it is a communicable
justification the agent chooses to share, nothing more.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Sender(str, Enum):
    AGENT_A = "agent_a"
    AGENT_B = "agent_b"


class Target(str, Enum):
    AGENT_A = "agent_a"
    AGENT_B = "agent_b"
    RUNTIME = "runtime"
    ALL = "all"


class MessageType(str, Enum):
    CLAIM = "claim"
    QUESTION = "question"
    ANSWER = "answer"
    CRITIQUE = "critique"
    EVIDENCE = "evidence"
    DECISION = "decision"
    RETRACTION = "retraction"
    VERIFICATION = "verification"


class Status(str, Enum):
    HYPOTHESIS = "hypothesis"
    CANDIDATE = "candidate"
    SUPPORTED = "supported"
    CONTESTED = "contested"
    RETRACTED = "retracted"
    VERIFIED = "verified"


# Message types that mint or update a row in the `claims` table when they
# flow through Condition C's state manager.
CLAIM_BEARING_TYPES = {
    MessageType.CLAIM,
    MessageType.ANSWER,
    MessageType.DECISION,
    MessageType.RETRACTION,
    MessageType.VERIFICATION,
}

# Legal status transitions used by semantic validation (§9). `None` means
# "creation" (no prior status).
ALLOWED_TRANSITIONS: dict[Optional[Status], set[Status]] = {
    None: {Status.HYPOTHESIS, Status.CANDIDATE, Status.SUPPORTED},
    Status.HYPOTHESIS: {Status.CANDIDATE, Status.SUPPORTED, Status.CONTESTED, Status.RETRACTED},
    Status.CANDIDATE: {Status.SUPPORTED, Status.CONTESTED, Status.RETRACTED, Status.VERIFIED},
    Status.SUPPORTED: {Status.CONTESTED, Status.RETRACTED, Status.VERIFIED},
    Status.CONTESTED: {Status.CANDIDATE, Status.SUPPORTED, Status.RETRACTED, Status.VERIFIED},
    Status.RETRACTED: {Status.CONTESTED},  # only re-evaluation, never silent revival
    Status.VERIFIED: {Status.CONTESTED, Status.RETRACTED},
}


class Message(BaseModel):
    """The wire format exchanged between Agent A (Solver) and Agent B (Critic)."""

    model_config = {"extra": "forbid"}

    message_id: str = Field(default_factory=lambda: new_id("msg"))
    run_id: str
    task_id: str
    sender: Sender
    target: Target
    message_type: MessageType
    content: str = Field(..., min_length=1)
    rationale: str = Field(default="")
    # Range [0, 1] is enforced as a *semantic* check (app.runtime.validation),
    # not a pydantic constraint: an out-of-range number is syntactically valid
    # JSON matching the schema's type, just semantically malformed (§9).
    confidence: float
    evidence_ids: list[str] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)
    contradicts: list[str] = Field(default_factory=list)
    supersedes: list[str] = Field(default_factory=list)
    status: Status
    requested_action: Optional[str] = None
    created_at: str = Field(default_factory=utcnow_iso)

    @field_validator("confidence")
    @classmethod
    def _finite_confidence(cls, v: float) -> float:
        if v != v:  # NaN check without importing math
            raise ValueError("confidence must not be NaN")
        return v


def message_json_schema() -> dict:
    return Message.model_json_schema()
