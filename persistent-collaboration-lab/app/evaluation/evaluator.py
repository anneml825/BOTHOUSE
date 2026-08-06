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


EVALUATORS = {
    "bug_diagnosis": evaluate_bug_diagnosis,
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
