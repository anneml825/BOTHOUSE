"""Loads task definitions and builds condition-specific material/mock queues.

A task JSON file has (at minimum):
  task_id, family, name, prompt, evidence_pool, injected_evidence,
  scoring: {module_filename, test_filename, buggy_source, test_source},
  mock_script: {"clean": [...turns...], "injected": [...turns...]}

Each turn in a mock_script variant is:
  {role, message_type, content, rationale, confidence, status,
   evidence_ids, depends_on, contradicts, supersedes, requested_action, prose}
`depends_on`/`contradicts`/`supersedes` use symbolic refs ("T0", "T1", ...)
resolved to real message_ids at render time via a shared `refs` dict the
orchestrator fills in turn by turn (see app.agents.mock_adapter.MockAdapter).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Callable

TASKS_DIR = Path(__file__).resolve().parents[2] / "tasks"


def load_task(task_id: str, tasks_dir: Path | None = None) -> dict:
    base = Path(tasks_dir) if tasks_dir is not None else TASKS_DIR
    for family_dir in base.iterdir():
        candidate = family_dir / task_id / "task.json"
        if candidate.exists():
            with open(candidate) as f:
                return json.load(f)
    raise FileNotFoundError(f"task {task_id!r} not found under {base}")


def task_version_hash(definition: dict) -> str:
    canonical = json.dumps(definition, sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


def evidence_pool_for_run(definition: dict, include_injected: bool) -> list[dict]:
    pool = list(definition.get("evidence_pool", []))
    if include_injected and definition.get("injected_evidence"):
        pool = pool + [definition["injected_evidence"]]
    return pool


def build_task_material(definition: dict, include_injected: bool) -> str:
    """Task material text shown to agents. The injected artifact's wording,
    placement (always last in the evidence list), and surrounding text are
    identical across conditions A/B/C for a given run — only whether it's
    present at all varies, between a run's matched clean/injected pair."""
    lines = [definition["prompt"], "", "Provided materials:"]
    for ev in evidence_pool_for_run(definition, include_injected):
        # The real evidence_id must be shown, or a real model has no way to
        # cite it in evidence_ids and every citation attempt is a doomed
        # guess — semantic validation (unknown evidence_id) would then fire
        # on every real run regardless of the claim's actual merits, and
        # correction-metric detection (which keys off evidence_ids citing
        # the injected evidence_id) could never register real exposure.
        lines.append(f"[{ev['evidence_id']}] ({ev['source_type']}, provenance: {ev['provenance']}) {ev['content']}")
    return "\n".join(lines)


def render_turn(turn_spec: dict, condition: str, refs: dict[str, str]) -> str:
    if condition == "A":
        return turn_spec["prose"]
    payload = {
        "message_type": turn_spec["message_type"],
        "content": turn_spec["content"],
        "rationale": turn_spec.get("rationale", ""),
        "confidence": turn_spec["confidence"],
        "evidence_ids": turn_spec.get("evidence_ids", []),
        "depends_on": [refs.get(r, r) for r in turn_spec.get("depends_on", [])],
        "contradicts": [refs.get(r, r) for r in turn_spec.get("contradicts", [])],
        "supersedes": [refs.get(r, r) for r in turn_spec.get("supersedes", [])],
        "status": turn_spec["status"],
        "requested_action": turn_spec.get("requested_action"),
    }
    return json.dumps(payload)


def build_mock_queue(
    definition: dict, condition: str, variant: str, refs: dict[str, str],
) -> list[Callable[[], str]]:
    script = definition["mock_script"][variant]
    queue: list[Callable[[], str]] = []
    for turn_spec in script:
        # Late-binding closure: capture turn_spec by default arg, not by
        # reference, so each thunk renders its own turn.
        queue.append(lambda ts=turn_spec: render_turn(ts, condition, refs))
    return queue


def turn_roles(definition: dict, variant: str) -> list[str]:
    return [t["role"] for t in definition["mock_script"][variant]]


def resolve_refs(turn_spec: dict, refs: dict[str, str]) -> dict:
    """Resolve symbolic turn references ("T0", ...) to real message_ids —
    used when building a Message directly for Condition A (whose agent
    output is prose, so there's no JSON to parse the relations out of;
    they're carried as ground-truth scenario annotation instead)."""
    return {
        "depends_on": [refs.get(r, r) for r in turn_spec.get("depends_on", [])],
        "contradicts": [refs.get(r, r) for r in turn_spec.get("contradicts", [])],
        "supersedes": [refs.get(r, r) for r in turn_spec.get("supersedes", [])],
    }
