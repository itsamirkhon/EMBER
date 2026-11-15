"""Verification suite for EMBER v2 corpus builder outputs."""

from __future__ import annotations

import hashlib
import json
import math
import sqlite3
import unittest
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

ROOT = Path(__file__).resolve().parent.parent
CORPUS_PATH = ROOT / "public" / "data" / "corpus_v2.json"
CHUNKS_PATH = ROOT / "public" / "data" / "chunks_index.json"
MANIFEST_PATH = ROOT / "public" / "data" / "manifest_v2.json"
SQLITE_PATH = ROOT / "data" / "ember_corpus.sqlite"
SOURCES_CACHE_PATH = ROOT / "data" / "sources_cache.json"


def _norm_ws(s: str | None) -> str:
    if not s:
        return ""
    s = (
        s.replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2013", "-")
        .replace("\u2014", "-")
    )
    return " ".join(s.lower().split())


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for blk in iter(lambda: f.read(65536), b""):
            h.update(blk)
    return h.hexdigest()


class TestBassOutcomeReconstruction(unittest.TestCase):
    def build(self, outcome: str):
        from pipeline.build_corpus import _segments_bass_family, make_sv
        row = {"testId": "BASS-test", "inv": "BASS", "outcome": outcome}
        flow = {"initialFlowCmS": make_sv(5, "cm/s", "reported"), "direction": "opposed"}
        atmosphere = {"o2": make_sv(21, "%", "reported"), "pressure": make_sv(101, "kPa", "reported")}
        return _segments_bass_family(row, flow, atmosphere, {})

    def test_unknown_does_not_invent_ignition_or_burning(self):
        segments, events, initial, terminal = self.build("unknown")
        self.assertEqual(initial, "unknown")
        self.assertIsNone(terminal)
        self.assertEqual(events, [])
        self.assertFalse(any(s["stageType"] in ("steady_burn", "termination") for s in segments))
        self.assertTrue(all("reconstruct" in s["description"].lower() for s in segments))

    def test_all_unknown_legacy_bass_records_remain_unknown(self):
        from pipeline.build_corpus import _segments_bass_family, make_sv
        rows = json.loads((ROOT / "data/legacy_seed/tests.json").read_text())
        unknown_rows = [r for r in rows if r["inv"] in ("BASS", "BASS-II") and r.get("outcome") == "unknown"]
        self.assertEqual(len(unknown_rows), 16)
        flow = {"initialFlowCmS": make_sv(None, "cm/s", "unknown"), "direction": "unknown"}
        atmosphere = {"o2": make_sv(None, "%", "unknown"), "pressure": make_sv(None, "kPa", "unknown")}
        for row in unknown_rows:
            with self.subTest(test_id=row["testId"]):
                _, events, initial, terminal = _segments_bass_family(row, flow, atmosphere, {})
                self.assertEqual(events, [])
                self.assertEqual(initial, "unknown")
                self.assertIsNone(terminal)

    def test_inferred_ignition_is_derived_not_reported(self):
        _, events, initial, _ = self.build("burned")
        ignition = next(e for e in events if e["endpoint"] == "flame_establishment")
        self.assertEqual(ignition["observedValue"]["provenance"], "derived")
        self.assertEqual(initial, "ignited_burned")

    def test_reported_negative_ignition_remains_observed(self):
        _, events, initial, _ = self.build("no_ignition")
        self.assertEqual(initial, "no_ignition")
        self.assertEqual(events[0]["observedValue"]["provenance"], "reported")
        self.assertEqual(events[0]["observedValue"]["value"], "no_ignition")


class TestEmberCorpusV2(unittest.TestCase):
    corpus: dict
    chunks_index: dict
    manifest: dict
    sources_cache: dict[str, dict]
    tests_by_id: dict[str, dict]
    invs_by_id: dict[str, dict]
    claims_by_id: dict[str, dict]

    @classmethod
    def setUpClass(cls) -> None:
        cls.corpus = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
        cls.chunks_index = json.loads(CHUNKS_PATH.read_text(encoding="utf-8"))
        cls.manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        sc = json.loads(SOURCES_CACHE_PATH.read_text(encoding="utf-8"))
        cls.sources_cache = {s["sourceId"]: s for s in sc}
        cls.tests_by_id = {t["testId"]: t for t in cls.corpus["tests"]}
        cls.invs_by_id = {i["id"]: i for i in cls.corpus["investigations"]}
        cls.claims_by_id = {c["id"]: c for c in cls.corpus["claims"]}

    def test_top_level_schema_and_counts(self) -> None:
        expected_keys = {
            "corpusVersion",
            "generatedAt",
            "investigations",
            "tests",
            "claims",
            "missions",
            "earth",
            "history",
            "sources",
            "extractionEval",
            "outcomeAudit",
        }
        self.assertEqual(set(self.corpus.keys()), expected_keys)
        self.assertEqual(self.corpus["corpusVersion"], "2.0.2-bass-provenance")
        self.assertEqual(len(self.corpus["investigations"]), 15)
        self.assertEqual(len(self.corpus["tests"]), 1678)
        self.assertEqual(len(self.corpus["claims"]), 145)
        self.assertEqual(len(self.corpus["missions"]), 6)
        self.assertEqual(len(self.corpus["earth"]), 9)
        self.assertEqual(len(self.corpus["history"]), 5)

        self.assertEqual(self.invs_by_id["FLEX-2"]["epistemicStatus"], "planned_only")
        self.assertEqual(self.invs_by_id["FLEX-2"]["coverageSummary"]["totalRows"], 0)
        for iid, inv in self.invs_by_id.items():
            if iid != "FLEX-2":
                self.assertEqual(inv["epistemicStatus"], "observed")
                self.assertGreater(inv["coverageSummary"]["totalRows"], 0)

    def test_bass_ii_b1_m1_and_rods(self) -> None:
        b1 = self.tests_by_id["BASS-II-B1"]
        self.assertEqual(b1["flow"]["direction"], "opposed")
        self.assertEqual(b1["flow"]["history"], "abrupt_cutoff")
        self.assertEqual(b1["widthCm"]["value"], 2.0)
        self.assertGreaterEqual(len(b1["segments"]), 3)
        self.assertIsNone(b1["segments"][0]["timeStartS"])
        self.assertEqual(b1["segments"][-1]["intervention"], "flow_shutoff")
        self.assertTrue(any(e["endpoint"] == "extinction_under_flow_change" for e in b1["events"]))
        self.assertTrue(any(e["endpoint"] == "spread_rate" and e["observedValue"]["value"] == 2.2 for e in b1["events"]))

        m1 = self.tests_by_id["BASS-II-M1"]
        self.assertEqual(m1["substrateConfinement"], "1_sided_insulated")
        self.assertEqual(m1["flow"]["direction"], "opposed")
        self.assertEqual(m1["flow"]["history"], "stepped_down")
        self.assertEqual(m1["flow"]["sequenceCmS"], [10.0, 8.0])
        self.assertTrue(any(s["stageType"] == "flow_modification" and s["intervention"] == "flow_stepped_down" for s in m1["segments"]))
        self.assertTrue(any(e["endpoint"] == "spread_rate" and math.isclose(e["observedValue"]["value"], 0.071) for e in m1["events"]))

        o1 = self.tests_by_id["BASS-II-O1"]
        self.assertEqual(o1["geometry"], "cylinder (rod)")
        self.assertEqual(o1["diameterMm"]["value"], 6.35)
        self.assertEqual(o1["flow"]["direction"], "axial_stagnation")
        self.assertEqual(o1["flow"]["history"], "stepped_down")
        self.assertEqual(o1["flow"]["sequenceCmS"], [20.0, 10.0, 5.0, 2.0, 1.0])
        flow_mods = [s for s in o1["segments"] if s["stageType"] == "flow_modification"]
        self.assertEqual(len(flow_mods), 4)

        p18 = self.tests_by_id["BASS-II-P18"]
        self.assertEqual(p18["flow"]["direction"], "opposed")
        self.assertEqual(p18["flow"]["history"], "pulsed")
        self.assertTrue(any(e["endpoint"] == "quench_limit" for e in p18["events"]))

        p16 = self.tests_by_id["BASS-II-P16"]
        self.assertEqual(p16["flow"]["direction"], "concurrent")

    def test_bass_sphere_repair_and_reused_group_ids(self) -> None:
        bass_rows = [t for t in self.corpus["tests"] if t["inv"] == "BASS"]
        self.assertEqual(len(bass_rows), 121)
        self.assertTrue(all(t["geometry"] is not None for t in bass_rows))

        b15 = self.tests_by_id["BASS-15-54"]
        b16 = self.tests_by_id["BASS-16-55"]
        b19 = self.tests_by_id["BASS-19-110"]
        self.assertEqual(b15["geometry"], "sphere")
        self.assertEqual(b15["diameterMm"]["value"], 20.0)
        self.assertEqual(b15["groupId"], b16["groupId"])
        self.assertEqual(b15["groupId"], b19["groupId"])
        self.assertTrue(any(s["intervention"] == "n2_jet_applied" for s in b16["segments"]))

    def test_cfi_cool_flame_separation(self) -> None:
        c1206 = self.tests_by_id["CFI-1206"]
        self.assertEqual(c1206["substrateConfinement"], "free_droplet")
        self.assertGreaterEqual(len(c1206["segments"]), 3)
        self.assertTrue(any(e["endpoint"] == "hot_flame_extinction" and math.isclose(e["observedValue"]["value"], 3.577) for e in c1206["events"]))
        cool_events = [e for e in c1206["events"] if e["endpoint"] == "cool_flame_continuation"]
        self.assertEqual(len(cool_events), 2)
        # Cool-flame continuation events must be bound to segment 2 (separate from segment 1 hot flame)
        self.assertTrue(all(e["segmentId"].endswith("-seg-2") for e in cool_events))

        cfi_rows = [t for t in self.corpus["tests"] if t["inv"] == "CFI"]
        cool_count = sum(1 for t in cfi_rows if any(e["endpoint"] == "cool_flame_continuation" for e in t["events"]))
        self.assertGreaterEqual(cool_count, 50)
        fiber_rows = [t for t in cfi_rows if (t["extra"] or {}).get("Fiber") == "Yes"]
        self.assertTrue(all(t["substrateConfinement"] == "sic_fiber_tethered" for t in fiber_rows))

    def test_cfi_g_oxidizer_stream_role(self) -> None:
        cfig = [t for t in self.corpus["tests"] if t["inv"] == "ACME-CFI-G"]
        self.assertEqual(len(cfig), 333)
        inverse = [t for t in cfig if "-I-" in t["testId"]]
        normal = [t for t in cfig if "-N-" in t["testId"]]
        self.assertEqual(len(inverse), 154)
        self.assertEqual(len(normal), 179)
        self.assertTrue(all(t["atmosphere"]["o2"]["role"] == "oxidizer_stream" for t in inverse))
        self.assertTrue(all(t["atmosphere"]["o2"]["role"] == "ambient" for t in normal))

    def test_same_and_same_r_assumed_provenance_and_aging_pairs(self) -> None:
        same_all = [t for t in self.corpus["tests"] if t["inv"] in ("SAME", "SAME-R")]
        self.assertEqual(len(same_all), 64 + 109)
        for t in same_all:
            self.assertEqual(t["atmosphere"]["o2"]["provenance"], "assumed")
            self.assertEqual(t["atmosphere"]["pressure"]["provenance"], "assumed")
            self.assertEqual(len(t["segments"]), 2)
            self.assertEqual(t["segments"][0]["stageType"], "preparation")
            self.assertEqual(t["segments"][1]["stageType"], "aging")

        self.assertEqual(self.tests_by_id["SAME-11"]["groupId"], self.tests_by_id["SAME-11a"]["groupId"])
        self.assertEqual(self.tests_by_id["SAME-R-61"]["groupId"], self.tests_by_id["SAME-R-61a"]["groupId"])

    def test_spice_and_acme_efield(self) -> None:
        spice = [t for t in self.corpus["tests"] if t["inv"] == "SPICE"]
        self.assertEqual(len(spice), 469)
        for t in spice:
            self.assertEqual(len(t["events"]), 1)
            self.assertEqual(t["events"][0]["endpoint"], "smoke_point_length")
            self.assertIn(t["events"][0]["eventType"], ("smoke_point_determination", "jet_flame_observation"))
            self.assertEqual(t["atmosphere"]["o2"]["provenance"], "assumed")
        sp_det = sum(1 for t in spice if t["events"][0]["eventType"] == "smoke_point_determination")
        self.assertEqual(sp_det, 53)

        efield = [t for t in self.corpus["tests"] if t["inv"] == "ACME-E-FIELD"]
        self.assertEqual(len(efield), 32)
        for t in efield:
            self.assertEqual(t["gravity"]["regime"], "microgravity")
            self.assertEqual(t["gravity"]["platform"], "ISS")
            self.assertEqual(t["gravity"]["mode"], "actual_flight")

    def test_fixed_and_verified_claims(self) -> None:
        for cid, c in self.claims_by_id.items():
            sid = c["sourceRef"]["sourceId"]
            src_txt = self.sources_cache[sid]["text"]
            self.assertIn(_norm_ws(c["sourceRef"]["quote"]), _norm_ws(src_txt), f"Verbatim quote failed for {cid}")

        fixed_ids = {"c-0021", "c-0037", "c-0041", "c-0045", "c-0101", "c-0105", "c-0109", "c-0113"}
        for cid in fixed_ids:
            c = self.claims_by_id[cid]
            self.assertEqual(c["verificationStatus"], "corrected")
            self.assertTrue(len(c["limitations"]) > 0, cid)
            self.assertTrue(len(c["conditionsScope"]) > 0, cid)

        for planned_id in ("c-0041", "c-0101", "c-0109", "c-0113"):
            self.assertEqual(self.claims_by_id[planned_id]["epistemicStatus"], "planned")
        self.assertIn("0.25-0.5 atm", self.claims_by_id["c-0101"]["limitations"][0])
        self.assertIn("FLEX", self.claims_by_id["c-0105"]["limitations"][0])
        self.assertIn("BASS and BASS-II", self.claims_by_id["c-0021"]["text"])

    def test_sqlite_integrity_and_row_counts(self) -> None:
        conn = sqlite3.connect(str(SQLITE_PATH))
        conn.execute("PRAGMA foreign_keys = ON;")
        self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        self.assertEqual(tables, {"investigations", "tests", "protocol_segments", "events", "claims", "chunks", "sources"})

        self.assertEqual(conn.execute("SELECT COUNT(*) FROM investigations").fetchone()[0], 15)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM tests").fetchone()[0], 1678)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM claims").fetchone()[0], 145)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0], len(self.chunks_index["chunks"]))
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM protocol_segments").fetchone()[0], sum(len(t["segments"]) for t in self.corpus["tests"]))
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM events").fetchone()[0], sum(len(t["events"]) for t in self.corpus["tests"]))
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM tests WHERE o2_role = 'oxidizer_stream'").fetchone()[0], 154)
        conn.close()

    def test_chunks_index_lsa_and_manifest_hashes(self) -> None:
        idx = self.chunks_index
        self.assertEqual(
            set(idx.keys()),
            {"corpusVersion", "embeddingModel", "embeddingDim", "vocabulary", "idf", "svdComponents", "chunks"},
        )
        self.assertEqual(idx["embeddingDim"], 64)
        vocab = idx["vocabulary"]
        idf = idx["idf"]
        comp = np.array(idx["svdComponents"], dtype=float)
        self.assertLessEqual(len(vocab), 1600)
        self.assertEqual(len(idf), len(vocab))
        self.assertEqual(comp.shape, (64, len(vocab)))

        for ch in idx["chunks"]:
            v = np.array(ch["vector"], dtype=float)
            self.assertEqual(len(v), 64)
            norm = float(np.linalg.norm(v))
            self.assertAlmostEqual(norm, 1.0, places=3, msg=ch["chunkId"])

        # Verify client-side projection algebra matches stored vector for sample chunk
        sample = next(c for c in idx["chunks"] if c["kind"] == "investigation" and c["inv"] == "CFI")
        vec_ref = np.array(sample["vector"], dtype=float)
        tf_probe = TfidfVectorizer(vocabulary=vocab, ngram_range=(1, 2), stop_words="english", lowercase=True)
        # Recompute raw TF vector weighted by exported idf and normalized L2
        counts = tf_probe.fit_transform([sample["text"]]).toarray()[0]
        # Binary/TF matching sklearn TfidfTransformer: (tf * idf) / ||tf * idf||
        # CountVectorizer avoids re-fitting idf; rebuild exact counts cleanly:
        from sklearn.feature_extraction.text import CountVectorizer
        cv = CountVectorizer(vocabulary=vocab, ngram_range=(1, 2), stop_words="english", lowercase=True)
        raw_tf = cv.transform([sample["text"]]).toarray()[0].astype(float)
        tfidf_q = raw_tf * np.array(idf, dtype=float)
        tfidf_q /= np.linalg.norm(tfidf_q)
        proj = comp @ tfidf_q
        proj /= np.linalg.norm(proj)
        cos = float(np.dot(proj, vec_ref))
        self.assertGreater(cos, 0.999)

        # Manifest hashes match generated files on disk
        for rel, meta in self.manifest["generatedFiles"].items():
            fp = ROOT / rel
            self.assertTrue(fp.exists(), rel)
            self.assertEqual(meta["sha256"], _sha256(fp), rel)
            self.assertEqual(meta["bytes"], fp.stat().st_size, rel)


class BassPrimaryWorkbookTests(unittest.TestCase):
    def test_all_bass_joins_and_conversions_match_workbook(self):
        from openpyxl import load_workbook
        corpus = json.loads(CORPUS_PATH.read_text())
        path = ROOT / "data/raw/PSI-26/PSI-26_Science Documents_As Run_Test Matrix.xlsx"
        workbook = load_workbook(path, read_only=True, data_only=True)
        rows = dict(enumerate(workbook["as run matrix"].iter_rows(values_only=True), 1))
        workbook.close()
        for test in (t for t in corpus["tests"] if t["inv"] == "BASS"):
            row = rows[test["extra"]["asRunRow"]]
            self.assertEqual(str(row[2]), test["extra"]["As Run Test #"])
            self.assertEqual(str(row[3]), test["extra"]["Test #"])
            for field, raw, factor in [("o2", row[26], 100), ("pressure", row[27], 101.325)]:
                value = test["atmosphere"][field]["value"]
                if value is not None:
                    self.assertIsInstance(raw, (float, int))
                    self.assertAlmostEqual(value, raw * factor, delta=0.051 if field == "pressure" else 0.006)


if __name__ == "__main__":
    unittest.main()
