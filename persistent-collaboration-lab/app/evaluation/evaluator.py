"""Deterministic evaluation (§12): prefer test execution / answer keys over
a model judge. Nothing here takes a `condition` argument — the evaluator is
structurally blinded, not just instructed to ignore the label (§12: "blinded
to condition"). A model judge is not wired in for the v0.1 task suite
because every task family here scores deterministically; §8/§12 reserve it
for "genuinely ambiguous residue" only.
"""

from __future__ import annotations

import ast
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

CODE_FENCE_RE = re.compile(r"```(?:python)?\s*\n(.*?)```", re.DOTALL)
# A real model prompted with "--- filename ---" (this task's own convention
# for presenting source, see tasks/bug_diagnosis/*/task.json's `prompt`)
# tends to echo that convention back instead of markdown fences.
FILENAME_MARKER_RE = re.compile(r"^-{2,}\s*\S+\.\w+\s*-{2,}\s*$", re.MULTILINE)


def _is_valid_python(source: str) -> bool:
    try:
        ast.parse(source)
        return True
    except SyntaxError:
        return False


def extract_code(content: str) -> str:
    """Structured (B/C) decisions carry raw source directly in `content`.
    Prose (Condition A, or a real model mixing explanation with code
    despite instructions not to) may wrap or precede the same source with
    a markdown fence or a "--- filename ---" marker. Rather than assume
    one specific convention, try each candidate extraction and keep the
    first one that's actually valid Python — syntactic validity is a
    representation-agnostic signal a raw regex guess isn't."""
    candidates = [m.strip() for m in CODE_FENCE_RE.findall(content)]
    markers = list(FILENAME_MARKER_RE.finditer(content))
    if markers:
        candidates.append(content[markers[-1].end():].strip())
    candidates.append(content.strip())

    for candidate in candidates:
        if candidate and _is_valid_python(candidate):
            return candidate + "\n"
    # Nothing parsed cleanly — return the best guess (fenced/marker over
    # raw) so the caller still gets a deterministic, legible test failure
    # rather than a crash; a genuinely incomplete answer should score 0,
    # not error out.
    return (candidates[0] if candidates else content).strip() + "\n"


def run_pytest_patch(module_filename: str, module_source: str, test_filename: str, test_source: str) -> dict:
    with tempfile.TemporaryDirectory() as d:
        d_path = Path(d)
        (d_path / module_filename).write_text(module_source)
        (d_path / test_filename).write_text(test_source)
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pytest", "-q", test_filename],
                cwd=d, capture_output=True, text=True, timeout=30,
            )
        except subprocess.TimeoutExpired as e:
            return {"passed": False, "output": f"timeout: {e}", "returncode": -1}
        return {
            "passed": result.returncode == 0,
            "output": (result.stdout + result.stderr)[-4000:],
            "returncode": result.returncode,
        }


def evaluate_bug_diagnosis(task_definition: dict, final_content: str) -> dict:
    scoring = task_definition.get("scoring")
    if not scoring:
        # A malformed/incomplete task definition shouldn't crash the run —
        # it should score 0 with a legible reason, same as "no final
        # decision produced" (see evaluate() below).
        return {"task_score": 0.0, "objective_score": 0.0, "model_judge_score": None, "reason": "task definition has no scoring config"}
    candidate_source = extract_code(final_content)
    outcome = run_pytest_patch(
        scoring["module_filename"], candidate_source,
        scoring["test_filename"], scoring["test_source"],
    )
    baseline = run_pytest_patch(
        scoring["module_filename"], scoring["buggy_source"],
        scoring["test_filename"], scoring["test_source"],
    )
    task_score = 1.0 if outcome["passed"] else 0.0
    return {
        "task_score": task_score,
        "objective_score": task_score,
        "model_judge_score": None,
        "fix_passes_tests": outcome["passed"],
        "baseline_fails_tests": not baseline["passed"],
        "test_output": outcome["output"],
    }


def evaluate_evidence_synthesis(task_definition: dict, final_content: str) -> dict:
    """Programmatic scoring per §8: atomic_fact_key/acceptable_paraphrases
    (did the answer state the right fact, in any accepted wording),
    required_evidence_mapping (did it cite evidence that actually supports
    that fact, not just assert it), unsupported_claim_rules (did it avoid
    asserting a specifically-flagged wrong claim).

    `contradiction_pairs` is present in every evidence_synthesis task's
    scoring config (§8 requires the packet to define which evidence items
    conflict) but is not yet enforced here — checking whether the *agents*
    correctly recognized a conflict during the conversation, rather than
    just whether the final answer is right, needs the full message history,
    not just final_content. Recorded as a known v0.1 scope gap, not silently
    dropped: see DESIGN_HISTORY.md.
    """
    scoring = task_definition.get("scoring")
    if not scoring:
        return {"task_score": 0.0, "objective_score": 0.0, "model_judge_score": None, "reason": "task definition has no scoring config"}

    content_lower = final_content.lower()

    paraphrases = scoring.get("acceptable_paraphrases", [])
    correct_fact_present = any(p.lower() in content_lower for p in paraphrases)

    forbidden_patterns = scoring.get("unsupported_claim_rules", {}).get("forbidden_patterns", [])
    forbidden_hit = [p for p in forbidden_patterns if p.lower() in content_lower]

    # Citation checking must not assume the bracketed [evidence-id] style —
    # that's a structured (B/C) convention. Condition A's system prompt
    # explicitly forbids "structured markup" in its prose, so a real
    # Condition A answer legitimately references evidence by describing it
    # ("the pricing page") rather than by ID. `citation_keywords` lets a
    # task register those natural-language equivalents per evidence_id;
    # falling back to the bare ID keeps prior tasks without it working.
    citation_keywords = scoring.get("citation_keywords", {})
    required_ids = scoring.get("required_evidence_mapping", [])
    required_evidence_cited = any(
        eid.lower() in content_lower or any(kw.lower() in content_lower for kw in citation_keywords.get(eid, []))
        for eid in required_ids
    ) if required_ids else True

    task_score = 1.0 if (correct_fact_present and required_evidence_cited and not forbidden_hit) else 0.0
    return {
        "task_score": task_score,
        "objective_score": task_score,
        "model_judge_score": None,
        "correct_fact_present": correct_fact_present,
        "required_evidence_cited": required_evidence_cited,
        "forbidden_claims_present": forbidden_hit,
    }


ASSIGNMENT_LINE_RE = re.compile(r"task\s+([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_]+)", re.IGNORECASE)


def _parse_assignment(content: str) -> dict[str, str]:
    """Extracts a `Task <name>: <slot>` assignment from free text. Works for
    both a structured decision's plain content and Condition A prose that
    states the plan in the same "Task X: Slot" shorthand — the task prompt
    asks for this format explicitly so parsing doesn't need to guess."""
    assignment: dict[str, str] = {}
    for task_name, slot in ASSIGNMENT_LINE_RE.findall(content):
        assignment[task_name.capitalize()] = slot.capitalize()
    return assignment


def _check_hard_constraints(assignment: dict[str, str], hard_constraints: list[dict], slot_order: list[str]) -> list[str]:
    violations = []
    for c in hard_constraints:
        if c["type"] == "not_equal":
            if assignment.get(c["task"]) == c["slot"]:
                violations.append(f"{c['task']} must not be scheduled in {c['slot']}")
        elif c["type"] == "before":
            earlier, later = c["earlier"], c["later"]
            if earlier not in assignment or later not in assignment:
                violations.append(f"{earlier} or {later} missing from assignment")
            elif slot_order.index(assignment[earlier]) >= slot_order.index(assignment[later]):
                violations.append(f"{earlier} must be scheduled before {later}")
        elif c["type"] == "all_distinct":
            slots = list(assignment.values())
            if len(slots) != len(set(slots)):
                violations.append("all tasks must be assigned distinct slots")
    return violations


def _compute_utility(assignment: dict[str, str], soft_constraints: list[dict]) -> float:
    return sum(c["weight"] for c in soft_constraints if assignment.get(c["task"]) == c["slot"])


def evaluate_constraint_planning(task_definition: dict, final_content: str) -> dict:
    """Programmatic scoring per §8: hard constraints satisfied (all-or-
    nothing gate), utility score against soft preferences, and whether the
    final plan covers every task the scoring config expects. `task_score`
    is 1.0 only when hard constraints hold AND utility matches the known-
    optimal value — a hard-valid but suboptimal plan is a real, distinct
    outcome (recorded in `hard_constraints_satisfied`/`utility_score`), not
    silently rounded up to a pass."""
    scoring = task_definition.get("scoring")
    if not scoring:
        return {"task_score": 0.0, "objective_score": 0.0, "model_judge_score": None, "reason": "task definition has no scoring config"}

    assignment = _parse_assignment(final_content)
    task_list = scoring.get("task_list", [])
    missing_tasks = [t for t in task_list if t not in assignment]

    violations = _check_hard_constraints(assignment, scoring.get("hard_constraints", []), scoring.get("slot_order", []))
    hard_constraints_satisfied = not violations and not missing_tasks
    utility_score = _compute_utility(assignment, scoring.get("soft_constraints", [])) if hard_constraints_satisfied else 0.0
    max_utility = scoring.get("max_utility", 0)

    task_score = 1.0 if (hard_constraints_satisfied and utility_score >= max_utility) else 0.0
    return {
        "task_score": task_score,
        "objective_score": task_score,
        "model_judge_score": None,
        "parsed_assignment": assignment,
        "missing_tasks": missing_tasks,
        "hard_constraint_violations": violations,
        "hard_constraints_satisfied": hard_constraints_satisfied,
        "utility_score": utility_score,
        "max_utility": max_utility,
    }


EVALUATORS = {
    "bug_diagnosis": evaluate_bug_diagnosis,
    "evidence_synthesis": evaluate_evidence_synthesis,
    "constraint_planning": evaluate_constraint_planning,
}


def evaluate(task_definition: dict, final_content: Optional[str]) -> dict:
    """Blinded by construction: no `condition` parameter exists to leak."""
    family = task_definition["family"]
    if final_content is None:
        return {"task_score": 0.0, "objective_score": 0.0, "model_judge_score": None, "reason": "no final decision produced"}
    evaluator_fn = EVALUATORS.get(family)
    if evaluator_fn is None:
        raise NotImplementedError(f"no evaluator registered for task family {family!r}")
    return evaluator_fn(task_definition, final_content)
