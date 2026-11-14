"""Retrieval: own BM25 + structured filters + reciprocal rank fusion (RRF).
Dense and Jev/TypeSafe branches are flag-off stubs behind the same interface."""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Protocol

from .corpus import Corpus
from .engine import ENDPOINT_REQUIREMENTS, canon_material, canon_shape, endpoint_support
from .models import ResearchQuery, Test

STOP = {"the", "a", "an", "of", "in", "on", "and", "or", "to", "for", "is", "are", "with", "what", "how", "does", "do", "at", "by", "from", "as", "it", "be", "this", "that", "under"}


def tokenize(text: str) -> list[str]:
    toks = re.findall(r"[a-z0-9]+", text.lower())
    out = []
    for t in toks:
        if t in STOP:
            continue
        if len(t) > 4 and t.endswith("ies"):
            t = t[:-3] + "y"
        elif len(t) > 3 and t.endswith("s") and not t.endswith("ss"):
            t = t[:-1]
        out.append(t)
    return out


class BM25:
    def __init__(self, docs: list[tuple[str, str]], k1: float = 1.5, b: float = 0.75):
        self.k1, self.b = k1, b
        self.ids = [d for d, _ in docs]
        self.tf = [Counter(tokenize(t)) for _, t in docs]
        self.len = [sum(c.values()) for c in self.tf]
        self.avg = (sum(self.len) / len(self.len)) if self.len else 0.0
        df: Counter = Counter()
        for c in self.tf:
            df.update(c.keys())
        n = len(docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def score(self, query: str) -> dict[str, tuple[float, list[str]]]:
        qt = tokenize(query)
        res: dict[str, tuple[float, list[str]]] = {}
        for i, doc_id in enumerate(self.ids):
            s, matched = 0.0, []
            for t in dict.fromkeys(qt):
                f = self.tf[i].get(t, 0)
                if not f:
                    continue
                denom = f + self.k1 * (1 - self.b + self.b * self.len[i] / (self.avg or 1))
                s += self.idf.get(t, 0) * f * (self.k1 + 1) / denom
                matched.append(t)
            if s > 0:
                res[doc_id] = (s, matched)
        return res

    def search(self, query: str) -> list[tuple[str, float]]:
        sc = self.score(query)
        return sorted(((i, v[0]) for i, v in sc.items()), key=lambda x: (-x[1], x[0]))


def rrf(rankings: list[list[str]], k: int = 60) -> list[tuple[str, float]]:
    """Reciprocal rank fusion; ties broken by first appearance order (stable)."""
    score: dict[str, float] = defaultdict(float)
    first: dict[str, int] = {}
    n = 0
    for r in rankings:
        for rank, d in enumerate(r, 1):
            score[d] += 1.0 / (k + rank)
            if d not in first:
                first[d] = n
                n += 1
    return sorted(score.items(), key=lambda x: (-x[1], first[x[0]]))


class NotEnabled(RuntimeError):
    pass


class RetrieverBranch(Protocol):
    enabled: bool

    def search(self, query: str) -> list[tuple[str, float]]: ...


class DenseRetriever:
    """Flag-off stub: dense embeddings are not implemented; the default path never calls it."""
    enabled = False

    def search(self, query: str) -> list[tuple[str, float]]:
        raise NotEnabled("dense retrieval is disabled (feature flag off, not implemented)")


class JevRetriever:
    """Flag-off stub for the Jev/TypeSafe branch."""
    enabled = False

    def search(self, query: str) -> list[tuple[str, float]]:
        raise NotEnabled("Jev/TypeSafe retrieval is disabled (feature flag off, not implemented)")


@dataclass
class Hit:
    id: str
    score: float
    why: str
    matched_terms: list[str] = field(default_factory=list)
    components: dict = field(default_factory=dict)


def inv_text(inv) -> str:
    return " ".join([inv.name, inv.summary_goal, inv.platform, *inv.families, *inv.materials, *inv.measurements, *inv.topics, *inv.limitations,
                     *(c.text for c in inv.text_chunks)])


def test_text(t: Test) -> str:
    parts = [t.series, t.material or "", t.phase, t.geometry.shape or "", t.substrate_confinement or "", t.flow.history_summary, t.flow.history_kind,
             t.gravity.platform, t.curation_note, " ".join(s.description for s in t.protocol), " ".join(e.kind.replace("_", " ") + " " + e.note for e in t.events),
             " ".join(m.name for m in t.measurements), t.record_type, t.observation_status]
    return " ".join(parts).replace("_", " ")


_EP_WORDS = {
    "ignition": "ignition ignite", "flame_establishment": "flame establishment", "sustained_spread": "flame spread sustained",
    "extinction_under_flow_reduction": "extinction flow reduction extinguish", "cool_burning": "cool flame hot extinction cool burning",
    "smoke_detection": "smoke aerosol particle detection detector", "suppression": "suppression extinguishment diluent",
}


def query_text(q: ResearchQuery) -> str:
    c = q.config
    bits = [q.question, c.material or "", c.shape or "", c.gravity_regime or "", _EP_WORDS.get(q.endpoint or "", ""), q.topic or "", c.flow_history or "", c.substrate or ""]
    return " ".join(bits)


class Retriever:
    def __init__(self, corpus: Corpus, dense: RetrieverBranch | None = None, jev: RetrieverBranch | None = None):
        self.c = corpus
        self.dense, self.jev = dense or DenseRetriever(), jev or JevRetriever()
        self.inv_idx = BM25([(i.id, inv_text(i)) for i in corpus.investigations.values()])
        self.chunk_idx = BM25([(f"{i.id}::{ch.id}", f"{ch.section} {ch.text}") for i in corpus.investigations.values() for ch in i.text_chunks])
        self.test_idx = BM25([(t.id, test_text(t)) for t in corpus.tests.values()])

    # ---- filters (hard)
    def _pass_filters(self, inv, topic=None, material=None, platform=None, family=None) -> bool:
        def has(vals, needle):
            return any(needle.lower() in v.lower() for v in vals)
        return ((not topic or topic in inv.topics) and (not material or has(inv.materials, material))
                and (not platform or platform.lower() in inv.platform.lower()) and (not family or has(inv.families, family)))

    def search_investigations(self, text: str | None, *, topic=None, material=None, platform=None, family=None) -> list[Hit]:
        allowed = [i for i in self.c.investigations.values() if self._pass_filters(i, topic, material, platform, family)]
        if not text or not text.strip():
            return [Hit(i.id, 0.0, "matches the structured filters" if any([topic, material, platform, family]) else "no query given; listed in corpus order") for i in allowed]
        ids = {i.id for i in allowed}
        whole = self.inv_idx.score(text)
        chunk = self.chunk_idx.score(text)
        best_chunk: dict[str, tuple[float, list[str]]] = {}
        for k, v in chunk.items():
            iid = k.split("::")[0]
            if iid in ids and (iid not in best_chunk or v[0] > best_chunk[iid][0]):
                best_chunk[iid] = v
        r_whole = [i for i, _ in sorted(((i, v[0]) for i, v in whole.items() if i in ids), key=lambda x: (-x[1], x[0]))]
        r_chunk = [i for i, _ in sorted(((i, v[0]) for i, v in best_chunk.items()), key=lambda x: (-x[1], x[0]))]
        fused = rrf([r_whole, r_chunk])
        hits = []
        for iid, sc in fused:
            terms = sorted(set(whole.get(iid, (0, []))[1]) | set(best_chunk.get(iid, (0, []))[1]))
            hits.append(Hit(iid, sc, f"BM25 matched terms: {', '.join(terms)}; rank by whole record {r_whole.index(iid) + 1 if iid in r_whole else '-'}, "
                                      f"by best text chunk {r_chunk.index(iid) + 1 if iid in r_chunk else '-'}; fused with RRF.", terms))
        return hits

    def search_tests(self, text: str, investigation_ids: list[str] | None = None) -> list[Hit]:
        sc = self.test_idx.score(text)
        out = []
        for tid, (s, terms) in sc.items():
            if investigation_ids and self.c.tests[tid].investigation_id not in investigation_ids:
                continue
            out.append(Hit(tid, s, f"BM25 matched terms: {', '.join(terms)}", terms))
        return sorted(out, key=lambda h: (-h.score, h.id))

    # ---- structured match for a ResearchQuery
    def structured_facets(self, inv, q: ResearchQuery) -> tuple[int, list[str]]:
        c = q.config
        n, why = 0, []
        tests = self.c.tests_of(inv.id)
        qm, qphase = canon_material(c.material)
        if qm and any(canon_material(t.material)[0] == qm for t in tests):
            n += 2
            why.append(f"material {c.material}")
        elif qphase and any(t.phase == qphase for t in tests):
            n += 1
            why.append(f"{qphase} fuel phase")
        qs = canon_shape(c.shape)
        if qs and any(canon_shape(t.geometry.shape) == qs for t in tests):
            n += 1
            why.append(f"shape {qs}")
        if c.gravity_regime and any(t.gravity.regime == c.gravity_regime for t in tests):
            n += 1
            why.append(f"{c.gravity_regime}")
        if q.endpoint and any(endpoint_support(t, q.endpoint)[0] in ("observed", "partial") for t in tests):
            n += 2
            why.append(f"records the {q.endpoint.replace('_', ' ')} outcome")
        if q.topic and q.topic in inv.topics:
            n += 1
            why.append(f"topic {q.topic}")
        return n, why

    def rank_for_query(self, q: ResearchQuery) -> list[Hit]:
        text = query_text(q)
        hits = {h.id: h for h in self.search_investigations(text)}
        bm25_rank = [h.id for h in hits.values()]
        struct = {}
        for i in self.c.investigations.values():
            n, why = self.structured_facets(i, q)
            if n:
                struct[i.id] = (n, why)
        r_struct = [i for i, _ in sorted(((i, v[0]) for i, v in struct.items()), key=lambda x: (-x[1], x[0]))]
        fused = rrf([bm25_rank, r_struct, r_struct])  # structured evidence counted twice: it is the more precise signal
        out = []
        for iid, sc in fused:
            base = hits.get(iid)
            sw = struct.get(iid, (0, []))[1]
            why = (base.why if base else "no BM25 match") + (f" Structured match: {', '.join(sw)}." if sw else " No structured match.")
            out.append(Hit(iid, sc, why, base.matched_terms if base else [], {"bm25_rank": bm25_rank.index(iid) + 1 if iid in bm25_rank else None, "structured": struct.get(iid, (0, []))[0]}))
        return out
