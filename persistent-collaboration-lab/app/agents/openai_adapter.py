"""OpenAI adapter. Lazily imports `openai` so the project runs fully in mock
mode with zero extra dependencies installed. Model name and pricing come
from config, never hardcoded.
"""

from __future__ import annotations

import os
import time

from app.agents.base import AdapterResponse, ModelAdapter


class OpenAIAdapter(ModelAdapter):
    provider_name = "openai"

    def __init__(self, model_name: str, input_rate_per_1k: float = 0.0, output_rate_per_1k: float = 0.0, api_key: str | None = None):
        self.model_name = model_name
        self.input_rate = input_rate_per_1k
        self.output_rate = output_rate_per_1k
        self._api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self._client = None

    def _client_lazy(self):
        if self._client is None:
            if not self._api_key:
                raise RuntimeError("OPENAI_API_KEY not set; cannot use OpenAIAdapter outside mock mode")
            import openai  # imported lazily so mock-mode runs need not install this
            self._client = openai.OpenAI(api_key=self._api_key)
        return self._client

    def generate(self, system_prompt: str, user_prompt: str, *, max_tokens: int, temperature: float = 0.0) -> AdapterResponse:
        client = self._client_lazy()
        start = time.perf_counter()
        response = client.chat.completions.create(
            model=self.model_name,
            temperature=temperature,
            max_tokens=max_tokens,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        latency_ms = (time.perf_counter() - start) * 1000
        text = response.choices[0].message.content or ""
        usage = response.usage
        prompt_tokens = getattr(usage, "prompt_tokens", 0)
        completion_tokens = getattr(usage, "completion_tokens", 0)
        cost = (prompt_tokens * self.input_rate + completion_tokens * self.output_rate) / 1000
        return AdapterResponse(
            text=text, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
            latency_ms=latency_ms, cost_usd=cost, provider=self.provider_name, model=self.model_name,
        )
