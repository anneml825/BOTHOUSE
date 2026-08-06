# Persistent Collaboration Lab (v0.1)

An experimental prototype testing whether two AI agents collaborate more
effectively using **structured persistent shared state** than using
**ordinary transcript-based conversation** — and, equally importantly,
whether persistence makes that collaboration *worse* at catching its own
mistakes.

This is **not** an attempt to build a secret AI language, and it does not
touch model weights, hidden activations, or internal chain-of-thought. It
is a controlled comparison of three communication/memory architectures
using a plain JSON message schema and a SQLite-backed runtime.

## What this tests

**Primary hypothesis:** on multi-step collaborative tasks, agents using
structured persistent shared state (Condition C) achieve better task
performance per unit cost than agents collaborating through transcript-only
natural language (Condition A).

**Co-primary competing risk:** persistent structured state may make false
claims *more durable, more influential, and slower to correct* than
transcript-only collaboration, because a claim graph can encode a mistake
as infrastructure rather than as a sentence someone might reread and
doubt. Both outcomes are treated as equally important in this project —
error-correction behavior (§ correction metrics below) is scored and
reported with the same weight as task accuracy, never as a footnote.

## Why three separate conditions

- **A — plain transcript.** The baseline: ordinary natural-language turns,
  no structured claim graph, no persistent semantic state.
- **B — structured-only history, no persistence.** Same message schema as
  C, but history is prior messages passed directly — no database, no
  automatic dependency management, no status propagation. This isolates
  *structured communication* from *persistence*: if C beats A, is it
  because messages are structured, or because state persists and gets
  actively managed? B is the arm that answers that.
- **C — structured communication + persistent shared state.** A runtime
  (SQLite) manages claims, dependencies, contradictions, and status
  propagation, and agents see a *retrieved relevant view* of that state
  instead of an accumulated transcript.

A fourth arm ("structured output, but still fed the full transcript") was
deliberately not built — it tests the least interesting delta and adds a
condition without adding a real question.

## Why false-claim correction is co-primary, not secondary

A system that never revises a wrong claim isn't "stable," it's broken in a
way that's easy to miss if you only measure how confidently agents reach a
final answer. Structured persistent state is exactly the kind of design
that can make a wrong claim *look* more authoritative — it has an ID, other
claims depend on it, it survived several turns unchallenged — even though
none of that makes it true. So this project injects a false but plausible
evidence artifact into matched clean/injected task pairs (§7) and measures,
per condition: how many turns and tokens elapse before an agent challenges
it, before the collaboration corrects it, how far the contamination spread
through dependent claims before correction, and whether the final answer
still reflects it. A condition that wins on task score but is slower or
more resistant to self-correction has not demonstrated an unambiguous win.

## Why persistent systems can preserve *and* amplify errors

Persistence is not automatically remembering the truth for longer — it's
remembering *whatever was written* for longer, with structure that can
make it easier for later claims to build on an earlier one without
re-litigating it. That's the mechanism behind the competing risk above:
dependency edges are how good collaboration gets more efficient over
multiple turns, and they're also how an uncorrected mistake gets
inherited by everything built on top of it before anyone rechecks. The
dependency propagation rules in `app/runtime/state_manager.py` (§6) are
deliberately conservative about this: a contested or retracted claim
propagates a *warning* to its dependents, but nothing is auto-retracted,
and nothing is auto-restored when the underlying issue is fixed — every
return to `supported`/`verified` requires an explicit verification action
tied to a real message, so recovery from contamination is never silent
either.

## Why `rationale` is stored but not treated as hidden chain-of-thought

The message schema (§4) asks agents for a `rationale` field: a
justification meant for *other agents to read*, not an introspective report
of internal computation. The runtime stores it verbatim for audit and shows
it to the other agent — and stops there. It is never parsed, never
auto-converted into claims/dependencies/evidence, and never used as a
signal about what "really" happened inside the model. Treating a model's
self-report as ground truth about its own cognition is a category error
this project avoids on purpose; `rationale` is data about what one agent
told another, nothing more.

## Why this project does not create a secret AI language

Every message is plain JSON matching a public Pydantic schema (`app/models/message.py`,
JSON Schema generated from it), with English-language `content` and
`rationale` fields. There is no learned or invented protocol, no operator
algebra (`REVISE`/`COMPOSE`/`VERIFY`/`QUERY` were tried in earlier design
passes — see `DESIGN_HISTORY.md` — and dropped because they solved a
problem infrastructure was better suited for), and nothing here is
optimized for compactness or opacity to humans. The entire point of
Condition B/C is a schema a person can read as easily as an agent can.

## Why direct model activation or weight exchange is out of scope

This project studies communication and memory *architecture*: what agents
say to each other and what a runtime remembers between turns. It does not
read or exchange model internals (activations, logits, weights) at any
point, and nothing in the adapters, schema, or runtime provides a channel
for that. The research question is answerable entirely at the level of
messages and stored state.

## Quickstart (mock mode, no API keys)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python scripts/run_milestone1.py
```

This runs the test suite, then the full Milestone 1 required demonstration:
one deterministic mock task (`bug_diagnosis_001`) under all three
conditions, clean and false-evidence-injected, with dependency propagation
demonstrated directly, a `plumbing_only` comparison report written to
`results/`, and a Condition C replay-determinism check.

To browse the results:

```bash
LAB_DB_PATH=results/milestone1.sqlite3 uvicorn app.api.main:app --reload
```

Open `http://127.0.0.1:8000`. Check "Evaluator / admin mode" to see the
injected-false-evidence marker — it's hidden from the default view exactly
as it's hidden from the agents.

## Staging — what a run report is (and isn't) evidence of

Every run is labeled with a stage, and only one of them means anything
about the research question:

- **`plumbing_only`** — deterministic `MockAdapter`, scripted responses.
  Tests orchestration, persistence, propagation, injection, replay,
  scoring, and cost accounting. **Produces no evidence about the research
  hypothesis** — the "agents" don't reason, they play back a script.
- **`smoke_test`** — a cheap real model, one task across all conditions.
  Tests adapters, schema adherence, real token accounting, retries,
  exports. **Still not evidence about the hypothesis** — one task, one
  seed.
- **`experimental_pilot`** — capability-relevant models, the full pilot
  design (§ below). **Only these results belong in the experimental
  comparison.**

Milestone 1 (this repo, as shipped) is `plumbing_only` only. Running a
`smoke_test` or `experimental_pilot` requires setting `active_adapter` in
`config/models.yaml` to an `openai_*`/`anthropic_*` entry and exporting the
matching API key (`.env.example`).

## Pilot plan (after the slice works)

1. Stage 1 (done): deterministic mocks, full plumbing.
2. Stage 2 (done in mock; run against a real cheap model per README
   "Staging" before trusting it): `scripts/run_smoke_test.py` — one task
   across all conditions against a real adapter. Several real-model-only
   gaps were found and fixed this way (markdown-fenced JSON, evidence IDs
   never shown to agents, final-turn/ANSWER-vs-DECISION handling, code
   extraction assuming only markdown fences) — see git history for
   `app/runtime/validation.py`, `app/experiments/orchestrator.py`, and
   `app/evaluation/evaluator.py`.
3. Stage 3 (done in mock; needs a real-model run to count):
   `scripts/run_pilot.py` — 10 tasks × 3 conditions × 1 seed = 30 clean
   runs, then 5 selected tasks × 3 conditions = 15 matched injected runs
   (45 total). Verified end-to-end against `MockAdapter` (all runs
   complete, task_score 1.0, injected runs detect and correct at the
   expected turn, Condition C replay-consistent) — see
   `tests/test_pilot_suite.py`. Still `plumbing_only`/mock; running it
   against an `experimental_pilot`-stage model is the actual pilot.
4. Inspect effect direction, variance, schema tax, and correction behavior
   *before* expanding further. Add tasks if task-to-task variance is high;
   add seeds if repeated outcomes are unstable; add injected pairs if the
   misinformation effect is unclear; stop rather than re-spend budget if
   the architectural disadvantage is already clear.

Task suite as shipped: 10 tasks across all three families — 4
`bug_diagnosis`, 3 `evidence_synthesis`, 3 `constraint_planning` — each
with a clean and a false-evidence-injected scenario, covering all five
injection types from §7 across the suite. Deterministic evaluators exist
for all three families (`app/evaluation/evaluator.py`); `evidence_synthesis`'s
scoring config includes `contradiction_pairs` per §8 but doesn't yet
enforce it (checking whether agents *recognized* a conflict needs the full
message history, not just the final answer — a known v0.1 scope gap, not
silently dropped).

## Cost controls

```
MAX_TURNS_PER_RUN=8              MAX_TOTAL_TOKENS_PER_RUN=30000
MAX_RUN_COST_USD=1.00            MAX_EXPERIMENT_COST_USD=20.00
```
(`config/budgets.yaml`). Cost is reported per run as
`agent_cost` / `repair_cost` / `evaluator_cost` / `total_cost`.

## Project structure

```
persistent-collaboration-lab/
├── app/
│   ├── agents/       adapters (mock/OpenAI/Anthropic) + Solver/Critic role prompts
│   ├── api/           FastAPI dashboard backend
│   ├── db/             SQLite schema + migrations
│   ├── evaluation/  deterministic evaluator + cross-condition analysis
│   ├── experiments/  config, task loader, injection, orchestrator
│   ├── models/       Pydantic message/evidence schema
│   ├── runtime/       state manager, dependency propagation, history/budget, replay
│   ├── schemas/       (JSON Schema export target)
│   └── ui/             dashboard frontend (single page, vanilla JS)
├── tasks/
│   ├── bug_diagnosis/bug_diagnosis_001/   the built Milestone-1 task
│   ├── evidence_synthesis/                 README only (v0.1)
│   └── constraint_planning/                README only (v0.1)
├── tests/
├── scripts/run_milestone1.py
├── config/{models,budgets,experiment}.yaml
└── results/
```

## Limitations

- **Condition C is deliberately handicapped by the equal-input-budget
  rule (§3).** It receives exactly the same maximum input-token budget as A
  and B — retrieval is not allowed to stuff more total information into
  context just because it has a database behind it. In production,
  retrieval's real advantage over a raw transcript is partly *that* it can
  fit more relevant material into a fixed window instead of dragging along
  a whole history. Holding total input tokens equal here isolates
  *selection quality* specifically. That means a null result in this
  design does not rule out persistent state being useful in practice for a
  reason this design intentionally excludes from measurement.
- Token counts throughout are a boring `~4 chars/token` estimate, not a
  real provider tokenizer (see `DESIGN_HISTORY.md`) — precise enough for
  uniform treatment across conditions, not for trusting absolute counts.
- `retrieval_precision` is not implemented (§5) — it needs a labeled
  relevance corpus this project doesn't have; a half-defined metric would
  be worse than a missing one.
- The v0.1 task suite is one task (`bug_diagnosis_001`). Every finding from
  running it is, by definition, `plumbing_only` — see "Staging" above.
  **Do not treat anything in this repository as evidence about the
  research hypothesis until `experimental_pilot`-stage runs exist and the
  Analysis module explicitly says so; pilot-scale results are never
  reported with a significance claim (§12).**
- Real-provider cost/latency numbers are only as accurate as the pricing
  entries in `config/models.yaml`; keep them current before trusting a
  `smoke_test`/`experimental_pilot` cost report.

## Tests

```bash
pytest -q
```

Covers: schema validation, malformed-output repair, semantic validation,
persistence, event replay, deterministic state reconstruction, claim/
dependency creation, cycle rejection, contested/retraction propagation,
re-verification requirements, false-evidence injection, correction-latency
tracking, evaluator blinding, cost accounting, per-condition history
assembly, budget truncation/omission logging, cross-condition config
parity, and full mock batch runs.
