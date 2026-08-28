/**
 * What each declared tool actually does.
 *
 * The layer between the manifest (what we promise) and the API (what exists).
 * Handlers return PROSE, not JSON, because the consumer is a language model
 * relaying an answer to a person — a shaped sentence survives that trip; a blob
 * of JSON gets paraphrased, and paraphrase is where invented numbers come from.
 *
 * Both product invariants are enforced right here, at the point where text is
 * composed:
 *   • measured-or-nothing — an absent value is reported as absent ("—", or
 *     simply not mentioned). Nothing defaults to 0 to look complete.
 *   • approval is the terminus — no handler describes anything as shipped,
 *     pushed or published, because ShipASO does not do that on its own. A test
 *     asserts the vocabulary never leaks.
 */
import {
  connectApp,
  getApps,
  getPortfolioRuns,
  getRun,
  getSchedule,
  me,
  preview,
  runApp,
  setNotifications,
  setSchedule,
  stageRunEdit,
} from "@shipaso/api";
import type { ApiClient, CopyFields, SweepCadence } from "@shipaso/api";
import type { ToolHandler } from "./registry.js";

/** Vocabulary that would breach "approval is the terminus". Used as a tripwire. */
export const SHIPPED_WORDS = ["shipped", "published", "went live", "pushed to the app store"] as const;

const CADENCES: readonly SweepCadence[] = ["daily", "weekly", "biweekly"];
const EDITABLE = ["name", "title", "subtitle", "keywords", "promo"] as const;

/** Render a value that may not exist. Never invents, never substitutes 0. */
const orDash = (v: unknown): string =>
  v === null || v === undefined || v === "" ? "—" : String(v);

const str = (args: Record<string, unknown>, key: string): string | undefined => {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

export function createHandlers(opts: {
  client: ApiClient;
  /** The run in scope on this route, if any. */
  runId?: () => string | null;
  /** The app in scope on this route, if any. */
  appId?: () => string | null;
}): Record<string, ToolHandler> {
  const c = opts.client;

  /** Resolve the run this call is about: an explicit argument, else the route. */
  const runFrom = (args: Record<string, unknown>): string => {
    const id = str(args, "runId") ?? opts.runId?.() ?? null;
    if (!id) throw new Error("no run in scope — open a run, or pass runId");
    return id;
  };
  const appFrom = (args: Record<string, unknown>): string => {
    const id = str(args, "appId") ?? opts.appId?.() ?? null;
    if (!id) throw new Error("no app in scope — open an app, or pass appId");
    return id;
  };

  return {
    async whoami() {
      const session = await me(c).catch(() => null);
      const email = session && (session as { email?: string }).email;
      if (!email) {
        return "Nobody is signed in to ShipASO in this page. Sign in to see the approval queue.";
      }
      // Counts are reported only when the reads succeed. A failed read means we
      // do not know the number, and saying "0 apps" would be a measured-or-
      // nothing violation dressed up as a fact.
      const apps = await getApps(c).catch(() => null);
      const runs = await getPortfolioRuns(c).catch(() => null);
      const appCount = apps ? String(apps.apps.length) : "—";
      const pending = runs
        ? String(runs.runs.filter((r) => r.status === "awaiting_approval").length)
        : "—";
      return (
        `Signed in as ${email}. Apps under Autopilot: ${appCount}. ` +
        `Runs waiting at the approval gate: ${pending}. ` +
        `You can read, explain, draft and stage — approving is the person's step.`
      );
    },

    /**
     * The agent-facing account of the gate.
     *
     * This is a CONTRACT, not marketing copy: it is what a well-behaved agent
     * reads to decide what not to attempt, so an overstated claim here is a
     * falsehood told to the one party that would test it.
     *
     * It said "approving requires a nonce minted by a real click, which a
     * script cannot produce" for as long as that mechanism had been deleted.
     * That design was measured NOT to hold and was replaced (#513, ADR-001).
     * The text now states only what `requireApprovalChallenge` enforces, and
     * states the limit that function's own docblock records: an agent in the
     * page can read the run view and therefore the challenge, and nothing
     * server-side can prove a human clicked — `isTrusted` never crosses the
     * network. What the challenge removes is credential vending, re-minting,
     * replay, and approval by a caller that never opened the run.
     */
    async describe_boundary() {
      return (
        "ShipASO's approval boundary: Autopilot prepares proposals on its own, and every " +
        "one of them stops at a gate. In this page you can list the queue, explain any " +
        "proposal, draft alternative copy, stage an edit so it is what the person sees, " +
        "and ask them to come and look. You cannot approve — no tool here approves, and " +
        "the server enforces that independently: approving a run requires a single-use " +
        "challenge issued when that run is opened and spent the moment it is used, so it " +
        "cannot be replayed or reused, and a caller that never opened the run has none. " +
        "That is a real constraint, not a claim about who you are — approving is the " +
        "person's step, and this page is built so an agent brings them a decision rather " +
        "than making it. Approving is also not shipping: it reveals the push commands to " +
        "the owner, and nothing reaches the App Store without a further, separate, human " +
        "action."
      );
    },

    async search_app(args) {
      const query = str(args, "query") ?? str(args, "name");
      if (!query) throw new Error("search_app needs a query — the app's name");
      const found = await preview(c, { query });
      const candidates = (found as { candidates?: Array<{ name?: string; bundle_id?: string }> })
        .candidates;
      if (!candidates?.length) return `No App Store app matched "${query}".`;
      return (
        `Matches for "${query}":\n` +
        candidates
          .slice(0, 8)
          .map((a, i) => `${i + 1}. ${orDash(a.name)} (${orDash(a.bundle_id)})`)
          .join("\n")
      );
    },

    async audit_app(args) {
      const query = str(args, "query") ?? str(args, "name");
      const bundleId = str(args, "bundleId") ?? str(args, "bundle_id");
      if (!query && !bundleId) throw new Error("audit_app needs a query or a bundleId");
      const result = await preview(c, {
        ...(bundleId ? { bundle_id: bundleId } : {}),
        ...(query ? { query } : {}),
      });
      const r = result as { name?: string; findings?: Array<{ title?: string; severity?: string }> };
      const findings = r.findings ?? [];
      if (!findings.length) {
        return `Audited ${orDash(r.name)}. No findings were measurable from the public listing.`;
      }
      return (
        `Audit of ${orDash(r.name)} — ${findings.length} finding(s):\n` +
        findings.map((f) => `• [${orDash(f.severity)}] ${orDash(f.title)}`).join("\n")
      );
    },

    async connect_app(args) {
      const query = str(args, "query") ?? str(args, "name");
      const bundleId = str(args, "bundleId") ?? str(args, "bundle_id");
      if (!query && !bundleId) throw new Error("connect_app needs a query or a bundleId");
      const app = await connectApp(c, {
        ...(bundleId ? { bundle_id: bundleId } : {}),
        ...(query ? { query } : {}),
      });
      const a = app as { id?: string; name?: string };
      return (
        `${orDash(a.name)} is now under Autopilot (${orDash(a.id)}). It will be swept on its ` +
        `schedule and any proposal will wait for a person at the gate. Nothing on the App ` +
        `Store has changed.`
      );
    },

    async trigger_run(args) {
      const id = appFrom(args);
      const run = await runApp(c, id);
      const r = run as { id?: string; status?: string };
      return (
        `Sweep run for this app: ${orDash(r.id)} (status ${orDash(r.status)}). ` +
        `If it opened a proposal it is waiting at the approval gate for a person.`
      );
    },

    async get_schedule(args) {
      const id = appFrom(args);
      const { schedule } = await getSchedule(c, id);
      const day = schedule.cadence === "daily" ? "every day" : `day ${schedule.day} (UTC)`;
      return `Autopilot checks this app ${schedule.cadence}, ${day} at ${schedule.hourUtc}:00 UTC.`;
    },

    async set_schedule(args) {
      const id = appFrom(args);
      const cadence = str(args, "cadence") as SweepCadence | undefined;
      if (!cadence || !CADENCES.includes(cadence)) {
        throw new Error(`cadence must be one of ${CADENCES.join(", ")}`);
      }
      // Fall back to the app's CURRENT slot rather than inventing one: an agent
      // asked to "make it daily" should not silently move the hour as well.
      const current = await getSchedule(c, id)
        .then((s) => s.schedule)
        .catch(() => null);
      const num = (key: string, fallback: number) => {
        const v = args[key];
        return typeof v === "number" && Number.isInteger(v) ? v : fallback;
      };
      const schedule = {
        cadence,
        day: num("day", current?.day ?? 1),
        hourUtc: num("hourUtc", current?.hourUtc ?? 9),
      };
      const saved = await setSchedule(c, id, schedule);
      return (
        `Autopilot will now check this app ${saved.schedule.cadence} at ` +
        `${saved.schedule.hourUtc}:00 UTC. This changes when proposals are prepared, ` +
        `never whether they are approved.`
      );
    },

    async list_pending_runs() {
      const { runs } = await getPortfolioRuns(c);
      const pending = runs.filter((r) => r.status === "awaiting_approval");
      if (!pending.length) {
        return "No runs are waiting at the approval gate. Nothing needs a person right now.";
      }
      return (
        `${pending.length} run(s) waiting for a person:\n` +
        pending
          .map((r) => {
            const rec = r as unknown as Record<string, unknown>;
            return `• ${orDash(rec.app_name)} — run ${orDash(rec.id)} (opened ${orDash(rec.created_at)})`;
          })
          .join("\n")
      );
    },

    async explain_run(args) {
      const id = runFrom(args);
      const run = await getRun(c, id);
      const r = run as unknown as Record<string, unknown>;
      const result = (r.result ?? {}) as Record<string, unknown>;
      const trigger = (r.trigger ?? {}) as { reasons?: string[] };
      const findings = (result.findings ?? []) as Array<{ title?: string; severity?: string }>;
      const lines = [
        `Run ${orDash(r.id)} is ${orDash(r.status)}.`,
        trigger.reasons?.length
          ? `Autopilot opened it because: ${trigger.reasons.join("; ")}.`
          : "No trigger reasons were recorded for this run.",
        findings.length
          ? `It measured ${findings.length} finding(s): ` +
            findings.slice(0, 5).map((f) => orDash(f.title)).join("; ") + "."
          : "It recorded no findings.",
        "Approving would reveal the push commands to the owner. It would not send anything " +
          "to the App Store — that stays a separate, explicit human step.",
      ];
      return lines.join(" ");
    },

    async get_run(args) {
      const id = runFrom(args);
      const run = await getRun(c, id);
      const r = run as unknown as Record<string, unknown>;
      const current = (r.currentCopy ?? {}) as Partial<CopyFields>;
      const result = (r.result ?? {}) as Record<string, unknown>;
      const proposed = (result.proposedCopy ?? {}) as Partial<CopyFields>;
      const field = (label: string, key: keyof CopyFields) =>
        `${label}: ${orDash(current[key])} → ${orDash(proposed[key])}`;
      return [
        `Run ${orDash(r.id)} (${orDash(r.status)}).`,
        field("Name", "name"),
        field("Subtitle", "subtitle"),
        field("Keywords", "keywords"),
        "The push commands stay hidden until a person approves.",
      ].join("\n");
    },

    async draft_alternative(args) {
      const id = runFrom(args);
      const run = await getRun(c, id);
      const r = run as unknown as Record<string, unknown>;
      const result = (r.result ?? {}) as Record<string, unknown>;
      const proposed = (result.proposedCopy ?? {}) as Partial<CopyFields>;
      // Deliberately does NOT write. The agent composing the alternative is the
      // caller's own model — this hands it the material and the constraints and
      // lets it draft, then stage_for_approval records the result.
      return [
        `Draft an alternative for run ${orDash(r.id)}. Autopilot currently proposes:`,
        `• name (30 chars max): ${orDash(proposed.name)}`,
        `• subtitle (30 chars max): ${orDash(proposed.subtitle)}`,
        `• keywords (100 chars max, comma-separated, no spaces): ${orDash(proposed.keywords)}`,
        "Compose your alternative within those limits, then call stage_for_approval to put " +
          "it in front of the person. Nothing is recorded until you stage it.",
      ].join("\n");
    },

    async stage_for_approval(args) {
      const id = runFrom(args);
      const edit: Partial<CopyFields> = {};
      for (const key of EDITABLE) {
        const v = str(args, key);
        if (v === undefined) continue;
        // "title" is what an agent naturally reaches for; the field is "name".
        if (key === "title") edit.name = v;
        else (edit as Record<string, string>)[key] = v;
      }
      if (Object.keys(edit).length === 0) {
        throw new Error("stage_for_approval needs at least one of: title, subtitle, keywords, promo");
      }
      const staged = await stageRunEdit(c, id, edit);
      return (
        `Staged ${staged.staged.join(", ") || "the edit"} on run ${orDash(staged.id)}. ` +
        `The run is still awaiting approval — a person has to approve it, and this only ` +
        `changed what they will be approving.`
      );
    },

    async request_notification(args) {
      const id = opts.runId?.() ?? str(args, "runId") ?? null;
      // Turning the run-ready channel ON is the honest interpretation of "ask
      // the human to look": we cannot conjure a channel they never verified, so
      // we enable the one they have and say exactly what that does.
      await setNotifications(c, { email_run_ready: true });
      return (
        `Run-ready notifications are on for this account, so the owner is told on their ` +
        `verified channels when a run reaches the gate${id ? ` (including ${id})` : ""}. ` +
        `If they have verified no channel, nothing can be delivered and they will have to ` +
        `open the dashboard themselves.`
      );
    },
  };
}
