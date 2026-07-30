/**
 * Test helper: a fetch that reports every app as IN the store.
 *
 * `runWeeklySweep` asks the App Store whether an app is published before
 * sweeping it (see engine/appIsLive.ts), so specs that exercise OTHER gates
 * — pause, tier, schedule, thresholds — need their fixture apps to look live
 * or they get skipped before reaching the behaviour under test.
 *
 * Those specs previously mocked `fetchForEnv` as the REAL `fetch`, which meant
 * they were quietly making live network calls to iTunes with fake bundle ids.
 * That worked only because nothing read the response. This stub removes the
 * network from those tests entirely, which is what they always meant.
 *
 * Deliberately not a blanket "return {}": it answers the lookup shape, so a
 * spec that ever asserts on liveness gets a truthful answer rather than a
 * silently empty one. Specs that need an app to read as NOT live should build
 * their own fetch (see sweepLiveOnly.spec.ts) rather than widening this.
 */
export function liveLookupFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const bundleId = (() => {
      try {
        return new URL(url).searchParams.get("bundleId") ?? "test.bundle";
      } catch {
        return "test.bundle";
      }
    })();
    return new Response(
      JSON.stringify({ resultCount: 1, results: [{ trackId: 1, trackName: "Test App", bundleId }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}
