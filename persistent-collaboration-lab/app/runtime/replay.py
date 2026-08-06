"""Deterministic state reconstruction from event history (§6, §16).

`status_history` is append-only and is the authoritative event log for
every claim's status. Replaying it in `seq` order — independent of the
mutable `claims.status` / `claims.dependency_warning` columns — must
produce exactly what those columns currently hold. This is both the
mechanism behind the dashboard's "audit mode" (turn-by-turn reconstruction)
and a correctness property tests assert directly.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field


@dataclass
class ReplayedClaim:
    claim_id: str
    status: str
    dependency_warning: bool
    history: list[dict] = field(default_factory=list)


def reconstruct_claims(conn: sqlite3.Connection, run_id: str) -> dict[str, ReplayedClaim]:
    rows = conn.execute(
        "SELECT * FROM status_history WHERE run_id = ? AND entity_type = 'claim' ORDER BY seq ASC",
        (run_id,),
    )
    claims: dict[str, ReplayedClaim] = {}
    for row in rows:
        cid = row["entity_id"]
        if cid not in claims:
            claims[cid] = ReplayedClaim(claim_id=cid, status=row["new_status"], dependency_warning=bool(row["new_dependency_warning"]))
        claim = claims[cid]
        claim.status = row["new_status"]
        claim.dependency_warning = bool(row["new_dependency_warning"])
        claim.history.append({
            "seq": row["seq"], "old_status": row["old_status"], "new_status": row["new_status"],
            "reason": row["reason"], "caused_by_dependency_id": row["caused_by_dependency_id"],
            "caused_by_message_id": row["caused_by_message_id"], "created_at": row["created_at"],
        })
    return claims


def verify_replay_matches_live_state(conn: sqlite3.Connection, run_id: str) -> tuple[bool, list[str]]:
    """Returns (matches, mismatches) comparing the replayed reconstruction
    against the live `claims` table for this run."""
    replayed = reconstruct_claims(conn, run_id)
    live_rows = conn.execute("SELECT * FROM claims WHERE run_id = ?", (run_id,))
    mismatches: list[str] = []
    seen = set()
    for row in live_rows:
        seen.add(row["claim_id"])
        rep = replayed.get(row["claim_id"])
        if rep is None:
            mismatches.append(f"{row['claim_id']}: no replay history but exists live")
            continue
        if rep.status != row["status"]:
            mismatches.append(f"{row['claim_id']}: status live={row['status']} replayed={rep.status}")
        if rep.dependency_warning != bool(row["dependency_warning"]):
            mismatches.append(
                f"{row['claim_id']}: dependency_warning live={bool(row['dependency_warning'])} replayed={rep.dependency_warning}"
            )
    for cid in replayed:
        if cid not in seen:
            mismatches.append(f"{cid}: replayed but missing from live claims table")
    return (len(mismatches) == 0, mismatches)


def turn_by_turn_audit(conn: sqlite3.Connection, run_id: str) -> list[dict]:
    """Chronological reconstruction for the dashboard's audit mode: each
    message alongside the state_history events it caused, in the order
    they actually happened."""
    messages = list(conn.execute("SELECT * FROM messages WHERE run_id = ? ORDER BY turn_index ASC", (run_id,)))
    history = list(conn.execute("SELECT * FROM status_history WHERE run_id = ? ORDER BY seq ASC", (run_id,)))
    steps = []
    for m in messages:
        caused = [
            dict(h) for h in history
            if h["caused_by_message_id"] == m["message_id"]
        ]
        steps.append({"message": dict(m), "caused_events": caused})
    return steps
