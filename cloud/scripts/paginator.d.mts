// Type declarations for the plain-ESM paginator (scripts/paginator.mjs).
// Implementation is .mjs so the Node-20 CI runner imports it without a TS loader.

export type Page = { candidates: unknown[]; hasMore: boolean; offset: number };

export type PaginatorOpts = {
  term: string;
  pageSize: number;
  initialOffset: number;
  initialHasMore: boolean;
  fetchPage: (offset: number) => Promise<Page>;
  onPage: (candidates: unknown[], page: Page) => void;
};

export type Paginator = {
  loadMore: () => void;
  hasMore: () => boolean;
  isLoading: () => boolean;
  offset: () => number;
};

export function createPaginator(o: PaginatorOpts): Paginator;
