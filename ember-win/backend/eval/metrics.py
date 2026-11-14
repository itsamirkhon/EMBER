from __future__ import annotations

import math
from collections import Counter

STATUSES = ["direct", "limited_context", "incompatible", "insufficient_data"]
USABLE = {"direct", "limited_context"}


def recall_at_k(ranked: list[str], relevant: list[str], k: int) -> float:
    return len(set(ranked[:k]) & set(relevant)) / len(relevant)


def ndcg_at_k(ranked: list[str], relevant: list[str], k: int) -> float:
    dcg = sum(1.0 / math.log2(i + 2) for i, d in enumerate(ranked[:k]) if d in relevant)
    ideal = sum(1.0 / math.log2(i + 2) for i in range(min(k, len(relevant))))
    return dcg / ideal if ideal else 0.0


def _div(a: float, b: float):
    return round(a / b, 4) if b else None


def applicability_metrics(pairs: list[tuple[str, str]]) -> dict:
    """pairs: (expected, predicted)."""
    n = len(pairs)
    if n == 0:
        return {"n": 0, "status": "not measured: no cases in this split"}
    conf = {e: {p: 0 for p in STATUSES} for e in STATUSES}
    for e, p in pairs:
        conf[e][p] += 1
    per = {}
    for s in STATUSES:
        tp = conf[s][s]
        pred = sum(conf[e][s] for e in STATUSES)
        gold = sum(conf[s].values())
        per[s] = {"precision": _div(tp, pred), "recall": _div(tp, gold), "support": gold}
    gold_pos = [(e, p) for e, p in pairs if e in USABLE]
    gold_neg = [(e, p) for e, p in pairs if e not in USABLE]
    pred_pos = [(e, p) for e, p in pairs if p in USABLE]
    return {"n": n, "accuracy": _div(sum(e == p for e, p in pairs), n), "per_class": per, "confusion": conf,
            "usable_precision": _div(sum(e in USABLE for e, p in pred_pos), len(pred_pos)),
            "usable_recall": _div(sum(p in USABLE for e, p in gold_pos), len(gold_pos)),
            "false_refusal_rate": _div(sum(p not in USABLE for e, p in gold_pos), len(gold_pos)),
            "over_acceptance_rate": _div(sum(p in USABLE for e, p in gold_neg), len(gold_neg)),
            "n_gold_usable": len(gold_pos), "n_gold_not_usable": len(gold_neg)}


def mean(xs: list[float]):
    return round(sum(xs) / len(xs), 4) if xs else None


def accuracy(flags: list[bool]) -> dict:
    return {"n": len(flags), "accuracy": _div(sum(flags), len(flags)) if flags else None} if flags else {"n": 0, "status": "not measured: no cases in this split"}
