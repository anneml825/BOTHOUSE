"""Context budget and truncation policy (§5), identical across conditions.

Policy, verbatim from spec:
  1. Reserve a fixed token allowance for system instructions, task input,
     current message, and response generation (handled by the caller —
     this module only fills the *history* portion of the budget).
  2. Fill remaining history budget newest -> oldest.
  3. Never truncate an individual message invisibly.
  4. Remove whole historical units once the budget is exceeded.
  5. Always preserve the original task and the current unresolved request
     (also the caller's responsibility — they are reserved, not part of
     the history units passed here).
  6. Log every omitted message ID and omitted token count.

The indivisible unit differs by condition (a structured message + its
rationale for B/C; one conversational turn for A) but the fill algorithm
below is condition-agnostic — see app/runtime/history.py for how each
condition turns its material into `HistoryUnit`s.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, TypeVar

T = TypeVar("T")


@dataclass
class HistoryUnit(Generic[T]):
    unit_id: str
    token_count: int
    payload: T
    turn_index: int  # for restoring chronological order after newest-first fill


@dataclass
class AssembledHistory(Generic[T]):
    included: list[HistoryUnit[T]]  # chronological order (oldest -> newest)
    omitted_ids: list[str]
    tokens_available: int
    tokens_included: int
    tokens_omitted: int


def assemble_within_budget(units: list[HistoryUnit[T]], budget_tokens: int) -> AssembledHistory[T]:
    """`units` may be given in any order; we always fill newest -> oldest."""
    newest_first = sorted(units, key=lambda u: u.turn_index, reverse=True)
    included: list[HistoryUnit[T]] = []
    omitted_ids: list[str] = []
    tokens_included = 0
    tokens_omitted = 0
    budget_exceeded = False
    for unit in newest_first:
        if not budget_exceeded and tokens_included + unit.token_count <= budget_tokens:
            included.append(unit)
            tokens_included += unit.token_count
        else:
            budget_exceeded = True
            omitted_ids.append(unit.unit_id)
            tokens_omitted += unit.token_count
    included.sort(key=lambda u: u.turn_index)
    return AssembledHistory(
        included=included,
        omitted_ids=omitted_ids,
        tokens_available=budget_tokens,
        tokens_included=tokens_included,
        tokens_omitted=tokens_omitted,
    )
