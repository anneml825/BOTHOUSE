"""Local dashboard (§13). FastAPI JSON API + a single minimal HTML/JS page.

The false-evidence injection marker (`injected_false_evidence`,
`is_injected_false`) is only ever returned when `?admin=1` is passed —
that's the dashboard's evaluator/admin mode gate. Everything else (raw and
structured message views, claims, dependency graph, contested/retracted
claims, status propagation, unresolved questions, validation failures,
token/cost usage, final evaluation, cross-condition comparison, audit mode)
is visible without it.
"""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, JSONResponse

from app.evaluation.analysis import build_comparison_report
from app.runtime.replay import turn_by_turn_audit, verify_replay_matches_live_state

DB_PATH = os.environ.get("LAB_DB_PATH", "results/lab.sqlite3")
UI_INDEX = Path(__file__).resolve().parents[1] / "ui" / "index.html"

app = FastAPI(title="Persistent Collaboration Lab Dashboard")


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _rows(cur) -> list[dict]:
    return [dict(r) for r in cur]


@app.get("/")
def index():
    return FileResponse(UI_INDEX)


@app.get("/api/runs")
def list_runs(admin: int = Query(0)):
    conn = _conn()
    runs = _rows(conn.execute("SELECT * FROM runs ORDER BY started_at DESC"))
    if not admin:
        for r in runs:
            r.pop("injection_type", None)
            r["injection_enabled"] = False if not admin else r["injection_enabled"]
    return runs


@app.get("/api/runs/{run_id}")
def run_detail(run_id: str, admin: int = Query(0)):
    conn = _conn()
    run = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    if run is None:
        return JSONResponse({"error": "not found"}, status_code=404)
    run = dict(run)

    messages = _rows(conn.execute("SELECT * FROM messages WHERE run_id = ? ORDER BY turn_index", (run_id,)))
    claims = _rows(conn.execute("SELECT * FROM claims WHERE run_id = ?", (run_id,)))
    dependencies = _rows(conn.execute("SELECT * FROM dependencies WHERE run_id = ?", (run_id,)))
    contradictions = _rows(conn.execute("SELECT * FROM contradictions WHERE run_id = ?", (run_id,)))
    status_history = _rows(conn.execute("SELECT * FROM status_history WHERE run_id = ? ORDER BY seq", (run_id,)))
    questions = _rows(conn.execute("SELECT * FROM questions WHERE run_id = ?", (run_id,)))
    decisions = _rows(conn.execute("SELECT * FROM decisions WHERE run_id = ?", (run_id,)))
    validation_failures = _rows(conn.execute("SELECT * FROM validation_failures WHERE run_id = ?", (run_id,)))
    context_log = _rows(conn.execute("SELECT * FROM context_log WHERE run_id = ? ORDER BY turn_index", (run_id,)))
    evaluations = _rows(conn.execute("SELECT * FROM evaluations WHERE run_id = ?", (run_id,)))
    evidence = _rows(conn.execute("SELECT * FROM evidence WHERE run_id = ?", (run_id,)))
    raw_outputs = _rows(conn.execute("SELECT * FROM raw_model_outputs WHERE run_id = ? ORDER BY turn_index", (run_id,)))

    injected = []
    if admin:
        injected = _rows(conn.execute("SELECT * FROM injected_false_evidence WHERE run_id = ?", (run_id,)))
    else:
        for e in evidence:
            e.pop("is_injected_false", None)

    matches, mismatches = verify_replay_matches_live_state(conn, run_id)

    return {
        "run": run, "messages": messages, "claims": claims, "dependencies": dependencies,
        "contradictions": contradictions, "status_history": status_history, "questions": questions,
        "decisions": decisions, "validation_failures": validation_failures, "context_log": context_log,
        "evaluations": evaluations, "evidence": evidence, "raw_outputs": raw_outputs,
        "injected_false_evidence": injected,
        "replay_check": {"matches": matches, "mismatches": mismatches},
    }


@app.get("/api/runs/{run_id}/audit")
def run_audit(run_id: str):
    conn = _conn()
    return turn_by_turn_audit(conn, run_id)


@app.get("/api/comparison")
def comparison(stage: str = Query("plumbing_only")):
    conn = _conn()
    runs = _rows(conn.execute("SELECT run_id, condition FROM runs WHERE stage = ?", (stage,)))
    by_condition: dict[str, list[str]] = {"A": [], "B": [], "C": []}
    for r in runs:
        by_condition.setdefault(r["condition"], []).append(r["run_id"])
    report = build_comparison_report(conn, by_condition, stage=stage, label="dashboard live comparison")
    return report.to_dict()
