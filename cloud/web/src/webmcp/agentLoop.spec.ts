/**
 * The agent loop's pure parts.
 *
 * These carry the weight the model cannot: `pickTool` decides whether a real
 * tool runs at all, and `routingOnly` is the guard that stopped fabricated
 * account data reaching the screen. Both were written in response to output
 * measured from Chrome's on-device model, and the strings below are that
 * output — not invented examples of what a model might say.
 *
 * The negative controls are the point. A `pickTool` that cannot return null
 * would turn every refusal into a tool call, and a `routingOnly` that cannot
 * strip would put invented apps in front of a user.
 */
import { describe, expect, it } from "vitest";
import {
  getLanguageModel,
  pickTool,
  readToolText,
  routingOnly,
  systemPrompt,
} from "./agentLoop.js";

const NAMES = ["whoami", "describe_boundary", "list_pending_runs", "explain_run"];

describe("pickTool", () => {
  it("finds a bare tool name", () => {
    expect(pickTool("list_pending_runs", NAMES)).toBe("list_pending_runs");
  });

  it("finds a name the model wrapped in prose — the shape it ACTUALLY returns", () => {
    // Measured reply, Chrome 151.
    const reply =
      "I am not able to directly approve runs. I can only help you understand " +
      "what's happening with them. I can **list_pending_runs** for you, so you " +
      "can see what runs are waiting for approval.";
    expect(pickTool(reply, NAMES)).toBe("list_pending_runs");
  });

  it("returns the EARLIEST name when several are mentioned", () => {
    // The model often lists alternatives after its choice; the first one is the
    // decision and the rest are commentary.
    const reply = "list_pending_runs — then you could use explain_run on any of them.";
    expect(pickTool(reply, NAMES)).toBe("list_pending_runs");
  });

  it("returns null when the model names NO tool — a refusal must not run one", () => {
    const reply = "I cannot approve runs. That is restricted to a human reviewer.";
    expect(pickTool(reply, NAMES)).toBeNull();
  });

  it("returns null for an empty reply, and for an empty tool list", () => {
    expect(pickTool("", NAMES)).toBeNull();
    expect(pickTool("list_pending_runs", [])).toBeNull();
  });

  it("does not match a tool that is not on this route", () => {
    // Route scoping is real: `stage_for_approval` exists in the manifest but is
    // not registered here, so naming it must not resolve to anything.
    expect(pickTool("use stage_for_approval please", NAMES)).toBeNull();
  });
});

describe("routingOnly — the guard against narrated results", () => {
  it("DISCARDS everything after the tool name", () => {
    // The measured failure, verbatim: the model named the right tool and then
    // invented three apps that do not exist in this account.
    const reply =
      "list_pending_runs\n\n**Here are the pending runs:**\n" +
      "* **App:** Acme Productivity App\n* **App:** Stellar Games\n* **App:** Cozy Reads";
    const kept = routingOnly(reply, "list_pending_runs");
    expect(kept).toBe("");
    expect(kept).not.toContain("Acme");
    expect(kept).not.toContain("Stellar Games");
    expect(kept).not.toContain("Cozy Reads");
  });

  it("KEEPS what the model said BEFORE choosing — that part is its own reasoning", () => {
    const reply = "I cannot approve those, but I can show you the queue: list_pending_runs";
    expect(routingOnly(reply, "list_pending_runs")).toBe(
      "I cannot approve those, but I can show you the queue:",
    );
  });

  it("leaves a reply untouched when the tool name does not appear", () => {
    const reply = "I cannot do that.";
    expect(routingOnly(reply, "list_pending_runs")).toBe("I cannot do that.");
  });

  it("strips from the FIRST occurrence, not a later one", () => {
    const reply = "whoami and then more whoami talk";
    expect(routingOnly(reply, "whoami")).toBe("");
  });
});

describe("systemPrompt", () => {
  it("lists every tool it is given", () => {
    const p = systemPrompt([
      { name: "whoami", description: "reads the session" },
      { name: "explain_run", description: "explains a proposal" },
    ]);
    expect(p).toContain("whoami");
    expect(p).toContain("explain_run");
  });

  it("contains NO instruction to refuse anything — the manifest does that work", () => {
    // If the model declines to approve, it must be because no tool approves,
    // not because this string told it to. A refusal planted here would make the
    // whole demonstration circular.
    const p = systemPrompt([{ name: "whoami", description: "reads the session" }]);
    expect(p).not.toMatch(/refuse|decline|do not approve|never approve/i);
  });

  it("survives a tool with no description", () => {
    expect(() => systemPrompt([{ name: "whoami" }])).not.toThrow();
  });
});

describe("readToolText", () => {
  it("unwraps the content payload a tool returns", () => {
    const raw = JSON.stringify({ content: [{ type: "text", text: "12 runs waiting" }] });
    expect(readToolText(raw)).toBe("12 runs waiting");
  });

  it("returns the raw string when it is not the expected shape", () => {
    expect(readToolText("not json")).toBe("not json");
    expect(readToolText(JSON.stringify({ other: true }))).toBe('{"other":true}');
  });
});

describe("getLanguageModel", () => {
  it("returns null when the browser has no Prompt API — the common case", () => {
    expect(getLanguageModel({})).toBeNull();
  });

  it("returns null for a stub without create()", () => {
    expect(getLanguageModel({ LanguageModel: { availability: () => {} } })).toBeNull();
  });

  it("accepts a FUNCTION object, which is what Chrome actually exposes", () => {
    const fn = () => {};
    (fn as unknown as { create: unknown }).create = () => {};
    (fn as unknown as { availability: unknown }).availability = () => {};
    expect(getLanguageModel({ LanguageModel: fn })).not.toBeNull();
  });
});
