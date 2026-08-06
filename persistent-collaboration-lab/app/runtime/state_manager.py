"""Condition C's persistent shared state: claims, dependencies, contradictions,
status propagation, verification. This is the piece that Conditions A and B
deliberately do not have.

Design choice: every structured message mints exactly one row in `claims`
(claim_id == message_id), since the schema defines `content` as "the
concise primary communicative commitment" for every message type, not just
`claim`/`answer`. `message_type` still distinguishes conversational acts
(question, critique, evidence) from propositions eligible for final-answer
extraction (see `CLAIM_BEARING_TYPES`) — but structurally, uniform rows keep
dependency/contradiction edges simple (every edge endpoint is a real row,
no special-casing by message type).

Propagation rules implemented exactly per spec (§6):
  * dependency becomes contested -> every direct dependent contested,
    dependency_warning=True, no auto-retract, propagates transitively.
  * dependency retracted -> every direct AND transitive dependent contested,
    dependency_warning=True, no auto-retract. Returning to
    supported/verified requires an explicit verification action.
  * dependency restored/superseded -> no auto-restore of dependents; they
    are merely eligible for re-evaluation.
  * cycles are detected and rejected before the edge is ever written.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from app.models.message import Message, MessageType, Status, new_id


class CycleError(Exception):
    """Raised when a proposed dependency edge would create a cycle."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class IngestResult:
    claim_id: str
    status: Status
    contradiction_edges: list[str]
    dependency_edges: list[str]
    rejected_cycles: list[str]
    propagated_contested: list[str]
    propagated_retracted: list[str]


class StateManager:
    def __init__(self, conn: sqlite3.Connection, run_id: str, task_id: str):
        self.conn = conn
        self.run_id = run_id
        self.task_id = task_id
        row = self.conn.execute(
            "SELECT COALESCE(MAX(seq), 0) AS m FROM status_history WHERE run_id = ?", (run_id,)
        ).fetchone()
        self._seq = int(row["m"])

    # -- low-level helpers ----------------------------------------------------

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq

    def get_claim(self, claim_id: str) -> Optional[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM claims WHERE claim_id = ? AND run_id = ?", (claim_id, self.run_id)
        ).fetchone()

    def claim_exists(self, claim_id: str) -> bool:
        return self.get_claim(claim_id) is not None

    def _record_status_history(
        self, entity_type: str, entity_id: str, old_status: Optional[str], new_status: str,
        reason: str, new_dependency_warning: bool = False,
        caused_by_dependency_id: Optional[str] = None,
        caused_by_message_id: Optional[str] = None,
    ) -> None:
        self.conn.execute(
            """INSERT INTO status_history (run_id, entity_type, entity_id, old_status, new_status,
                new_dependency_warning, reason, caused_by_dependency_id, caused_by_message_id, seq, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (self.run_id, entity_type, entity_id, old_status, new_status, int(new_dependency_warning),
             reason, caused_by_dependency_id, caused_by_message_id, self._next_seq(), _now()),
        )

    def _set_claim_status(
        self, claim_id: str, new_status: Status, reason: str,
        dependency_warning: Optional[bool] = None,
        caused_by_dependency_id: Optional[str] = None,
        caused_by_message_id: Optional[str] = None,
    ) -> None:
        claim = self.get_claim(claim_id)
        if claim is None:
            return
        old_status = claim["status"]
        dw = claim["dependency_warning"] if dependency_warning is None else int(dependency_warning)
        self.conn.execute(
            "UPDATE claims SET status = ?, dependency_warning = ?, updated_at = ? WHERE claim_id = ?",
            (new_status.value, dw, _now(), claim_id),
        )
        self._record_status_history(
            "claim", claim_id, old_status, new_status.value, reason, bool(dw),
            caused_by_dependency_id, caused_by_message_id,
        )

    # -- claim creation ---------------------------------------------------------

    def create_claim(self, message: Message) -> str:
        claim_id = message.message_id
        self.conn.execute(
            """INSERT INTO claims (claim_id, run_id, task_id, content, status, confidence,
                dependency_warning, created_from_message_id, superseded_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)""",
            (claim_id, self.run_id, self.task_id, message.content, message.status.value,
             message.confidence, message.message_id, _now(), _now()),
        )
        self._record_status_history(
            "claim", claim_id, None, message.status.value, "created",
            caused_by_message_id=message.message_id,
        )
        return claim_id

    # -- dependency graph ---------------------------------------------------

    def _depends_on_transitively(self, start: str, target: str) -> bool:
        """True if `start` already (transitively) depends on `target`."""
        seen: set[str] = set()
        stack = [start]
        while stack:
            cur = stack.pop()
            if cur == target:
                return True
            if cur in seen:
                continue
            seen.add(cur)
            for row in self.conn.execute(
                "SELECT depends_on_claim_id FROM dependencies WHERE claim_id = ? AND run_id = ?",
                (cur, self.run_id),
            ):
                stack.append(row["depends_on_claim_id"])
        return False

    def add_dependency(self, claim_id: str, depends_on_claim_id: str) -> bool:
        """Returns True if the edge was added, False if rejected as a cycle."""
        if claim_id == depends_on_claim_id or self._depends_on_transitively(depends_on_claim_id, claim_id):
            return False
        self.conn.execute(
            "INSERT INTO dependencies (dependency_id, run_id, claim_id, depends_on_claim_id, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (new_id("dep"), self.run_id, claim_id, depends_on_claim_id, _now()),
        )
        return True

    def get_direct_dependents(self, claim_id: str) -> list[str]:
        return [
            row["claim_id"] for row in self.conn.execute(
                "SELECT claim_id FROM dependencies WHERE depends_on_claim_id = ? AND run_id = ?",
                (claim_id, self.run_id),
            )
        ]

    # -- contradictions -------------------------------------------------------

    def add_contradiction(self, claim_id: str, contradicts_claim_id: str) -> None:
        self.conn.execute(
            "INSERT INTO contradictions (contradiction_id, run_id, claim_id, contradicts_claim_id, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (new_id("contra"), self.run_id, claim_id, contradicts_claim_id, _now()),
        )
        target = self.get_claim(contradicts_claim_id)
        if target is not None and target["status"] != Status.RETRACTED.value:
            self._set_claim_status(
                contradicts_claim_id, Status.CONTESTED,
                reason=f"contradicted by claim {claim_id}",
                caused_by_message_id=claim_id,
            )
            self.propagate_contested(contradicts_claim_id)

    # -- propagation ------------------------------------------------------------

    def propagate_contested(self, claim_id: str, _visited: Optional[set[str]] = None) -> list[str]:
        visited = _visited if _visited is not None else set()
        touched: list[str] = []
        if claim_id in visited:
            return touched
        visited.add(claim_id)
        for dependent_id in self.get_direct_dependents(claim_id):
            self._set_claim_status(
                dependent_id, Status.CONTESTED,
                reason=f"dependency {claim_id} became contested",
                dependency_warning=True,
                caused_by_dependency_id=claim_id,
            )
            touched.append(dependent_id)
            touched.extend(self.propagate_contested(dependent_id, visited))
        return touched

    def propagate_retracted(self, claim_id: str, _visited: Optional[set[str]] = None) -> list[str]:
        visited = _visited if _visited is not None else set()
        touched: list[str] = []
        if claim_id in visited:
            return touched
        visited.add(claim_id)
        for dependent_id in self.get_direct_dependents(claim_id):
            self._set_claim_status(
                dependent_id, Status.CONTESTED,
                reason=f"dependency {claim_id} was retracted",
                dependency_warning=True,
                caused_by_dependency_id=claim_id,
            )
            touched.append(dependent_id)
            touched.extend(self.propagate_retracted(dependent_id, visited))
        return touched

    def retract_claim(self, claim_id: str, reason: str, caused_by_message_id: Optional[str] = None) -> list[str]:
        self._set_claim_status(
            claim_id, Status.RETRACTED, reason=reason, caused_by_message_id=caused_by_message_id,
        )
        return self.propagate_retracted(claim_id)

    def mark_superseded(self, old_claim_id: str, new_claim_id: str) -> None:
        """Restoring/superseding a dependency never auto-restores dependents —
        it only marks the old claim as superseded; dependents stay exactly as
        they are until an explicit verification action re-evaluates them."""
        self.conn.execute(
            "UPDATE claims SET superseded_by = ? WHERE claim_id = ?", (new_claim_id, old_claim_id)
        )

    def verify(self, claim_id: str, message_id: str, result: str) -> None:
        """Explicit re-verification action. Only this can move a claim back
        to `verified`/`supported` after it has been contested."""
        self.conn.execute(
            "INSERT INTO verifications (verification_id, run_id, claim_id, message_id, result, verified_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (new_id("verif"), self.run_id, claim_id, message_id, result, _now()),
        )
        if result == "confirmed":
            self._set_claim_status(
                claim_id, Status.VERIFIED, reason="explicit re-verification confirmed claim",
                dependency_warning=False, caused_by_message_id=message_id,
            )
        else:
            self._set_claim_status(
                claim_id, Status.CONTESTED, reason="explicit re-verification failed",
                dependency_warning=True, caused_by_message_id=message_id,
            )

    # -- top-level message ingestion --------------------------------------------

    def ingest_message(self, message: Message) -> IngestResult:
        claim_id = self.create_claim(message)

        dependency_edges: list[str] = []
        rejected_cycles: list[str] = []
        for dep_id in message.depends_on:
            if not self.claim_exists(dep_id):
                continue
            if self.add_dependency(claim_id, dep_id):
                dependency_edges.append(dep_id)
                dep_claim = self.get_claim(dep_id)
                if dep_claim is not None and dep_claim["status"] in (
                    Status.CONTESTED.value, Status.RETRACTED.value,
                ):
                    self._set_claim_status(
                        claim_id, Status.CONTESTED,
                        reason=f"created depending on already-{dep_claim['status']} claim {dep_id}",
                        dependency_warning=True, caused_by_dependency_id=dep_id,
                    )
            else:
                rejected_cycles.append(dep_id)
                self.conn.execute(
                    "INSERT INTO validation_failures (run_id, turn_index, failure_type, detail, "
                    "repair_attempted, repair_succeeded, created_at) VALUES (?, -1, 'semantic', ?, 0, 0, ?)",
                    (self.run_id, f"rejected dependency cycle: {claim_id} -> {dep_id}", _now()),
                )

        contradiction_edges: list[str] = []
        for contra_id in message.contradicts:
            if self.claim_exists(contra_id):
                self.add_contradiction(claim_id, contra_id)
                contradiction_edges.append(contra_id)

        propagated_retracted: list[str] = []
        if message.message_type == MessageType.RETRACTION:
            for sup_id in message.supersedes:
                if self.claim_exists(sup_id):
                    propagated_retracted.extend(
                        self.retract_claim(sup_id, reason=f"retracted by claim {claim_id}", caused_by_message_id=message.message_id)
                    )
                    self.mark_superseded(sup_id, claim_id)
        elif message.supersedes:
            for sup_id in message.supersedes:
                if self.claim_exists(sup_id):
                    self.mark_superseded(sup_id, claim_id)

        propagated_contested: list[str] = []
        if message.message_type == MessageType.VERIFICATION:
            result = "confirmed" if message.status == Status.VERIFIED else "failed"
            for target_id in message.depends_on or message.contradicts:
                if self.claim_exists(target_id):
                    self.verify(target_id, message.message_id, result)

        self.conn.commit()
        final = self.get_claim(claim_id)
        return IngestResult(
            claim_id=claim_id,
            status=Status(final["status"]),
            contradiction_edges=contradiction_edges,
            dependency_edges=dependency_edges,
            rejected_cycles=rejected_cycles,
            propagated_contested=propagated_contested,
            propagated_retracted=propagated_retracted,
        )
