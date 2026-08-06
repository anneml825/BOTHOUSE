"""Token counting.

Deliberately a boring, dependency-free approximation (~4 chars/token, a
common rule of thumb for English text) rather than pulling in a specific
provider tokenizer. At `plumbing_only` / `smoke_test` stage the exact count
is not load-bearing — what matters is that every condition is measured with
the *same* function, so comparisons stay apples-to-apples. Swap this out for
a real provider tokenizer before treating token counts as precise in an
`experimental_pilot` run.
"""

from __future__ import annotations

import json
from typing import Any

_CHARS_PER_TOKEN = 4.0


def count_tokens(text: str) -> int:
    if not text:
        return 0
    # Ceil division so even short non-empty strings cost >= 1 token.
    return max(1, -(-len(text) // int(_CHARS_PER_TOKEN)))


def count_tokens_json(obj: Any) -> int:
    return count_tokens(json.dumps(obj, sort_keys=True, default=str))
