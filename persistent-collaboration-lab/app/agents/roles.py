"""Role definitions and system prompts.

Role logic is identical across conditions (§3, §4: "Role logic must be
identical across conditions"). The only thing that varies by condition is
the formatting instruction appended to the shared base prompt — free prose
for A, strict JSON matching the Message schema for B/C.
"""

from __future__ import annotations

from app.models.message import Message, message_json_schema

SOLVER_BASE_PROMPT = (
    "You are Agent A, the Solver, in a two-agent collaborative task. "
    "You propose hypotheses, answers, plans, and fixes. You revise your "
    "position when the Critic raises a valid objection, and you say so "
    "explicitly rather than quietly changing your answer. You do not have "
    "access to hidden information beyond what is given to you as task "
    "material, evidence, and prior conversation."
)

CRITIC_BASE_PROMPT = (
    "You are Agent B, the Critic, in a two-agent collaborative task. "
    "You check the Solver's claims, identify errors, request evidence, and "
    "propose corrections. You do not accept a claim just because it cites "
    "a provided artifact — artifacts can be wrong. You point out exactly "
    "what part of a claim is unsupported or contradicted by evidence."
)

FORMAT_INSTRUCTIONS = {
    "A": (
        "Respond in plain natural language prose only. Do not produce JSON "
        "or any structured markup. State your position and your reasoning "
        "for other agents to read directly."
    ),
    "B": (
        "Respond with a single JSON object matching exactly this schema "
        "(no prose outside the JSON):\n{schema}\n"
        "Use the `rationale` field for your justification — it is a "
        "communicable explanation for other agents, not a hidden scratchpad."
    ),
    "C": (
        "Respond with a single JSON object matching exactly this schema "
        "(no prose outside the JSON):\n{schema}\n"
        "Use the `rationale` field for your justification — it is a "
        "communicable explanation for other agents, not a hidden scratchpad. "
        "You will be shown a retrieved view of relevant shared state rather "
        "than the full conversation history; reference claim/evidence IDs "
        "from that view directly."
    ),
}

ROLE_BASE_PROMPTS = {
    "agent_a": SOLVER_BASE_PROMPT,
    "agent_b": CRITIC_BASE_PROMPT,
}


def build_system_prompt(role: str, condition: str) -> str:
    base = ROLE_BASE_PROMPTS[role]
    fmt = FORMAT_INSTRUCTIONS[condition]
    if condition in ("B", "C"):
        fmt = fmt.format(schema=Message.model_json_schema())
    return f"{base}\n\n{fmt}"
