-- Persistent Collaboration Lab — initial schema (§6, §7, §9, §10)
-- Append-only where it matters: status_history and validation_failures are
-- never rewritten or deleted, so state is always deterministically
-- reconstructible by replay (see app/runtime/replay.py).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    run_id              TEXT PRIMARY KEY,
    task_id             TEXT NOT NULL,
    condition           TEXT NOT NULL CHECK (condition IN ('A', 'B', 'C')),
    stage               TEXT NOT NULL CHECK (stage IN ('plumbing_only', 'smoke_test', 'experimental_pilot')),
    model_config_json   TEXT NOT NULL,
    seed                INTEGER,
    injection_enabled   INTEGER NOT NULL DEFAULT 0,
    injection_type      TEXT,
    matched_clean_run_id TEXT,
    config_snapshot_json TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'turn_limit', 'cost_limit')),
    started_at          TEXT NOT NULL,
    finished_at         TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
    task_id         TEXT PRIMARY KEY,
    family          TEXT NOT NULL CHECK (family IN ('bug_diagnosis', 'evidence_synthesis', 'constraint_planning')),
    name            TEXT NOT NULL,
    version_hash    TEXT NOT NULL,
    definition_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
    agent_id        TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    role            TEXT NOT NULL CHECK (role IN ('agent_a', 'agent_b')),
    adapter_name    TEXT NOT NULL,
    model_name      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    message_id      TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    task_id         TEXT NOT NULL,
    turn_index      INTEGER NOT NULL,
    sender          TEXT NOT NULL,
    target          TEXT NOT NULL,
    message_type    TEXT NOT NULL,
    content         TEXT NOT NULL,
    rationale       TEXT NOT NULL DEFAULT '',
    confidence      REAL NOT NULL,
    evidence_ids_json   TEXT NOT NULL DEFAULT '[]',
    depends_on_json     TEXT NOT NULL DEFAULT '[]',
    contradicts_json    TEXT NOT NULL DEFAULT '[]',
    supersedes_json     TEXT NOT NULL DEFAULT '[]',
    status          TEXT NOT NULL,
    requested_action TEXT,
    created_at      TEXT NOT NULL,
    is_prose        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_run ON messages(run_id, turn_index);

CREATE TABLE IF NOT EXISTS claims (
    claim_id            TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL REFERENCES runs(run_id),
    task_id             TEXT NOT NULL,
    content             TEXT NOT NULL,
    status              TEXT NOT NULL,
    confidence          REAL NOT NULL,
    dependency_warning  INTEGER NOT NULL DEFAULT 0,
    -- Not a hard FK to messages(message_id): the state manager is unit-
    -- testable independently of the message store, and in the normal
    -- orchestrator flow the message row is written first anyway.
    created_from_message_id TEXT NOT NULL,
    superseded_by       TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_run ON claims(run_id);

CREATE TABLE IF NOT EXISTS evidence (
    evidence_id         TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL REFERENCES runs(run_id),
    task_id             TEXT NOT NULL,
    source_type         TEXT NOT NULL,
    content             TEXT NOT NULL,
    provenance          TEXT NOT NULL,
    reliability         TEXT NOT NULL DEFAULT 'unspecified',
    is_injected_false   INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dependencies (
    dependency_id       TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL REFERENCES runs(run_id),
    claim_id            TEXT NOT NULL REFERENCES claims(claim_id),
    depends_on_claim_id TEXT NOT NULL REFERENCES claims(claim_id),
    created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dependencies_run ON dependencies(run_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_claim ON dependencies(claim_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_dep_on ON dependencies(depends_on_claim_id);

CREATE TABLE IF NOT EXISTS contradictions (
    contradiction_id    TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL REFERENCES runs(run_id),
    claim_id            TEXT NOT NULL REFERENCES claims(claim_id),
    contradicts_claim_id TEXT NOT NULL REFERENCES claims(claim_id),
    created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
    question_id     TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    message_id      TEXT NOT NULL REFERENCES messages(message_id),
    content         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open',
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
    decision_id     TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    message_id      TEXT NOT NULL REFERENCES messages(message_id),
    content         TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verifications (
    verification_id TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    claim_id        TEXT NOT NULL REFERENCES claims(claim_id),
    message_id      TEXT NOT NULL,  -- not FK'd to messages; see claims.created_from_message_id note
    result          TEXT NOT NULL,
    verified_at     TEXT NOT NULL
);

-- Append-only. Every status change to any entity (claim, dependency-driven
-- propagation, etc.) is logged here and NEVER rewritten. This is the event
-- log that `app/runtime/replay.py` replays to deterministically reconstruct
-- final state.
CREATE TABLE IF NOT EXISTS status_history (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id                  TEXT NOT NULL REFERENCES runs(run_id),
    entity_type             TEXT NOT NULL,
    entity_id               TEXT NOT NULL,
    old_status              TEXT,
    new_status              TEXT NOT NULL,
    new_dependency_warning  INTEGER NOT NULL DEFAULT 0,
    reason                  TEXT NOT NULL,
    caused_by_dependency_id TEXT,
    caused_by_message_id    TEXT,
    seq                     INTEGER NOT NULL,
    created_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status_history_run ON status_history(run_id, seq);

CREATE TABLE IF NOT EXISTS evaluations (
    evaluation_id       TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL REFERENCES runs(run_id),
    objective_score     REAL,
    model_judge_score   REAL,
    task_score          REAL NOT NULL,
    details_json        TEXT NOT NULL,
    blinded_condition   INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS validation_failures (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id              TEXT NOT NULL REFERENCES runs(run_id),
    turn_index          INTEGER NOT NULL,
    failure_type        TEXT NOT NULL CHECK (failure_type IN ('syntactic', 'semantic', 'overlength')),
    detail              TEXT NOT NULL,
    repair_attempted    INTEGER NOT NULL DEFAULT 0,
    repair_succeeded    INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS injected_false_evidence (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id              TEXT NOT NULL REFERENCES runs(run_id),
    evidence_id         TEXT NOT NULL,
    injection_type      TEXT NOT NULL,
    ground_truth        TEXT NOT NULL,
    disclosed_to_agents INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_model_outputs (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id                  TEXT NOT NULL REFERENCES runs(run_id),
    agent_role              TEXT NOT NULL,
    turn_index              INTEGER NOT NULL,
    prompt_tokens           INTEGER NOT NULL,
    completion_tokens       INTEGER NOT NULL,
    raw_text                TEXT NOT NULL,
    schema_validation_passed INTEGER NOT NULL,
    repair_attempted        INTEGER NOT NULL DEFAULT 0,
    repair_tokens           INTEGER NOT NULL DEFAULT 0,
    repair_succeeded        INTEGER NOT NULL DEFAULT 0,
    runtime_validation_error TEXT,
    operation_rejected       INTEGER NOT NULL DEFAULT 0,
    latency_ms              REAL NOT NULL,
    provider_cost_usd       REAL NOT NULL DEFAULT 0,
    repair_cost_usd         REAL NOT NULL DEFAULT 0,
    created_at               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raw_outputs_run ON raw_model_outputs(run_id, turn_index);

-- Per-turn context/budget accounting (§5). Not in the §6 "at least" list by
-- name but required by the logging spec in §5; kept as its own table so the
-- budget policy is auditable per turn without parsing raw_model_outputs.
CREATE TABLE IF NOT EXISTS context_log (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id                      TEXT NOT NULL REFERENCES runs(run_id),
    turn_index                  INTEGER NOT NULL,
    condition                   TEXT NOT NULL,
    history_tokens_available    INTEGER NOT NULL,
    history_tokens_included     INTEGER NOT NULL,
    history_tokens_omitted      INTEGER NOT NULL,
    messages_omitted_json       TEXT NOT NULL DEFAULT '[]',
    state_items_retrieved       INTEGER NOT NULL DEFAULT 0,
    retrieved_token_count       INTEGER NOT NULL DEFAULT 0,
    retrieval_latency_ms        REAL NOT NULL DEFAULT 0,
    created_at                  TEXT NOT NULL
);
