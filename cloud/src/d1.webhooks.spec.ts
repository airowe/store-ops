import { beforeEach, describe, expect, it } from "vitest";
import { enqueueWebhookDelivery, markWebhookSwept, shouldDebounce } from "./d1.js";

function fakeDb() {
  const deliveries: { delivery_id: string; asc_app_id: string; event_type: string; received_at: string }[] = [];
  const sweeps: { asc_app_id: string; last_swept_at: string }[] = [];

  const api = {
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, " ").trim().toUpperCase();
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async run() {
          if (s.includes("WEBHOOK_DELIVERIES")) {
            const [deliveryId, ascAppId, eventType, at] = bound as [string, string, string, string];
            if (!deliveries.find((r) => r.delivery_id === deliveryId)) {
              deliveries.push({ delivery_id: deliveryId, asc_app_id: ascAppId, event_type: eventType, received_at: at });
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (s.includes("WEBHOOK_SWEEPS")) {
            const [ascAppId, lastSweptAt] = bound as [string, string];
            const existing = sweeps.find((r) => r.asc_app_id === ascAppId);
            if (existing) {
              existing.last_swept_at = lastSweptAt;
            } else {
              sweeps.push({ asc_app_id: ascAppId, last_swept_at: lastSweptAt });
            }
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async first<T>() {
          if (s.includes("WEBHOOK_SWEEPS")) {
            const ascAppId = bound[0] as string;
            const row = sweeps.find((r) => r.asc_app_id === ascAppId);
            return (row ? { last_swept_at: row.last_swept_at } : null) as T | null;
          }
          return null;
        },
      };
      return stmt;
    },
  };
  return api as unknown as import("@cloudflare/workers-types").D1Database;
}

describe("webhook dedup + debounce", () => {
  let db: import("@cloudflare/workers-types").D1Database;

  beforeEach(() => {
    db = fakeDb();
  });

  it("enqueueWebhookDelivery returns fresh:true then fresh:false for a repeat id", async () => {
    const args = { deliveryId: "D1", ascAppId: "6446", eventType: "X", at: "2026-07-22T10:00:00Z" };
    expect((await enqueueWebhookDelivery(db, args)).fresh).toBe(true);
    expect((await enqueueWebhookDelivery(db, args)).fresh).toBe(false);
  });

  it("shouldDebounce is true inside the window and false outside", async () => {
    const now = Date.parse("2026-07-22T10:00:00Z") / 1000;
    await markWebhookSwept(db, "6446", "2026-07-22T09:59:00Z"); // 60s ago
    expect(await shouldDebounce(db, "6446", 300, now)).toBe(true); // 5-min window
    expect(await shouldDebounce(db, "6446", 30, now)).toBe(false); // 30s window
  });

  it("shouldDebounce is false for an app never swept", async () => {
    const now = Date.parse("2026-07-22T10:00:00Z") / 1000;
    expect(await shouldDebounce(db, "never", 300, now)).toBe(false);
  });
});
