/**
 * Autopilot execution (#374 follow-on) — the pure half.
 *
 * With `users.autopilot_execute` on, the agent performs an approved run's
 * writes itself instead of leaving them for a person to click through. This
 * module decides WHETHER (the gate) and WHAT (the plan); the I/O half in
 * cron/autopilot.ts does each step through the same engine functions the
 * write routes use, so nothing here can reach Apple by a path a person could
 * not.
 *
 * Rules, each a test:
 *   - the gate is the manual write gate PLUS the autopilot flag PLUS a stored
 *     key; autopilot never widens what a person could do by hand,
 *   - approval is the human's act; autopilot runs only on 'approved' runs,
 *   - every step lands as done / skipped-with-reason / failed-with-reason —
 *     screenshots and experiments are planned as SKIPPED today because no
 *     rendered asset exists server-side, and a skipped step is reported, not
 *     hidden,
 *   - 'shipped' means the metadata push returned success, nothing looser,
 *   - a new version string is the next patch of the highest existing one,
 *     never a guess when none can be parsed.
 */
import type { Tier } from "../d1.js";
import { canAscWrite } from "../billing.js";
import type { CopyFields } from "./optimize.js";

export type AutopilotGateInput = {
  flagOn: boolean;
  tier: Tier;
  optedIn: boolean;
  autopilot: boolean;
  runStatus: string;
  hasStoredKey: boolean;
};

export type AutopilotGate = { allowed: true } | { allowed: false; reason: string };

export function autopilotGate(i: AutopilotGateInput): AutopilotGate {
  if (!i.autopilot) return { allowed: false, reason: "autopilot execution is off for this account" };
  if (!i.flagOn) return { allowed: false, reason: "direct App Store Connect writes are not enabled on this deployment" };
  if (!canAscWrite(i.tier)) return { allowed: false, reason: `the ${i.tier} tier cannot write to App Store Connect` };
  if (!i.optedIn) return { allowed: false, reason: "the account has not opted in to App Store Connect writes" };
  if (i.runStatus !== "approved") return { allowed: false, reason: `run is ${i.runStatus}, not approved` };
  if (!i.hasStoredKey) return { allowed: false, reason: "no stored App Store Connect key for this app or account" };
  return { allowed: true };
}

export type PlanStep =
  | { step: "version" }
  | { step: "metadata"; locale: string; copy: CopyFields }
  | { step: `locale:${string}`; locale: string; copy: CopyFields }
  | { step: "screenshots"; skip: string }
  | { step: "experiment"; skip: string };

export type TraceForPlan = {
  proposedCopy?: CopyFields | undefined;
  localizedCopy?: Record<string, CopyFields> | undefined;
  ppoTreatment?: unknown;
};

/**
 * The ordered steps for one approved run. Metadata goes to the storefront
 * locale; each approved locale in `localizedCopy` follows. Screenshots and
 * the experiment are planned only so their absence is stated.
 */
export function planAutopilot(trace: TraceForPlan, storefrontLocale: string): PlanStep[] {
  const steps: PlanStep[] = [{ step: "version" }];
  if (trace.proposedCopy) steps.push({ step: "metadata", locale: storefrontLocale, copy: trace.proposedCopy });
  for (const [locale, copy] of Object.entries(trace.localizedCopy ?? {})) {
    if (locale === storefrontLocale) continue;
    steps.push({ step: `locale:${locale}`, locale, copy });
  }
  steps.push({ step: "screenshots", skip: "no rendered screenshot exists server-side; render locally and use asc-screenshot-write-lane" });
  steps.push({
    step: "experiment",
    skip: trace.ppoTreatment
      ? "a treatment needs rendered screenshots, which exist only on the developer's machine"
      : "the run proposed no product page experiment",
  });
  return steps;
}

/** Next patch after the highest parseable version, e.g. ["1.0.0","1.0.1"] → "1.0.2". */
export function nextVersionString(existing: string[]): string | null {
  let best: number[] | null = null;
  for (const v of existing) {
    const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(v.trim());
    if (!m) continue;
    const parts = [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
    if (!best || parts[0]! > best[0]! || (parts[0] === best[0] && (parts[1]! > best[1]! || (parts[1] === best[1] && parts[2]! > best[2]!)))) best = parts;
  }
  if (!best) return null;
  return `${best[0]}.${best[1]}.${best[2]! + 1}`;
}

export type ExecutionRecord = { step: string; status: "done" | "skipped" | "failed"; detail: string };

/** 'shipped' means exactly one thing: the metadata write returned success. */
export function shippedFrom(records: ExecutionRecord[]): boolean {
  return records.some((r) => r.step === "metadata" && r.status === "done");
}
