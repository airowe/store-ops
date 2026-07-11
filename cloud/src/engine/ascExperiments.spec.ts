import { describe, expect, it } from "vitest";
import { mapExperiment, readAscExperiments } from "./ascExperiments.js";
import type { FetchLike } from "./ascWrite.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch stub for the single experiments endpoint, with an optional status. */
function makeFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const fetchFn: FetchLike = async (url: string) => {
    calls.push(url);
    if (status >= 400) return json({ errors: [{ detail: "nope" }] }, status);
    return json(body, status);
  };
  return { fetchFn, calls };
}

describe("mapExperiment", () => {
  it("maps present attributes and drops absent ones", () => {
    expect(
      mapExperiment({
        id: "e1",
        attributes: { name: "Outcome", state: "ACCEPTED", started: true, startDate: "2026-06-01", trafficProportion: 50 },
      }),
    ).toEqual({ id: "e1", name: "Outcome", state: "ACCEPTED", started: true, startDate: "2026-06-01", trafficProportion: 50 });
  });

  it("keeps only the id when attributes are missing/oddly typed", () => {
    expect(mapExperiment({ id: "e2", attributes: { name: 42, started: "yes" } })).toEqual({ id: "e2" });
    expect(mapExperiment({})).toEqual({ id: "" });
  });
});

describe("readAscExperiments", () => {
  it("reads the app's v2 experiments endpoint and maps the rows", async () => {
    const { fetchFn, calls } = makeFetch({
      data: [
        { id: "e1", attributes: { name: "A", state: "COMPLETED", started: true } },
        { id: "e2", attributes: { name: "B", state: "ACCEPTED", started: true, startDate: "2026-07-01" } },
      ],
    });
    const out = await readAscExperiments(fetchFn, { token: "secret-jwt", appId: "123" });
    expect(out.read).toBe(true);
    expect(out.experiments).toHaveLength(2);
    expect(out.experiments[1]).toMatchObject({ id: "e2", state: "ACCEPTED", startDate: "2026-07-01" });
    // hits the v2 experiments relationship off the app
    expect(calls[0]).toContain("/apps/123/appStoreVersionExperimentsV2");
    // the token never appears in the URL (it rides the Authorization header)
    expect(calls[0]).not.toContain("secret-jwt");
  });

  it("read:true with zero rows when the app has no experiments (honest 'never tested')", async () => {
    const { fetchFn } = makeFetch({ data: [] });
    const out = await readAscExperiments(fetchFn, { token: "t", appId: "123" });
    expect(out).toMatchObject({ read: true, experiments: [] });
  });

  it("degrades to read:false with a token-free note on 403 (never throws)", async () => {
    const { fetchFn } = makeFetch(null, 403);
    const out = await readAscExperiments(fetchFn, { token: "secret-jwt", appId: "123" });
    expect(out.read).toBe(false);
    expect(out.experiments).toEqual([]);
    expect(out.note).toBeTruthy();
    expect(out.note).not.toContain("secret-jwt");
  });

  it("degrades to read:false on 404 (app/endpoint has no experiments resource)", async () => {
    const { fetchFn } = makeFetch(null, 404);
    const out = await readAscExperiments(fetchFn, { token: "t", appId: "123" });
    expect(out).toMatchObject({ read: false, experiments: [] });
  });
});
