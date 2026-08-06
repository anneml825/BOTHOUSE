# evidence_synthesis task family (not yet populated)

Per §19, v0.1 builds and proves out the smallest complete vertical slice on
**one** task (`tasks/bug_diagnosis/bug_diagnosis_001`) end to end across all
three conditions before expanding the task suite. This family's ~10 tasks
are the next expansion step (§19 "Pilot plan"), not part of Milestone 1.

Each task added here must include, per §8: `atomic_fact_key`,
`acceptable_paraphrases`, `required_evidence_mapping`, `contradiction_pairs`,
`unsupported_claim_rules`, `final_answer_constraints`, plus a closed source
packet (no open-web research) so scoring stays programmatic — following the
same `task.json` shape as `tasks/bug_diagnosis/bug_diagnosis_001/task.json`
(`prompt`, `evidence_pool`, `injected_evidence`, `scoring`, `mock_script`).
