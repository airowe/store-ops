import { downloadAndShareFastlane, type FastlaneDeps } from "./fastlane.js";

function deps(over: Partial<FastlaneDeps> = {}): FastlaneDeps & { shared: string[]; headers: unknown[] } {
  const shared: string[] = [];
  const headers: unknown[] = [];
  const base: FastlaneDeps = {
    base: "https://api.shipaso.com",
    cacheDir: "file:///cache/",
    getToken: async () => "sess-1",
    downloadAsync: (async (_url: string, target: string, opts?: { headers?: unknown }) => {
      headers.push(opts?.headers);
      return { status: 200, uri: target, headers: {} };
    }) as unknown as FastlaneDeps["downloadAsync"],
    isAvailableAsync: (async () => true) as FastlaneDeps["isAvailableAsync"],
    shareAsync: (async (uri: string) => void shared.push(uri)) as unknown as FastlaneDeps["shareAsync"],
    ...over,
  };
  return Object.assign(base, { shared, headers });
}

describe("downloadAndShareFastlane", () => {
  it("downloads with the Bearer header, then shares the file", async () => {
    const d = deps();
    const res = await downloadAndShareFastlane("run1", d);
    expect(res).toEqual({ ok: true, uri: "file:///cache/fastlane-run1.zip" });
    expect(d.headers[0]).toEqual({ Authorization: "Bearer sess-1" });
    expect(d.shared).toEqual(["file:///cache/fastlane-run1.zip"]);
  });

  it("refuses without a token (never an unauthenticated download)", async () => {
    const d = deps({ getToken: async () => null });
    const res = await downloadAndShareFastlane("run1", d);
    expect(res).toEqual({ ok: false, reason: expect.stringContaining("Sign in") });
  });

  it("surfaces a non-200 honestly", async () => {
    const d = deps({
      downloadAsync: (async (_u: string, t: string) => ({ status: 403, uri: t, headers: {} })) as unknown as FastlaneDeps["downloadAsync"],
    });
    const res = await downloadAndShareFastlane("run1", d);
    expect(res).toEqual({ ok: false, reason: expect.stringContaining("403") });
  });

  it("still succeeds when sharing is unavailable (file saved, no share sheet)", async () => {
    const d = deps({ isAvailableAsync: (async () => false) as FastlaneDeps["isAvailableAsync"] });
    const res = await downloadAndShareFastlane("run1", d);
    expect(res.ok).toBe(true);
    expect(d.shared).toEqual([]);
  });
});
