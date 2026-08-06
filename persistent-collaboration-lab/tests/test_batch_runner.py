from app.experiments.batch import BatchSpec, run_batch


def test_run_batch_across_conditions_and_seeds(conn, bug_task, config):
    spec = BatchSpec(task_ids=[bug_task["task_id"]], conditions=["A", "B"], seeds=[1, 2], inject=True)
    reports = run_batch(conn, config, {bug_task["task_id"]: bug_task}, spec, run_id_prefix="bt")
    # 2 conditions x 2 seeds x (clean + injected) = 8 runs
    assert len(reports) == 8
    for r in reports.values():
        assert r.status == "completed"
        assert r.evaluation["task_score"] == 1.0
