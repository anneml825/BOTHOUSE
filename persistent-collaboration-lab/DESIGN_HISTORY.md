# Design History

Discarded directions and why, kept here so nobody re-derives them the hard way.

```
V1  Goal: invent an AI-native language.
    Finding: language was not the bottleneck.
V2  Goal: persistent semantic operators (REVISE/COMPOSE/VERIFY/QUERY).
    Finding: operator algebra was overcompensating for missing infrastructure.
V3  Goal: persistent structured collaboration.
    Finding: simple schemas + a runtime beat speculative language design.
V4  Experimental design.
    Question: does persistence improve collaboration or entrench mistakes?
```

## Notes on v0.1 implementation choices not fully spelled out in the spec

These are the calls made where the build prompt left room, recorded so a
future contributor doesn't mistake them for spec text.

- **A fourth "output structure only, full transcript" arm was not built.**
  The spec explicitly drops it as "the least interesting delta" — noted
  here only so nobody re-adds it without re-reading why.

- **Every structured message mints a row in `claims` (Condition C), not
  just `claim`/`answer`/`decision` types.** The schema's own description of
  `content` — "concise primary communicative commitment" — applies to
  critiques, questions, and evidence submissions too, not only bare
  propositions. Giving every message a row keeps dependency/contradiction
  edges uniform (every edge endpoint is a real row) instead of needing
  special-case handling for "does this message type get a claim". A
  message's `message_type` still distinguishes conversational acts from
  propositions eligible for final-answer extraction.

- **Per-message-type creation-status legality, not one global rule.** A
  literal reading of "a claim can't be created already verified" would also
  block a `verification` message from ever declaring `status: verified` —
  but that's the entire point of a verification message; it's reporting a
  check that was just performed, not asserting an unverified new fact. So
  creation legality is keyed by `message_type`
  (`app.runtime.validation.CREATION_ALLOWED_BY_TYPE`): `claim`/`answer` are
  held to the strict "can't start verified" rule from §9; `verification`,
  `critique`, `retraction`, and `decision` are allowed the statuses that
  make their own communicative act coherent.

- **Condition A still logs `message_type`/`status`/`depends_on`/etc. for
  bookkeeping**, sourced from the task's scripted turn annotation rather
  than agent-declared structure. The runtime never *acts* on it for
  Condition A (no claim graph, no propagation) — it exists purely so the
  same `messages` table can support uniform audit/analysis across all three
  conditions without three different storage shapes. In a real (non-mock)
  Condition A run these fields would carry no ground truth and analysis
  code must not assume otherwise; this is a `plumbing_only`/mock
  convenience, not a claim that Condition A agents produce structure.

- **Token counting is a boring ~4-chars/token estimate**, not a real
  provider tokenizer, per condition. Precise enough for identical treatment
  across A/B/C at `plumbing_only`/`smoke_test`; swap in a real tokenizer
  before trusting counts at `experimental_pilot`.

- **`retrieval_precision` was not implemented**, per the build prompt's
  explicit instruction — it needs a labeled relevance corpus that doesn't
  exist yet. A half-defined metric would be worse than a missing one.
