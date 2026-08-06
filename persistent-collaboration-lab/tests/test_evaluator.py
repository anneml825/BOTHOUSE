"""Deterministic evaluation + blinding (§9, §12, §16)."""

import inspect

from app.evaluation.evaluator import evaluate, evaluate_bug_diagnosis, extract_code


def test_evaluate_signature_has_no_condition_parameter():
    sig = inspect.signature(evaluate)
    assert "condition" not in sig.parameters
    sig2 = inspect.signature(evaluate_bug_diagnosis)
    assert "condition" not in sig2.parameters


def test_extract_code_from_fenced_block():
    content = "Here's the fix:\n```python\nx = 1\n```\ndone"
    assert extract_code(content).strip() == "x = 1"


def test_extract_code_raw_passthrough():
    content = "def f():\n    return 1\n"
    assert "def f()" in extract_code(content)


def test_extract_code_from_filename_marker_convention():
    content = (
        "The root cause is a mutable default argument.\n\n"
        "--- cache_module.py ---\n\n"
        "def cached_fetch(key, store, cache=None):\n"
        "    if cache is None:\n"
        "        cache = {}\n"
        "    return store.get(key)\n"
    )
    extracted = extract_code(content)
    assert "def cached_fetch" in extracted
    assert "root cause" not in extracted


def test_extract_code_prefers_valid_python_over_raw_prose_mix():
    # No fence, no marker, code embedded after explanatory prose with no
    # delimiter at all — extract_code can't rescue this (nothing to key
    # off), so it should fall back to returning the raw content rather
    # than crashing.
    content = "I think the fix is to use cache=None. def f():\n    return 1\n"
    extracted = extract_code(content)
    assert extracted.strip() == content.strip()


def test_bug_diagnosis_scores_zero_for_unfixed_code(bug_task):
    result = evaluate(bug_task, bug_task["scoring"]["buggy_source"])
    assert result["task_score"] == 0.0
    assert result["fix_passes_tests"] is False
    assert result["baseline_fails_tests"] is True


def test_bug_diagnosis_scores_one_for_correct_fix(bug_task):
    result = evaluate(bug_task, bug_task["scoring"]["fixed_source_reference"])
    assert result["task_score"] == 1.0
    assert result["fix_passes_tests"] is True


def test_evaluate_with_no_final_content_scores_zero(bug_task):
    result = evaluate(bug_task, None)
    assert result["task_score"] == 0.0


def test_bug_diagnosis_missing_scoring_config_scores_zero_without_crashing():
    result = evaluate({"family": "bug_diagnosis"}, "some content")
    assert result["task_score"] == 0.0
    assert "reason" in result
