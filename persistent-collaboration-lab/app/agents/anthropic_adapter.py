"""Anthropic adapter. Lazily imports `anthropic` so the project runs fully in
mock mode with zero extra dependencies installed. Model name and pricing
come from config, never hardcoded.
"""

from __future__ import annotations

import os
import time

from app.agents.base import AdapterResponse, ModelAdapter


class AnthropicAdapter(ModelAdapter):
    provider_name = "anthropic"

    def __init__(self, model_name: str, input_rate_per_1k: float = 0.0, output_rate_per_1k: float = 0.0, api_key: str | None = None):
        self.model_name = model_name
        self.input_rate = input_rate_per_1k
        self.output_rate = output_rate_per_1k
        self._api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        self._client = None

    def _client_lazy(self):
        if self._client is None:
            if not self._api_key:
                raise RuntimeError("ANTHROPIC_API_KEY not set; cannot use AnthropicAdapter outside mock mode")
            import anthropic  # imported lazily so mock-mode runs need not install this
            self._client = anthropic.Anthropic(api_key=self._api_key)
        return self._client

    def generate(self, system_prompt: str, user_prompt: str, *, max_tokens: int, temperature: float = 0.0) -> AdapterResponse:
        client = self._client_lazy()
        start = time.perf_counter()
        # `temperature` is accepted in the shared ModelAdapter interface (and
        # still forwarded for providers/models that support it, e.g. the
        # OpenAI adapter) but the newest Claude models reject it outright
        # ("temperature is deprecated for this model") rather than silently
        # ignoring it, so it's deliberately not passed here.
        response = client.messages.create(
            model=self.model_name,
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        latency_ms = (time.perf_counter() - start) * 1000
        text = "".join(block.text for block in response.content if getattr(block, "type", None) == "text")
        prompt_tokens = getattr(response.usage, "input_tokens", 0)
        completion_tokens = getattr(response.usage, "output_tokens", 0)
        cost = (prompt_tokens * self.input_rate + completion_tokens * self.output_rate) / 1000
        return AdapterResponse(
            text=text, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
            latency_ms=latency_ms, cost_usd=cost, provider=self.provider_name, model=self.model_name,
        )
