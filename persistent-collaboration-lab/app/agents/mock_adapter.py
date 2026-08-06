"""Deterministic mock adapter.

Plays back a pre-built, ordered queue of response strings — one per
`generate()` call — regardless of prompt content. This is intentional: the
`plumbing_only` stage exists to test orchestration, persistence, dependency
propagation, injection handling, replay, scoring, and cost accounting
*without* claiming anything about real model reasoning. Determinism here is
a feature, not a shortcut — see README "Staging" section.

The response queue is normally built by `app.experiments.task_loader` from
a task's `mock_script` (rendered per-condition: structured JSON for B/C,
prose for A). Tests may also hand-build small queues directly.
"""

from __future__ import annotations

from typing import Callable, Union

from app.agents.base import AdapterResponse, ModelAdapter
from app.runtime.tokens import count_tokens

QueueItem = Union[str, Callable[[], str]]


class MockAdapter(ModelAdapter):
    provider_name = "mock"

    def __init__(self, response_queue: list[QueueItem], model_name: str = "mock-deterministic-v1"):
        # Items may be plain strings, or zero-arg callables resolved lazily
        # at generate() time — the latter lets a scenario reference the
        # message_id of an earlier turn that didn't exist yet when the
        # queue was built (see app.experiments.task_loader).
        self._queue = list(response_queue)
        self._cursor = 0
        self.model_name = model_name

    def remaining(self) -> int:
        return len(self._queue) - self._cursor

    def generate(self, system_prompt: str, user_prompt: str, *, max_tokens: int, temperature: float = 0.0) -> AdapterResponse:
        if self._cursor >= len(self._queue):
            raise RuntimeError("MockAdapter response queue exhausted — scenario shorter than run required")
        item = self._queue[self._cursor]
        text = item() if callable(item) else item
        self._cursor += 1
        prompt_tokens = count_tokens(system_prompt) + count_tokens(user_prompt)
        completion_tokens = count_tokens(text)
        return AdapterResponse(
            text=text,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=0.1,
            cost_usd=0.0,
            provider=self.provider_name,
            model=self.model_name,
        )
