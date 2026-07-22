-- 0007_webhook_deliveries — dedup + debounce state for the ASC webhook receiver.
--
-- WHY: Apple delivers webhooks AT-LEAST-ONCE, so the same delivery id can arrive
-- twice; the PRIMARY KEY makes a repeat insert a no-op (the idempotency
-- guarantee). webhook_sweeps tracks the last time an app was swept FROM a
-- webhook, so a burst of events collapses to one keyed sweep (debounce).
-- Guarded so a re-run is a no-op.

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id  TEXT PRIMARY KEY,
  asc_app_id   TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  received_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhook_sweeps (
  asc_app_id     TEXT PRIMARY KEY,
  last_swept_at  TEXT NOT NULL
);
