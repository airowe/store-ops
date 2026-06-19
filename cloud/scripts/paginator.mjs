/**
 * Pagination controller for the app-search candidate picker — PURE logic.
 *
 * Plain ESM so the Node-20 CI runner imports it without a TS loader (same reason
 * as stampAssets.mjs). The build/unit spec and the inline app.js copy share this
 * behavior; this file is the tested source of truth.
 *
 * Why it exists: the picker pages through search results. A user whose app is a
 * lower-ranked hit under a generic term ("Mangia - Recipe Manager" under
 * "Mangia") must be able to reach later pages. This owns offset / hasMore /
 * in-flight so BOTH the "Show more" button and scroll-to-load can call
 * loadMore() freely without double-fetching or paging past the end.
 *
 * @typedef {{ candidates: unknown[], hasMore: boolean, offset: number }} Page
 * @typedef {{
 *   term: string,
 *   pageSize: number,
 *   initialOffset: number,
 *   initialHasMore: boolean,
 *   fetchPage: (offset: number) => Promise<Page>,
 *   onPage: (candidates: unknown[], page: Page) => void,
 * }} PaginatorOpts
 */

/**
 * @param {PaginatorOpts} o
 */
export function createPaginator(o) {
  let offset = o.initialOffset;          // offset of the LAST loaded page
  let pageSize = o.pageSize;
  let more = o.initialHasMore;
  let inFlight = false;

  function loadMore() {
    if (!more || inFlight) return;       // nothing left, or a page is loading
    inFlight = true;
    const next = offset + pageSize;
    Promise.resolve(o.fetchPage(next)).then(
      (page) => {
        inFlight = false;
        const cands = (page && page.candidates) || [];
        // Advance by what we actually requested so a short final page still
        // moves the cursor correctly; trust the response's hasMore.
        offset = next;
        more = !!(page && page.hasMore);
        o.onPage(cands, page);
      },
      () => {
        // A failed page leaves offset/more untouched so the next loadMore()
        // retries the SAME page (the user can scroll/click again).
        inFlight = false;
      },
    );
  }

  return {
    loadMore,
    hasMore: () => more,
    isLoading: () => inFlight,
    offset: () => offset,
  };
}
