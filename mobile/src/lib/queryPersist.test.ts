import { clearSnapshot, loadSnapshot, saveSnapshot, stalenessLabel, type StorageLike } from "./queryPersist.js";

function memStorage(): StorageLike & { mem: Map<string, string> } {
  const mem = new Map<string, string>();
  return {
    mem,
    getItem: async (k) => mem.get(k) ?? null,
    setItem: async (k, v) => void mem.set(k, v),
    removeItem: async (k) => void mem.delete(k),
  };
}

describe("offline snapshot cache", () => {
  it("save → load round-trips data with its savedAt", async () => {
    const s = memStorage();
    await saveSnapshot(s, "apps", { apps: [{ id: "a1" }] }, 1000);
    const snap = await loadSnapshot<{ apps: Array<{ id: string }> }>(s, "apps");
    expect(snap?.savedAt).toBe(1000);
    expect(snap?.data.apps[0]!.id).toBe("a1");
  });

  it("missing / corrupt entries load as null (no crash)", async () => {
    const s = memStorage();
    expect(await loadSnapshot(s, "nope")).toBeNull();
    s.mem.set("shipaso.cache.bad", "{not json");
    expect(await loadSnapshot(s, "bad")).toBeNull();
  });

  it("clear removes the snapshot", async () => {
    const s = memStorage();
    await saveSnapshot(s, "apps", {}, 1);
    await clearSnapshot(s, "apps");
    expect(await loadSnapshot(s, "apps")).toBeNull();
  });
});

describe("stalenessLabel (never 'live')", () => {
  const now = 10 * 60 * 1000;
  it("labels cached age, and flags offline — never presents cache as fresh", () => {
    expect(stalenessLabel(now - 30_000, now, true)).toBe("cached · just now");
    expect(stalenessLabel(now - 5 * 60_000, now, true)).toBe("cached · 5m ago");
    expect(stalenessLabel(now - 5 * 60_000, now, false)).toBe("offline · cached 5m ago");
    // crucially, it never returns the string "live"
    expect(stalenessLabel(now, now, true)).not.toContain("live");
  });
});
