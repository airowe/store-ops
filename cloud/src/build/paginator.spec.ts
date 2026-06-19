import { describe, it, expect } from "vitest";
import { createPaginator } from "../../scripts/paginator.mjs";

/**
 * The candidate picker pages through search results. A user whose app is a
 * lower-ranked hit under a generic term (e.g. "Mangia - Recipe Manager" under
 * "Mangia") must be able to reach later pages. This paginator drives BOTH the
 * "Show more" button and scroll-to-load: it owns offset/hasMore/in-flight state
 * and guarantees we never double-fetch the same page or page past the end. Pure
 * + injectable (fake fetcher), so the paging rules unit-test without a DOM.
 */

function paginatorWith(opts: { pageSize?: number } = {}) {
  const calls: number[] = [];
  let pending: Array<{ offset: number; resolve: (v: unknown) => void }> = [];
  const fetchPage = (offset: number) => {
    calls.push(offset);
    return new Promise<{ candidates: unknown[]; hasMore: boolean; offset: number }>(
      (resolve) => {
        pending.push({ offset, resolve: resolve as (v: unknown) => void });
      },
    );
  };
  const appended: unknown[][] = [];
  const pager = createPaginator({
    term: "Mangia",
    pageSize: opts.pageSize ?? 12,
    initialOffset: 0,
    initialHasMore: true,
    fetchPage,
    onPage: (cands: unknown[]) => appended.push(cands),
  });
  return {
    pager,
    calls,
    appended,
    resolve(offset: number, count: number, hasMore: boolean) {
      const idx = pending.findIndex((p) => p.offset === offset);
      if (idx === -1) throw new Error(`no pending fetch for offset ${offset}`);
      const [p] = pending.splice(idx, 1);
      const candidates = Array.from({ length: count }, (_, i) => `app-${offset + i}`);
      p!.resolve({ candidates, hasMore, offset });
    },
  };
}

describe("createPaginator", () => {
  it("requests the next page at the running offset", () => {
    const { pager, calls } = paginatorWith({ pageSize: 12 });
    pager.loadMore();
    expect(calls).toEqual([12]); // first page was offset 0; next is 12
  });

  it("advances the offset by the returned page size across pages", async () => {
    const { pager, calls, resolve } = paginatorWith({ pageSize: 12 });
    pager.loadMore();
    resolve(12, 12, true);
    await Promise.resolve();
    pager.loadMore();
    expect(calls).toEqual([12, 24]);
  });

  it("does NOT double-fetch while a page is in flight", () => {
    const { pager, calls } = paginatorWith();
    pager.loadMore();
    pager.loadMore(); // scroll + button can both fire — only one request
    pager.loadMore();
    expect(calls).toEqual([12]);
  });

  it("stops paging once hasMore becomes false", async () => {
    const { pager, calls, resolve } = paginatorWith();
    pager.loadMore();
    resolve(12, 5, false); // last page
    await Promise.resolve();
    pager.loadMore(); // no-op — nothing left
    expect(calls).toEqual([12]);
    expect(pager.hasMore()).toBe(false);
  });

  it("delivers each fetched page's candidates via onPage", async () => {
    const { pager, appended, resolve } = paginatorWith();
    pager.loadMore();
    resolve(12, 3, true);
    await Promise.resolve();
    expect(appended).toEqual([["app-12", "app-13", "app-14"]]);
  });

  it("re-enables fetching after a page resolves (button + scroll keep working)", async () => {
    const { pager, calls, resolve } = paginatorWith();
    pager.loadMore();
    resolve(12, 12, true);
    await Promise.resolve();
    pager.loadMore();
    resolve(24, 12, true);
    await Promise.resolve();
    pager.loadMore();
    expect(calls).toEqual([12, 24, 36]);
  });

  it("a failed page re-enables fetching (so the user can retry)", async () => {
    const calls: number[] = [];
    let rejectNext: ((e: unknown) => void) | null = null;
    const pager = createPaginator({
      term: "Mangia",
      pageSize: 12,
      initialOffset: 0,
      initialHasMore: true,
      fetchPage: (offset: number) => {
        calls.push(offset);
        return new Promise((_resolve, reject) => {
          rejectNext = reject;
        });
      },
      onPage: () => {},
    });
    pager.loadMore();
    rejectNext!(new Error("network"));
    await Promise.resolve();
    await Promise.resolve();
    pager.loadMore(); // retry the same offset
    expect(calls).toEqual([12, 12]);
  });

  it("loadMore is a no-op when initialHasMore is false", () => {
    const calls: number[] = [];
    const pager = createPaginator({
      term: "x",
      pageSize: 12,
      initialOffset: 0,
      initialHasMore: false,
      fetchPage: (o: number) => {
        calls.push(o);
        return Promise.resolve({ candidates: [], hasMore: false, offset: o });
      },
      onPage: () => {},
    });
    pager.loadMore();
    expect(calls).toEqual([]);
  });
});
