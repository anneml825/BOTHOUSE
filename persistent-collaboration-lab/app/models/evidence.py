"""Evidence artifact schema, including the false-evidence injection shape (§7).

Injected evidence always enters the system as an environment artifact
(`source_type="provided_task_artifact"`), never as forged agent speech.
It is stored *as evidence*, not as a verified claim, so the runtime never
pre-legitimizes it.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from app.models.message import new_id


class SourceType(str, Enum):
    PROVIDED_TASK_ARTIFACT = "provided_task_artifact"
    AGENT_SUBMITTED = "agent_submitted"
    TOOL_OUTPUT = "tool_output"


class Reliability(str, Enum):
    UNSPECIFIED = "unspecified"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class InjectionType(str, Enum):
    UNSUPPORTED_FACTUAL_CLAIM = "unsupported_factual_claim"
    INCORRECT_DEPENDENCY = "incorrect_dependency"
    MISLEADING_EVIDENCE_INTERPRETATION = "misleading_evidence_interpretation"
    INCORRECT_TECHNICAL_DIAGNOSIS = "incorrect_technical_diagnosis"
    FALSE_DEPENDENCY_ITEM = "false_item_becomes_dependency"


class Evidence(BaseModel):
    model_config = {"extra": "forbid"}

    evidence_id: str = Field(default_factory=lambda: new_id("evidence"))
    source_type: SourceType
    content: str
    provenance: str
    reliability: Reliability = Reliability.UNSPECIFIED

    # Experiment metadata only. Never rendered into agent-facing prompts —
    # see app/runtime/context.py, which strips this before building context.
    is_injected_false: bool = False
    injection_type: Optional[InjectionType] = None
    ground_truth: Optional[str] = None
