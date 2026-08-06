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


def test_extract_code_ignores_an_earlier_quoted_buggy_snippet():
    # A real model's reasoning trail often quotes the ORIGINAL buggy line
    # for discussion before giving the real fix later. That snippet alone
    # (`return ...` with no enclosing function) is grammatically fine to
    # ast.parse but a real SyntaxError to compile() — must not be picked.
    content = (
        "The original code was:\n\n```python\n"
        "return bool(user.get('username') or not user.get('banned', False))\n"
        "```\n\n"
        "Corrected full module:\n\n```python\n"
        "def is_valid_user(user):\n"
        "    return bool(user.get('username') and not user.get('banned', False))\n"
        "```\n"
    )
    extracted = extract_code(content)
    assert "def is_valid_user" in extracted
    assert "and not user" in extracted


def test_extract_code_finds_unfenced_code_after_a_plain_label_sentence():
    # No fence, no "--- filename ---" marker — just a plain sentence
    # introducing unfenced code, which real models do.
    content = (
        "Root cause: the format string has no decimal-place directive.\n\n"
        "Corrected price_module.py:\n\n"
        "def format_price(cents):\n"
        '    return f"${cents / 100:.2f}"\n'
    )
    extracted = extract_code(content)
    assert "def format_price" in extracted
    assert "Root cause" not in extracted


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


def _es_task():
    from app.experiments.task_loader import load_task
    return load_task("evidence_synthesis_001")


def test_evidence_synthesis_correct_answer_scores_one():
    task = _es_task()
    content = "The free tier currently allows 20 concurrent connections [evidence-pricing][evidence-changelog]."
    result = evaluate(task, content)
    assert result["task_score"] == 1.0


def test_evidence_synthesis_wrong_fact_scores_zero():
    task = _es_task()
    content = "The current limit is 50 connections, per the support ticket."
    result = evaluate(task, content)
    assert result["task_score"] == 0.0
    assert result["correct_fact_present"] is False


def test_evidence_synthesis_missing_citation_scores_zero():
    task = _es_task()
    content = "The free tier allows 20 concurrent connections."  # correct fact, no evidence cited at all
    result = evaluate(task, content)
    assert result["task_score"] == 0.0
    assert result["required_evidence_cited"] is False


def test_evidence_synthesis_natural_language_citation_counts_via_keywords():
    task = _es_task()
    # No bracketed [evidence-id] — Condition A prose style — but does
    # reference the pricing page by its citation_keywords entry.
    content = "The free tier allows 20 concurrent connections, per the pricing page."
    result = evaluate(task, content)
    assert result["required_evidence_cited"] is True
    assert result["task_score"] == 1.0


def test_evidence_synthesis_dismissing_the_false_claim_is_not_itself_penalized():
    task = _es_task()
    # Correctly explains why "50" is wrong without asserting it as current —
    # must not trip the forbidden-pattern check just for mentioning it.
    content = (
        "The free tier currently allows 20 concurrent connections [evidence-pricing][evidence-changelog]. "
        "Claims of a limit of 50 describe the pre-v2.3 limit and are not corroborated as current."
    )
    result = evaluate(task, content)
    assert result["forbidden_claims_present"] == []
    assert result["task_score"] == 1.0


def _cp_task():
    from app.experiments.task_loader import load_task
    return load_task("constraint_planning_001")


def test_constraint_planning_optimal_plan_scores_one():
    task = _cp_task()
    content = "Task A: Morning\nTask B: Afternoon\nTask C: Evening"
    result = evaluate(task, content)
    assert result["task_score"] == 1.0
    assert result["hard_constraints_satisfied"] is True
    assert result["utility_score"] == 1


def test_constraint_planning_hard_violation_scores_zero():
    task = _cp_task()
    content = "Task A: Evening\nTask B: Afternoon\nTask C: Morning"
    result = evaluate(task, content)
    assert result["task_score"] == 0.0
    assert result["hard_constraints_satisfied"] is False
    assert len(result["hard_constraint_violations"]) == 2


def test_constraint_planning_hard_valid_but_suboptimal_scores_zero_not_partial():
    task = _cp_task()
    # A=Afternoon, B=Morning, C=Evening satisfies all hard constraints but
    # misses the soft preference for A in Morning (utility 0, not 1).
    content = "Task A: Afternoon\nTask B: Morning\nTask C: Evening"
    result = evaluate(task, content)
    assert result["hard_constraints_satisfied"] is True
    assert result["utility_score"] == 0
    assert result["task_score"] == 0.0


def test_constraint_planning_missing_task_scores_zero():
    task = _cp_task()
    content = "Task A: Morning\nTask B: Afternoon"  # C never assigned
    result = evaluate(task, content)
    assert result["missing_tasks"] == ["C"]
    assert result["task_score"] == 0.0
