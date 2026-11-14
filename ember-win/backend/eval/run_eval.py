"""Evaluation harness. Run from backend/:  python -m eval.run_eval

Preliminary team evaluation, not independent scientific validation: the gold cases were written by the same team that wrote the
rules and the corpus. Splits are by group id (all cases of one group share a split). Baseline A's one tunable parameter is
chosen on the dev split only; nothing is tuned on validation or test."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from hashlib import sha1
from pathlib import Path

from ember.corpus import load_corpus
from ember.engine import RULES_VERSION, evaluate_test, endpoint_support, compare_tests
from ember.models import ResearchQuery
from ember.pipeline import analyse, make_variant
from ember.retrieval import Retriever, query_text

from .metrics import STATUSES, USABLE, accuracy, applicability_metrics, mean, ndcg_at_k, recall_at_k

HERE = Path(__file__).resolve().parent
LABEL = "preliminary team evaluation, not independent scientific validation"
SPLITS = ["dev", "validation", "test"]


def load_gold(path: Path = HERE / "gold.json") -> list[dict]:
    return json.loads(path.read_text())["cases"]


def assign_splits(cases: list[dict]) -> dict[str, str]:
    groups = sorted({c["group"] for c in cases}, key=lambda g: sha1(f"ember-eval-v1|{g}".encode()).hexdigest())
    n = len(groups)
    n_dev, n_val = round(n * 0.5), round(n * 0.25)
    out = {}
    for i, g in enumerate(groups):
        out[g] = "dev" if i < n_dev else "validation" if i < n_dev + n_val else "test"
    return out


def validate_gold(cases: list[dict], corpus) -> list[str]:
    errs = []
    ids = set()
    for c in cases:
        if c["id"] in ids:
            errs.append(f"duplicate id {c['id']}")
        ids.add(c["id"])
        for k in ("test_id", "test_a", "test_b"):
            if k in c and c[k] not in corpus.tests:
                errs.append(f"{c['id']}: unknown {k} {c[k]}")
        for r in c.get("relevant", []):
            if r not in corpus.investigations:
                errs.append(f"{c['id']}: unknown investigation {r}")
        if "query" in c:
            try:
                ResearchQuery.model_validate(c["query"])
            except Exception as e:
                errs.append(f"{c['id']}: invalid query: {e}")
        for k in ("expected", "expected_before", "expected_after"):
            if k in c and c["type"] in ("applicability", "variant") and c[k] not in STATUSES:
                errs.append(f"{c['id']}: bad status {c[k]}")
    return errs


# ----------------------------------------------------------------------------- systems
class Systems:
    def __init__(self, corpus, retriever: Retriever):
        self.c, self.r = corpus, retriever
        self.k_a = 3  # replaced by tune_a on dev

    # retrieval rankings
    def rank_A(self, q: ResearchQuery) -> list[str]:
        return [i for i, _ in self.r.inv_idx.search(query_text(q))]

    def rank_C(self, q: ResearchQuery) -> list[str]:
        sc = {}
        for inv in self.c.investigations.values():
            n = 0
            for t in self.c.tests_of(inv.id):
                n += self._static_match(q, t)
            sc[inv.id] = n
        return [i for i, _ in sorted(sc.items(), key=lambda kv: (-kv[1], kv[0]))]

    def rank_D(self, q: ResearchQuery) -> list[str]:
        return [h.id for h in self.r.rank_for_query(q)]

    @staticmethod
    def _eq(a, b) -> bool | None:
        if a is None or b is None or str(b).lower() in ("", "unknown", "none"):
            return None  # static matcher skips unknowns (treats them as a match)
        a, b = str(a).lower(), str(b).lower()
        return a in b or b in a

    def _static_match(self, q: ResearchQuery, t) -> bool:
        c = q.config
        for a, b in ((c.material, t.material), (c.shape, t.geometry.shape), (c.gravity_regime, t.gravity.regime)):
            if self._eq(a, b) is False:
                return False
        return True

    # applicability predictions
    def app_A(self, q: ResearchQuery, test_id: str) -> str:
        rank = self.rank_A(q)
        inv = self.c.tests[test_id].investigation_id
        return "direct" if inv in rank[: self.k_a] else "incompatible"

    def app_C(self, q: ResearchQuery, test_id: str) -> str:
        return "direct" if self._static_match(q, self.c.tests[test_id]) else "incompatible"

    def app_D(self, q: ResearchQuery, test_id: str) -> str:
        return evaluate_test(q, self.c.tests[test_id]).status

    def app_Z(self, q, test_id) -> str:
        return "insufficient_data"

    def tune_A(self, dev_cases: list[dict]) -> dict:
        best = None
        for k in range(1, len(self.c.investigations) + 1):
            self.k_a = k
            acc = sum(self.app_A(ResearchQuery.model_validate(c["query"]), c["test_id"]) == c["expected"] for c in dev_cases) / max(1, len(dev_cases))
            if best is None or acc > best[1]:
                best = (k, acc)
        self.k_a = best[0]
        return {"parameter": "top-k investigations treated as applicable", "value": best[0], "tuned_on": "dev", "dev_accuracy": round(best[1], 4), "n_dev_cases": len(dev_cases)}


def run(gold: list[dict] | None = None, corpus=None) -> dict:
    corpus = corpus or load_corpus()
    gold = gold if gold is not None else load_gold()
    retriever = Retriever(corpus)
    errs = validate_gold(gold, corpus)
    if errs:
        raise ValueError("invalid gold file: " + "; ".join(errs))
    split_of = assign_splits(gold)
    S = Systems(corpus, retriever)
    dev_app = [c for c in gold if c["type"] == "applicability" and split_of[c["group"]] == "dev"]
    tuning = {"A": S.tune_A(dev_app), "C": "no tunable parameters", "D": "no tuning on gold; rule tolerances were fixed before evaluation (see rules registry)"}

    def in_split(split):
        return [c for c in gold if split == "all" or split_of[c["group"]] == split]

    results: dict = {"retrieval": {}, "applicability": {}, "endpoint_support": {}, "contrast": {}, "variant": {}, "false_premise": {}}
    failures = []
    for split in SPLITS + ["all"]:
        cs = in_split(split)
        # retrieval
        ret = {}
        rc = [c for c in cs if c["type"] == "retrieval"]
        for name, fn in (("A", S.rank_A), ("C", S.rank_C), ("D", S.rank_D)):
            rs = [(fn(ResearchQuery.model_validate(c["query"])), c["relevant"]) for c in rc]
            ret[name] = {"n": len(rs), "recall@5": mean([recall_at_k(r, rel, 5) for r, rel in rs]), "ndcg@5": mean([ndcg_at_k(r, rel, 5) for r, rel in rs]),
                         "recall@3": mean([recall_at_k(r, rel, 3) for r, rel in rs])} if rs else {"n": 0, "status": "not measured: no cases in this split"}
        results["retrieval"][split] = ret
        # applicability
        ac = [c for c in cs if c["type"] == "applicability"]
        app = {}
        for name, fn in (("A", S.app_A), ("C", S.app_C), ("D", S.app_D), ("Z_always_insufficient", S.app_Z)):
            pairs = []
            for c in ac:
                pred = fn(ResearchQuery.model_validate(c["query"]), c["test_id"])
                pairs.append((c["expected"], pred))
                if name == "D" and split != "all" and pred != c["expected"]:
                    failures.append({"case": c["id"], "split": split, "type": "applicability", "tags": c["tags"], "test_id": c["test_id"], "expected": c["expected"], "got": pred})
            app[name] = applicability_metrics(pairs)
        results["applicability"][split] = app
        # endpoint support (D only)
        ec = [c for c in cs if c["type"] == "endpoint_support"]
        flags = []
        for c in ec:
            got = endpoint_support(corpus.tests[c["test_id"]], c["endpoint"])[0]
            flags.append(got == c["expected"])
            if split != "all" and got != c["expected"]:
                failures.append({"case": c["id"], "split": split, "type": "endpoint_support", "expected": c["expected"], "got": got})
        results["endpoint_support"][split] = {"D": accuracy(flags), "A": "not measured", "C": "not measured"}
        # contrast (D only)
        kc = [c for c in cs if c["type"] == "contrast"]
        flags = []
        for c in kc:
            ct = compare_tests(corpus.tests[c["test_a"]], corpus.tests[c["test_b"]], c["endpoint"])
            ok = ct.allowed == c["expected_allowed"] and (not c["expected_allowed"] or ct.changed_factors == c["expected_changed"])
            flags.append(ok)
            if split != "all" and not ok:
                failures.append({"case": c["id"], "split": split, "type": "contrast", "expected": [c["expected_allowed"], c["expected_changed"]], "got": [ct.allowed, ct.changed_factors]})
        results["contrast"][split] = {"D": accuracy(flags), "A": "not measured", "C": "not measured"}
        # variants (D only)
        vc = [c for c in cs if c["type"] == "variant"]
        flags = []
        for c in vc:
            base = analyse(ResearchQuery.model_validate(c["query"]), corpus, retriever, review_id="eval_base", created="2000-01-01T00:00:00Z", explain_fn=None)
            var, diff = make_variant(base, c["patch"], corpus, retriever, new_id="eval_var", created="2000-01-01T00:00:00Z", explain_fn=None)
            b = next(t.decisions[0].status for t in base.tests_considered if t.test_id == c["test_id"])
            a = next(t.decisions[0].status for t in var.tests_considered if t.test_id == c["test_id"])
            ok = (b, a) == (c["expected_before"], c["expected_after"]) and bool(diff)
            flags.append(ok)
            if split != "all" and not ok:
                failures.append({"case": c["id"], "split": split, "type": "variant", "expected": [c["expected_before"], c["expected_after"]], "got": [b, a]})
        results["variant"][split] = {"D": accuracy(flags), "A": "not measured", "C": "not measured"}
        # false premise / nothing usable
        fc = [c for c in cs if c["type"] == "false_premise"]
        fp = {}
        for name in ("A", "C", "D"):
            flags = []
            for c in fc:
                q = ResearchQuery.model_validate(c["query"])
                if name == "D":
                    usable = [t for t in corpus.tests if evaluate_test(q, corpus.tests[t]).status in USABLE]
                    rv = analyse(q, corpus, retriever, review_id="eval_fp", created="2000-01-01T00:00:00Z", explain_fn=None)
                    ok = not usable and any("not in the corpus" in w or "No record" in w or "No endpoint" in w for w in rv.warnings)
                else:
                    usable = [t for t in corpus.tests if (S.app_A if name == "A" else S.app_C)(q, t) in USABLE]
                    ok = not usable
                flags.append(ok)
                if name == "D" and split != "all" and not ok:
                    failures.append({"case": c["id"], "split": split, "type": "false_premise", "expected": "no usable tests and a visible warning", "got": f"{len(usable)} usable"})
            fp[name] = accuracy(flags)
        results["false_premise"][split] = fp
    by_type, by_cat = {}, {}
    for c in gold:
        by_type[c["type"]] = by_type.get(c["type"], 0) + 1
        by_cat[c["category"]] = by_cat.get(c["category"], 0) + 1
    tag_counts: dict[str, int] = {}
    for c in gold:
        for t in c["tags"]:
            tag_counts[t] = tag_counts.get(t, 0) + 1
    return {
        "status": "measured", "label": LABEL,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "versions": {"rules": RULES_VERSION, "corpus": corpus.version, "corpus_hash": corpus.content_hash},
        "systems": {"A": "BM25 only (whole-record index); applicability = investigation in top-k", "C": "static matcher: exact material/shape/gravity-name equality, unknown fields skipped, no endpoint/event/protocol reasoning",
                    "D": "full EMBER engine: BM25 + structured filters + RRF, semantic applicability rules, endpoint-to-event mapping",
                    "Z_always_insufficient": "sanity baseline that always answers insufficient_data; the positive cases are there so it fails"},
        "baseline_tuning": tuning,
        "gold": {"n_cases": len(gold), "by_type": by_type, "by_category": by_cat, "by_tag": dict(sorted(tag_counts.items())),
                 "groups": {g: s for g, s in sorted(split_of.items())}, "cases_per_split": {s: len(in_split(s)) for s in SPLITS}},
        **results, "failures_D": failures,
        "caveats": [
            "Agreement of D with the gold labels is partly circular: the labels follow the same semantic reasoning that the rules encode. A high D score shows internal consistency and that the baselines cannot do this task, not accuracy on unseen scientific questions.",
            "Gold cases are team-authored and few; confidence intervals are wide and small differences are not meaningful.",
            "The engine's rules and the corpus were written by the same team that wrote the gold cases, so the test split is not independent of design decisions.",
            "Splits are by group id so near-duplicate cases do not straddle splits; nothing was tuned on validation or test.",
            "Applicability labels for the baselines are mappings (top-k -> direct, static match -> direct); the baselines were not designed to emit the 4 statuses.",
            "Retrieval is over 8 investigations, so recall@5 is easy to satisfy by construction; nDCG@5 and recall@3 are more informative.",
            "Not measured: dense retrieval, Jev, live_ai explanation faithfulness, any expert-labelled data."],
    }


def main(out: Path = HERE / "results.json") -> dict:
    res = run()
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(res, indent=1) + "\n")
    tmp.replace(out)
    return res


if __name__ == "__main__":
    res = main()
    for split in SPLITS + ["all"]:
        d = res["applicability"][split]["D"]
        print(split, "applicability D acc", d.get("accuracy"), "| A", res["applicability"][split]["A"].get("accuracy"), "| C", res["applicability"][split]["C"].get("accuracy"),
              "| retrieval nDCG@5 D", res["retrieval"][split]["D"].get("ndcg@5"))
    print("failures D:", len(res["failures_D"]))
    sys.exit(0)
