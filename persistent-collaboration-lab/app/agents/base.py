"""Provider-neutral model adapter interface.

Every adapter — mock, OpenAI, Anthropic, whatever gets added later —
implements the same `generate()` signature so the orchestrator, role logic,
and cost accounting never need to know which provider is behind an agent.
Model names are never hardcoded here: they come from config (YAML/TOML),
read at call sites, not baked into adapter classes.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass


@dataclass
class AdapterResponse:
    text: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: float
    cost_usd: float
    provider: str
    model: str


class ModelAdapter(abc.ABC):
    provider_name: str = "base"

    @abc.abstractmethod
    def generate(self, system_prompt: str, user_prompt: str, *, max_tokens: int, temperature: float = 0.0) -> AdapterResponse:
        ...
