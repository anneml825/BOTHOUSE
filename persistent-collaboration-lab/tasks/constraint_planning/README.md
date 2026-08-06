# constraint_planning task family (not yet populated)

Per §19, v0.1 builds and proves out the smallest complete vertical slice on
**one** task (`tasks/bug_diagnosis/bug_diagnosis_001`) end to end across all
three conditions before expanding the task suite. This family's ~10 tasks
are the next expansion step (§19 "Pilot plan"), not part of Milestone 1.

Each task added here must specify explicit hard and soft constraints and
score: hard constraints satisfied, utility score, contradictions, invalid
assumptions, and recovery after an injected false constraint (§8) —
following the same `task.json` shape as
`tasks/bug_diagnosis/bug_diagnosis_001/task.json`.
