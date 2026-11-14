"""Test-programme planner. Turns open questions into candidate test blocks and picks a subset within a run budget.

Coverage = number of open questions a selected block could potentially check. It is NOT information gain and says
nothing about how likely a block is to resolve a question. Exact enumeration for small candidate sets, greedy
(no optimality claim) otherwise."""
from __future__ import annotations

from hashlib import sha1
from itertools import combinations

from .models import OpenQuestion, ResearchQuery, Test, TestBlock, TestProgramme

EXACT_LIMIT = 16
WEIGHT = {"endpoint_gap": 3.0, "missing_condition": 2.0, "needs_comparison": 1.0}
_MEASURE = {
    "ignition": ["ignition outcome (yes/no)", "time to flame establishment", "surface temperature", "flame imaging"],
    "flame_establishment": ["flame establishment (yes/no)", "flame imaging", "temperature"],
    "sustained_spread": ["spread rate", "flame imaging", "temperature", "O2 fraction"],
    "extinction_under_flow_reduction": ["flow velocity at flame extinction", "flame imaging (hot flame and cool burning)", "temperature trace", "O2 fraction", "event log with operator actions"],
    "cool_burning": ["flame imaging", "temperature trace", "event times (hot extinction, cool burning, final extinction)"],
    "smoke_detection": ["particle size distribution", "particle concentration", "detector response"],
    "suppression": ["time to extinction", "agent/diluent concentration", "flame imaging", "temperature trace"],
}
_THRESHOLD = {"extinction_under_flow_reduction", "suppression", "cool_burning"}


def _h(*p: str) -> str:
    return sha1("|".join(p).encode()).hexdigest()[:10]


def build_blocks(q: ResearchQuery, oqs: list[OpenQuestion], decisions: dict, corpus, ref_test: Test | None = None) -> list[TestBlock]:
    ep = q.endpoint or "unspecified"
    cfg = {k: v for k, v in q.config.model_dump().items() if v is not None}
    groups: dict[tuple, list[OpenQuestion]] = {}
    for o in oqs:
        groups.setdefault((o.kind if o.kind == "endpoint_gap" else "factor", o.field or "endpoint"), []).append(o)
    blocks = []
    for (kind, factor), grp in sorted(groups.items(), key=lambda kv: min(o.id for o in kv[1])):
        ref = ref_test
        ref_id = ref.id if ref else None
        if kind == "endpoint_gap":
            changed = {"endpoint_run": {"control": "reference setup with a known outcome", "target": f"stated configuration, endpoint {ep}"}}
            fixed = dict(cfg)
        else:
            qkey = {"thickness": "thickness_mm", "flow_velocity": "flow_velocity_cm_s"}.get(factor, factor)
            target_val = cfg.get(qkey, "value to be chosen by the investigators")
            changed = {factor: {"control": f"as recorded in {ref_id}" if ref_id else "reference value", "target": target_val}}
            fixed = {k: v for k, v in cfg.items() if k != qkey}
        control = {"description": f"control run at the reference condition, {factor.replace('_', ' ')} unchanged", "reference_test": ref_id,
                   "reference_series": ref.series if ref else None}
        reps = 3 if q.endpoint in _THRESHOLD else 2
        rationale = (f"Minimum {reps} replicates of the control and of the changed condition so run-to-run scatter is visible"
                     + ("; threshold-type endpoints (extinction, cool burning) vary between runs" if q.endpoint in _THRESHOLD else "") + ".")
        platform = corpus.investigations[ref.investigation_id].platform if ref and corpus else "a facility able to control flow and atmosphere"
        blocks.append(TestBlock(
            id=f"blk_{_h(ep, kind, factor)}", question_id=sorted(o.id for o in grp)[0], target={"endpoint": ep, **cfg}, control=control, fixed=fixed, changed=changed,
            endpoint=ep, measurements=_MEASURE.get(ep, ["endpoint outcome", "flame imaging"]), replicates=reps, replicate_rationale=rationale,
            equipment=[f"facility comparable to: {platform}", "flow and atmosphere control with logging", "imaging of the flame"], runs=reps * 2,
            assumptions=["The reference record's conditions are reproducible (they are provisional in the corpus).",
                         "The changed factor can be varied independently of the others.",
                         "Run counts exclude failed or aborted runs."],
            covers=sorted(o.id for o in grp)))
    return blocks


def _score(items, chosen):
    return sum(w for i, c, w in items if i in chosen)


def select_exact(items: list[tuple[str, int, float]], budget: int, required: set[str] | None = None) -> list[str]:
    """items: (block_id, cost, weight). Maximise weight within budget; ties -> lower cost -> lexicographic ids."""
    required = required or set()
    best: tuple | None = None
    ids = [i for i, _, _ in items]
    for r in range(len(items) + 1):
        for combo in combinations(items, r):
            cost = sum(c for _, c, _ in combo)
            if cost > budget or not required <= {i for i, _, _ in combo}:
                continue
            key = (-sum(w for _, _, w in combo), cost, sorted(i for i, _, _ in combo))
            if best is None or key < best:
                best = key
    return best[2] if best else []


def select_greedy(items: list[tuple[str, int, float]], budget: int, required: set[str] | None = None) -> list[str]:
    chosen: list[str] = []
    left = budget
    by_id = {i: (c, w) for i, c, w in items}
    for rid in sorted(required or []):
        if rid in by_id and by_id[rid][0] <= left:
            chosen.append(rid)
            left -= by_id[rid][0]
    for i, c, w in sorted(items, key=lambda x: (-(x[2] / x[1]), x[1], x[0])):
        if i not in chosen and c <= left:
            chosen.append(i)
            left -= c
    return sorted(chosen)


def plan_programme(q: ResearchQuery, oqs: list[OpenQuestion], decisions: dict, corpus, *, budget_runs: int, must_cover: list[str] | None = None,
                   ref_test: Test | None = None) -> TestProgramme:
    if budget_runs < 1:
        raise ValueError("budget_runs must be at least 1")
    blocks = build_blocks(q, oqs, decisions, corpus, ref_test)
    oq_by_id = {o.id: o for o in oqs}
    items = [(b.id, b.runs, sum(WEIGHT[oq_by_id[c].kind] for c in b.covers if c in oq_by_id)) for b in blocks]
    notes: list[str] = []
    required: set[str] = set()
    for qid in must_cover or []:
        owners = [b for b in blocks if qid in b.covers]
        if not owners:
            notes.append(f"must_cover {qid}: no candidate block addresses it")
        else:
            cheapest = min(owners, key=lambda b: (b.runs, b.id))
            if cheapest.runs > budget_runs:
                notes.append(f"must_cover {qid}: the cheapest block ({cheapest.runs} runs) exceeds the budget")
            else:
                required.add(cheapest.id)
    if sum(1 for b in blocks if b.id in required for _ in [0]) and sum(c for i, c, _ in items if i in required) > budget_runs:
        notes.append("must_cover blocks together exceed the budget; they were dropped")
        required = set()
    method = "exact" if len(blocks) <= EXACT_LIMIT else "greedy"
    chosen = select_exact(items, budget_runs, required) if method == "exact" else select_greedy(items, budget_runs, required)
    sel_blocks = [b for b in blocks if b.id in chosen]
    covered = sorted({c for b in sel_blocks for c in b.covers})
    uncovered = sorted(o.id for o in oqs if o.id not in covered)
    runs_used = sum(b.runs for b in sel_blocks)
    if method == "exact":
        notes.append(f"Exact enumeration of {len(blocks)} candidate blocks: the selection maximises the weighted count of open questions covered within {budget_runs} runs (weights: endpoint gap 3, missing condition 2, comparison 1; weights are a team choice).")
    else:
        notes.append(f"Greedy selection by weight per run over {len(blocks)} candidate blocks; no claim of optimality.")
    notes.append("Coverage counts the open questions a block could potentially check; it is not information gain and does not predict that a question will be resolved.")
    return TestProgramme(blocks=blocks, selected=sorted(chosen), runs_used=runs_used, budget_runs=budget_runs, covered=covered, uncovered=uncovered,
                         method=method, note=" ".join(notes))
