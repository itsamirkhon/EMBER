/**
 * Protocol links and defaults must preserve investigation context.
 * A missing requested test is NOT a reason to silently display another
 * experiment's protocol (previously BASS-II was used as a fallback).
 */
export interface ProtocolRef {
  testId: string;
  inv: string;
  fuel?: string | null;
  seriesId?: string | null;
}

export function protocolHref(investigationId: string, testId: string): string {
  return `/compare?inv=${encodeURIComponent(investigationId)}&testId=${encodeURIComponent(testId)}`;
}

export function scopedProtocolTests<T extends ProtocolRef>(
  tests: readonly T[],
  investigationId: string | null,
): T[] {
  return investigationId ? tests.filter((test) => test.inv === investigationId) : [...tests];
}

export function resolveProtocolTest<T extends ProtocolRef>(
  tests: readonly T[],
  selectedId: string | null,
  investigationId: string | null,
  defaultIds: readonly string[] = [],
): T | null {
  const scoped = scopedProtocolTests(tests, investigationId);
  if (selectedId) {
    // Explicit deep-links must either resolve to the exact record or fail visibly.
    return scoped.find((test) => test.testId === selectedId) ?? null;
  }
  for (const id of defaultIds) {
    const match = scoped.find((test) => test.testId === id);
    if (match) return match;
  }
  return scoped[0] ?? null;
}

/** Only seed comparisons with tests from the selected investigation. */
export function comparisonSeed<T extends ProtocolRef>(
  tests: readonly T[],
  selectedId: string | null,
  investigationId: string | null,
  defaultIds: readonly string[] = [],
): string[] {
  const chosen = resolveProtocolTest(tests, selectedId, investigationId, defaultIds);
  if (!chosen) return [];
  const peers = scopedProtocolTests(tests, chosen.inv)
    .filter((test) => test.testId !== chosen.testId)
    .sort((a, b) => {
      const score = (test: T) =>
        (chosen.seriesId && test.seriesId === chosen.seriesId ? 2 : 0) +
        (chosen.fuel && test.fuel === chosen.fuel ? 1 : 0);
      return score(b) - score(a);
    });
  return [chosen.testId, ...peers.slice(0, 2).map((test) => test.testId)];
}
