import { describe, it, expect, vi } from "vitest";
import { shareWin, shareCardPath, type ShareWinDeps } from "./shareWin.js";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"></svg>';

function deps(over: Partial<ShareWinDeps> = {}): ShareWinDeps {
  return {
    fetchImpl: vi.fn(async () => new Response(SVG, { status: 200 })) as unknown as typeof fetch,
    rasterize: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
    save: vi.fn(),
    base: "https://api.test",
    ...over,
  };
}

describe("shareCardPath", () => {
  it("encodes the app id and carries the size", () => {
    expect(shareCardPath("a b/c", "square")).toBe("/apps/a%20b%2Fc/share-card.svg?size=square");
  });
});

describe("shareWin", () => {
  it("a real win rasterizes and saves a PNG", async () => {
    const d = deps();
    const res = await shareWin("app-1", "wide", d);
    expect(res).toEqual({ ok: true, filename: "shipaso-win-app-1.png" });
    expect(d.rasterize).toHaveBeenCalledWith(SVG);
    expect(d.save).toHaveBeenCalledTimes(1);
    const [blob, name] = (d.save as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(name).toBe("shipaso-win-app-1.png");
  });

  it("sends the session cookie — the route is owner-scoped", async () => {
    const d = deps();
    await shareWin("app-1", "wide", d);
    const [url, init] = (d.fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.test/apps/app-1/share-card.svg?size=wide");
    expect(init).toMatchObject({ credentials: "include" });
  });

  // The honesty bar: a hold or a slip is not a win, and 404 is how the route
  // says so. It must NOT read as a failure, and must NOT produce a file.
  it("404 means there is no win yet — plain copy, no file saved", async () => {
    const d = deps({
      fetchImpl: vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch,
    });
    const res = await shareWin("app-1", "wide", d);
    expect(res).toEqual({ ok: false, reason: "No real win to share yet.", noWin: true });
    expect(d.save).not.toHaveBeenCalled();
    expect(d.rasterize).not.toHaveBeenCalled();
  });

  it("401 asks the user to sign in, distinctly from having no win", async () => {
    const d = deps({
      fetchImpl: vi.fn(async () => new Response("", { status: 401 })) as unknown as typeof fetch,
    });
    const res = await shareWin("app-1", "wide", d);
    expect(res).toEqual({ ok: false, reason: "Sign in to share a win.", noWin: false });
    expect(d.save).not.toHaveBeenCalled();
  });

  it("any other failure names the status rather than claiming there is no win", async () => {
    const d = deps({
      fetchImpl: vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch,
    });
    const res = await shareWin("app-1", "wide", d);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toContain("500");
    // A server fault says NOTHING about the rankings — it must not be reported
    // as "you have no win", which would be an unmeasured claim.
    expect(res.ok === false && res.noWin).toBe(false);
  });

  // A canvas failure is not evidence about the win. Conflating the two would
  // tell the user they have no win when in fact they have one we couldn't draw.
  it("a rasterization failure reports a render problem, not an absent win", async () => {
    const d = deps({
      rasterize: vi.fn(async () => {
        throw new Error("canvas unavailable");
      }),
    });
    const res = await shareWin("app-1", "wide", d);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.noWin).toBe(false);
    expect(d.save).not.toHaveBeenCalled();
  });

  it("an empty body is not a card — it never reaches the rasterizer", async () => {
    const d = deps({
      fetchImpl: vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch,
    });
    const res = await shareWin("app-1", "wide", d);
    expect(res.ok).toBe(false);
    expect(d.rasterize).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
  });
});
