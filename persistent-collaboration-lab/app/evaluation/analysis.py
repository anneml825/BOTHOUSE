"""Cross-condition comparison (§12).

Reports means/medians/SDs and paired comparisons where a matched pair
exists (clean vs. injected). Deliberately does not compute or print
p-values / significance claims — pilot sample sizes don't support that
(§12: "Do not claim statistical significance at pilot sample sizes").
Every report is labeled with its stage so a `plumbing_only` comparison can
never be mistaken for evidence about the research hypothesis.
"""

from __future__ import annotations

import sqlite3
import statistics
from dataclasses import asdict, dataclass, field


@dataclass
class ConditionSummary:
    condition: str
    n_runs: int
    mean_task_score: float
    median_task_score: float
    sd_task_score: float
    mean_tokens: float
    mean_cost_usd: float
    accuracy_per_1000_tokens: float
    cost_per_successful_task: float | None
    schema_failure_rate: float
    mean_turns_to_correction: float | None
    mean_downstream_contamination: float | None


def _mean(xs: list[float]) -> float:
    return statistics.fmean(xs) if xs else 0.0


def _sd(xs: list[float]) -> float:
    return statistics.pstdev(xs) if len(xs) > 1 else 0.0


def summarize_condition(conn: sqlite3.Connection, run_ids: list[str]) -> ConditionSummary:
    if not run_ids:
        raise ValueError("no runs to summarize")
    placeholders = ",".join("?" for _ in run_ids)

    condition_row = conn.execute(f"SELECT condition FROM runs WHERE run_id IN ({placeholders})", run_ids).fetchone()
    condition = condition_row["condition"] if condition_row else "?"

    scores = [
        row["task_score"] for row in conn.execute(
            f"SELECT task_score FROM evaluations WHERE run_id IN ({placeholders})", run_ids
        )
    ]
    token_counts = []
    costs = []
    schema_failures = 0
    total_turns_with_output = 0
    for rid in run_ids:
        t = conn.execute(
            "SELECT COALESCE(SUM(prompt_tokens+completion_tokens+repair_tokens),0) AS t FROM raw_model_outputs WHERE run_id=?",
            (rid,),
        ).fetchone()["t"]
        token_counts.append(t)
        rows = list(conn.execute("SELECT provider_cost_usd FROM raw_model_outputs WHERE run_id=?", (rid,)))
        costs.append(sum(r["provider_cost_usd"] for r in rows))
        fails = conn.execute(
            "SELECT COUNT(*) AS c FROM raw_model_outputs WHERE run_id=? AND schema_validation_passed=0", (rid,)
        ).fetchone()["c"]
        total = conn.execute("SELECT COUNT(*) AS c FROM raw_model_outputs WHERE run_id=?", (rid,)).fetchone()["c"]
        schema_failures += fails
        total_turns_with_output += total

    successful_costs = [c for c, s in zip(costs, scores) if s >= 1.0]
    # Correction-latency metrics (turns/tokens-to-correction, downstream
    # contamination) come from app.experiments.injection.compute_correction_metrics,
    # not from a durable table — callers that have run reports in hand pass
    # per-condition aggregates in separately; this DB-only summary leaves
    # those two fields as None rather than guessing at a shape.
    return ConditionSummary(
        condition=condition,
        n_runs=len(run_ids),
        mean_task_score=_mean(scores),
        median_task_score=statistics.median(scores) if scores else 0.0,
        sd_task_score=_sd(scores),
        mean_tokens=_mean(token_counts),
        mean_cost_usd=_mean(costs),
        accuracy_per_1000_tokens=(_mean(scores) / (_mean(token_counts) / 1000)) if _mean(token_counts) > 0 else 0.0,
        cost_per_successful_task=(_mean(successful_costs) if successful_costs else None),
        schema_failure_rate=(schema_failures / total_turns_with_output) if total_turns_with_output else 0.0,
        mean_turns_to_correction=None,
        mean_downstream_contamination=None,
    )


@dataclass
class ComparisonReport:
    stage: str
    label: str
    conditions: dict = field(default_factory=dict)  # condition -> ConditionSummary as dict
    paired_contamination: dict = field(default_factory=dict)  # condition -> list of {clean, injected, delta}
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "stage": self.stage,
            "label": self.label,
            "conditions": self.conditions,
            "paired_contamination": self.paired_contamination,
            "notes": self.notes,
        }


def build_comparison_report(
    conn: sqlite3.Connection, runs_by_condition: dict[str, list[str]], stage: str, label: str,
    matched_pairs: dict[str, list[tuple[str, str]]] | None = None,
) -> ComparisonReport:
    """`matched_pairs`: condition -> list of (clean_run_id, injected_run_id)."""
    report = ComparisonReport(stage=stage, label=label, notes=[
        "Pilot-scale report: means/medians only, no significance testing (see README limitations).",
        f"Labeled stage={stage} — only 'experimental_pilot' results should ever inform the research hypothesis.",
    ])
    for cond, run_ids in runs_by_condition.items():
        if run_ids:
            report.conditions[cond] = asdict(summarize_condition(conn, run_ids))

    if matched_pairs:
        for cond, pairs in matched_pairs.items():
            deltas = []
            for clean_id, injected_id in pairs:
                clean_score = conn.execute("SELECT task_score FROM evaluations WHERE run_id=?", (clean_id,)).fetchone()
                inj_score = conn.execute("SELECT task_score FROM evaluations WHERE run_id=?", (injected_id,)).fetchone()
                clean_v = clean_score["task_score"] if clean_score else None
                inj_v = inj_score["task_score"] if inj_score else None
                delta = (inj_v - clean_v) if (clean_v is not None and inj_v is not None) else None
                deltas.append({"clean_run_id": clean_id, "injected_run_id": injected_id, "clean_score": clean_v, "injected_score": inj_v, "delta": delta})
            report.paired_contamination[cond] = deltas
    return report
