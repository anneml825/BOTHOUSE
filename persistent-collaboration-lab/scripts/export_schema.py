#!/usr/bin/env python3
"""Regenerate app/schemas/message_schema.json from the Pydantic model (§4)."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.models.message import message_json_schema  # noqa: E402

OUT = ROOT / "app" / "schemas" / "message_schema.json"


def main() -> None:
    OUT.write_text(json.dumps(message_json_schema(), indent=2) + "\n")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
