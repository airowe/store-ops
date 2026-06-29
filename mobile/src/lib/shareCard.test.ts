import { shareWin, type ShareCardDeps } from "./shareCard.js";

function deps(over: Partial<ShareCardDeps> = {}): ShareCardDeps & { shared: string[] } {
  const shared: string[] = [];
  const base: ShareCardDeps = {
    base: "https://api.shipaso.com",
    cacheDir: "file:///cache/",
    getToken: async () => "sess-1",
    downloadAsync: (async (_u: string, t: string) => ({ status: 200, uri: t, headers: {} })) as unknown as ShareCardDeps["downloadAsync"],
    isAvailableAsync: (async () => true) as ShareCardDeps["isAvailableAsync"],
    shareAsync: (async (uri: string) => void shared.push(uri)) as unknown as ShareCardDeps["shareAsync"],
    ...over,
  };
  return Object.assign(base, { shared });
}

describe("shareWin", () => {
  it("downloads the SVG and shares it on a real win (200)", async () => {
    const d = deps();
    const res = await shareWin("app1", "wide", d);
    expect(res).toEqual({ ok: true, uri: "file:///cache/share-app1.svg" });
    expect(d.shared).toEqual(["file:///cache/share-app1.svg"]);
  });

  it("a 404 is an HONEST 'no win yet' — never a fabricated card", async () => {
    const d = deps({
      downloadAsync: (async (_u: string, t: string) => ({ status: 404, uri: t, headers: {} })) as unknown as ShareCardDeps["downloadAsync"],
    });
    const res = await shareWin("app1", "wide", d);
    expect(res).toEqual({ ok: false, reason: expect.stringContaining("No real win") });
    expect(d.shared).toEqual([]);
  });

  it("refuses without a token", async () => {
    const res = await shareWin("app1", "wide", deps({ getToken: async () => null }));
    expect(res.ok).toBe(false);
  });
});
