"""Corpus loader: validates every record through the typed models and checks the manifest hashes."""
from __future__ import annotations

import hashlib
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

from .models import Claim, Investigation, SourceManifestEntry, Test

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
FILES = {"investigations.json": Investigation, "tests.json": Test, "claims.json": Claim, "sources.json": SourceManifestEntry}


class CorpusError(RuntimeError):
    pass


@dataclass
class Corpus:
    version: str
    content_hash: str
    investigations: dict[str, Investigation] = field(default_factory=dict)
    tests: dict[str, Test] = field(default_factory=dict)
    claims: dict[str, Claim] = field(default_factory=dict)
    sources: dict[str, SourceManifestEntry] = field(default_factory=dict)

    def tests_of(self, inv_id: str) -> list[Test]:
        return [self.tests[t] for t in self.investigations[inv_id].tests if t in self.tests]

    def claims_of(self, inv_id: str) -> list[Claim]:
        ids = {inv_id, *self.investigations[inv_id].tests, *(c.id for c in self.investigations[inv_id].text_chunks)}
        return [c for c in self.claims.values() if ids & set(c.evidence)]


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def rehash(data_dir: Path = DATA_DIR) -> dict:
    mpath = data_dir / "manifest.json"
    m = json.loads(mpath.read_text())
    for name in FILES:
        raw = (data_dir / name).read_bytes()
        m["files"][name] = {"sha256": _sha(raw), "records": len(json.loads(raw))}
    tmp = mpath.with_suffix(".tmp")
    tmp.write_text(json.dumps(m, indent=1) + "\n")
    tmp.replace(mpath)
    return m


def load_corpus(data_dir: Path = DATA_DIR, verify_hashes: bool = True) -> Corpus:
    try:
        manifest = json.loads((data_dir / "manifest.json").read_text())
    except (OSError, json.JSONDecodeError) as e:
        raise CorpusError(f"cannot read corpus manifest: {e}") from e
    combined = hashlib.sha256()
    parsed: dict[str, list] = {}
    for name, model in FILES.items():
        path = data_dir / name
        try:
            raw = path.read_bytes()
        except OSError as e:
            raise CorpusError(f"missing corpus file {name}: {e}") from e
        entry = manifest.get("files", {}).get(name)
        if verify_hashes and (not entry or entry.get("sha256") != _sha(raw)):
            raise CorpusError(f"hash mismatch for {name}: run `python -m ember.corpus --rehash` after intentional edits")
        combined.update(raw)
        try:
            parsed[name] = [model.model_validate(r) for r in json.loads(raw)]
        except Exception as e:  # pydantic ValidationError or JSON error
            raise CorpusError(f"invalid record in {name}: {e}") from e
    c = Corpus(version=manifest.get("corpus_version", "unversioned"), content_hash=combined.hexdigest()[:16])
    c.investigations = {i.id: i for i in parsed["investigations.json"]}
    c.tests = {t.id: t for t in parsed["tests.json"]}
    c.claims = {x.id: x for x in parsed["claims.json"]}
    c.sources = {s.id: s for s in parsed["sources.json"]}
    _check_integrity(c)
    return c


def _check_integrity(c: Corpus) -> None:
    for t in c.tests.values():
        if t.investigation_id not in c.investigations:
            raise CorpusError(f"test {t.id} references unknown investigation {t.investigation_id}")
        if t.id not in c.investigations[t.investigation_id].tests:
            raise CorpusError(f"investigation {t.investigation_id} does not list test {t.id}")
    chunk_ids = {ch.id for i in c.investigations.values() for ch in i.text_chunks}
    for i in c.investigations.values():
        for tid in i.tests:
            if tid not in c.tests:
                raise CorpusError(f"investigation {i.id} lists unknown test {tid}")
        for s in i.sources:
            if s.source_id not in c.sources:
                raise CorpusError(f"investigation {i.id} cites unknown source {s.source_id}")
    for cl in c.claims.values():
        for e in cl.evidence:
            if e not in c.tests and e not in chunk_ids:
                raise CorpusError(f"claim {cl.id} cites unknown evidence {e}")


if __name__ == "__main__":
    if "--rehash" in sys.argv:
        print(json.dumps(rehash(), indent=1))
    else:
        c = load_corpus()
        print(c.version, len(c.investigations), "investigations", len(c.tests), "tests")
