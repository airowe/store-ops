import { describe, expect, it, vi } from "vitest";
import { getModelContext, type ModelContext, type ToolDescriptor } from "./types.js";

const tool: ToolDescriptor = {
  name: "probe",
  description: "probe",
  execute: () => ({ content: [{ type: "text", text: "ok" }] }),
};

function context() {
  return { registerTool: vi.fn(() => undefined) } satisfies ModelContext;
}

describe("getModelContext", () => {
  it("prefers the document context when it is the only one available", () => {
    const documentContext = context();
    expect(getModelContext({ document: { modelContext: documentContext } })).toBe(documentContext);
  });

  it("falls back to the navigator context for older implementations", () => {
    const navigatorContext = context();
    expect(getModelContext({ navigator: { modelContext: navigatorContext } })).toBe(navigatorContext);
  });

  it("registers on distinct document and navigator contexts", () => {
    const documentContext = context();
    const navigatorContext = context();
    const combined = getModelContext({
      document: { modelContext: documentContext },
      navigator: { modelContext: navigatorContext },
    })!;

    combined.registerTool(tool);

    expect(documentContext.registerTool).toHaveBeenCalledWith(tool, undefined);
    expect(navigatorContext.registerTool).toHaveBeenCalledWith(tool, undefined);
  });

  it("does not register twice when document and navigator alias the same context", () => {
    const shared = context();
    const combined = getModelContext({
      document: { modelContext: shared },
      navigator: { modelContext: shared },
    })!;

    combined.registerTool(tool);

    expect(shared.registerTool).toHaveBeenCalledTimes(1);
  });

  it("waits for promise-returning registrations", async () => {
    let resolve!: () => void;
    const registration = new Promise<void>((done) => { resolve = done; });
    const documentContext = { registerTool: vi.fn(() => registration) } satisfies ModelContext;
    const combined = getModelContext({ document: { modelContext: documentContext } })!;

    const pending = Promise.resolve(combined.registerTool(tool));
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolve();
    await pending;
    expect(settled).toBe(true);
  });
});
