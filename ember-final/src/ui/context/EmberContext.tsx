import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { CorpusV2, Investigation, SourceRef } from '../../core';
import {
  createReview,
  getInvestigations,
  getLastBackendSource,
  getReviewSnapshot,
  listReviews,
  loadStaticCorpus,
  type ClientMeta,
  type CreateReviewParams,
  type ReviewSummary,
  type SavedReviewSnapshot,
} from '../apiClient';

export interface SourceModalTarget {
  sourceId: string;
  quote?: string | null;
  locatorSummary?: string | null;
  url?: string | null;
  doi?: string | null;
}

interface EmberContextValue {
  investigations: Investigation[];
  investigationsLoading: boolean;
  reviews: ReviewSummary[];
  activeSnapshot: SavedReviewSnapshot | null;
  activeLoading: boolean;
  activeError: string | null;
  backendSource: ClientMeta['backendSource'];
  warnings: string[];
  corpus: CorpusV2 | null;
  corpusLoading: boolean;
  ensureCorpus: () => Promise<CorpusV2>;
  loadReview: (reviewId: string) => Promise<void>;
  submitReview: (params: CreateReviewParams) => Promise<SavedReviewSnapshot>;
  updateActiveSnapshot: (snap: SavedReviewSnapshot) => void;
  refreshReviews: () => Promise<void>;
  sourceModal: SourceModalTarget | null;
  openSourceRef: (ref: Partial<SourceRef> & { sourceId: string }) => void;
  closeSourceModal: () => void;
  announcement: string;
  announce: (msg: string) => void;
}

const EmberContext = createContext<EmberContextValue | null>(null);

export function formatLocator(ref?: Partial<SourceRef>): string | null {
  const loc = ref?.locator;
  if (!loc) return null;
  const parts: string[] = [];
  if (loc.section) parts.push(loc.section);
  if (loc.page !== undefined && loc.page !== null) parts.push(`p.${loc.page}`);
  if (loc.table) parts.push(`Table ${loc.table}`);
  if (loc.row !== undefined && loc.row !== null) parts.push(`row ${loc.row}`);
  if (loc.cell) parts.push(`cell ${loc.cell}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function EmberProvider({ children }: { children: ReactNode }) {
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [investigationsLoading, setInvestigationsLoading] = useState(true);
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [activeSnapshot, setActiveSnapshot] = useState<SavedReviewSnapshot | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [backendSource, setBackendSource] = useState<ClientMeta['backendSource']>('node_api');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [corpus, setCorpus] = useState<CorpusV2 | null>(null);
  const [corpusLoading, setCorpusLoading] = useState(false);
  const [sourceModal, setSourceModal] = useState<SourceModalTarget | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const announce = useCallback((msg: string) => {
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(msg));
  }, []);

  const refreshReviews = useCallback(async () => {
    const res = await listReviews();
    setReviews(res.reviews);
    setBackendSource(getLastBackendSource());
  }, []);

  const loadReview = useCallback(async (reviewId: string) => {
    setActiveLoading(true);
    setActiveError(null);
    try {
      const res = await getReviewSnapshot(reviewId);
      setActiveSnapshot(res.snapshot);
      setWarnings(res.meta.warnings);
      setBackendSource(res.meta.backendSource);
    } catch (err) {
      setActiveError(err instanceof Error ? err.message : 'Failed to load review.');
    } finally {
      setActiveLoading(false);
    }
  }, []);

  const submitReview = useCallback(
    async (params: CreateReviewParams) => {
      setActiveLoading(true);
      setActiveError(null);
      try {
        const res = await createReview(params);
        setActiveSnapshot(res.snapshot);
        setWarnings(res.meta.warnings);
        setBackendSource(res.meta.backendSource);
        await refreshReviews();
        announce(`Completed review ${res.snapshot.title} in ${res.snapshot.review.synthesis.mode} mode.`);
        return res.snapshot;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to run review.';
        setActiveError(msg);
        throw err;
      } finally {
        setActiveLoading(false);
      }
    },
    [announce, refreshReviews],
  );

  const ensureCorpus = useCallback(async (): Promise<CorpusV2> => {
    if (corpus) return corpus;
    setCorpusLoading(true);
    try {
      const loaded = await loadStaticCorpus();
      setCorpus(loaded);
      return loaded;
    } finally {
      setCorpusLoading(false);
    }
  }, [corpus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [invRes, revRes] = await Promise.all([getInvestigations(), listReviews()]);
        if (cancelled) return;
        setInvestigations(invRes.investigations);
        setReviews(revRes.reviews);
        setBackendSource(getLastBackendSource());
      } catch {
        // Handled per-page if static assets fail
      } finally {
        if (!cancelled) setInvestigationsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openSourceRef = useCallback((ref: Partial<SourceRef> & { sourceId: string }) => {
    setSourceModal({
      sourceId: ref.sourceId,
      quote: ref.quote ?? ref.context ?? null,
      locatorSummary: formatLocator(ref),
      url: ref.url ?? null,
      doi: ref.doi ?? null,
    });
  }, []);

  const closeSourceModal = useCallback(() => {
    setSourceModal(null);
  }, []);

  const updateActiveSnapshot = useCallback(
    (snap: SavedReviewSnapshot) => {
      setActiveSnapshot(snap);
      void refreshReviews();
    },
    [refreshReviews],
  );

  const value = useMemo<EmberContextValue>(
    () => ({
      investigations,
      investigationsLoading,
      reviews,
      activeSnapshot,
      activeLoading,
      activeError,
      backendSource,
      warnings,
      corpus,
      corpusLoading,
      ensureCorpus,
      loadReview,
      submitReview,
      updateActiveSnapshot,
      refreshReviews,
      sourceModal,
      openSourceRef,
      closeSourceModal,
      announcement,
      announce,
    }),
    [
      investigations,
      investigationsLoading,
      reviews,
      activeSnapshot,
      activeLoading,
      activeError,
      backendSource,
      warnings,
      corpus,
      corpusLoading,
      ensureCorpus,
      loadReview,
      submitReview,
      updateActiveSnapshot,
      refreshReviews,
      sourceModal,
      openSourceRef,
      closeSourceModal,
      announcement,
      announce,
    ],
  );

  return <EmberContext.Provider value={value}>{children}</EmberContext.Provider>;
}

export function useEmber(): EmberContextValue {
  const ctx = useContext(EmberContext);
  if (!ctx) throw new Error('useEmber must be used inside EmberProvider');
  return ctx;
}
