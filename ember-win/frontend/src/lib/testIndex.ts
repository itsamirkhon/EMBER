import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { InvestigationFull, Review, TestRecord } from '../api/types';

const cache = new Map<string, Promise<InvestigationFull>>();
const load = (id: string) => {
  let p = cache.get(id);
  if (!p) { p = api.investigation(id); p.catch(() => cache.delete(id)); cache.set(id, p); }
  return p;
};

export interface TestIndex {
  loading: boolean;
  invs: Map<string, InvestigationFull>;
  tests: Map<string, { inv: InvestigationFull; test: TestRecord }>;
}
const empty = (loading: boolean): TestIndex => ({ loading, invs: new Map(), tests: new Map() });

/** Loads the investigations a review ranked so claims/tests can be linked and compared by condition. */
export function useTestIndex(review: Review): TestIndex {
  const [idx, setIdx] = useState<TestIndex>(empty(true));
  const key = review.ranking.map((r) => r.investigation_id).join('|');
  useEffect(() => {
    let live = true;
    setIdx(empty(true));
    Promise.allSettled(review.ranking.map((r) => load(r.investigation_id))).then((rs) => {
      if (!live) return;
      const out = empty(false);
      for (const r of rs) if (r.status === 'fulfilled') {
        out.invs.set(r.value.id, r.value);
        for (const t of r.value.test_records) out.tests.set(t.id, { inv: r.value, test: t });
      }
      setIdx(out);
    });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return idx;
}
