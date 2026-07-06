/**
 * Env pill state — the honest "live · <host>" vs "demo backend" chip in the
 * topbar. Mirrors the legacy `setEnvPill()`: it must never claim "live" without
 * a configured API base. Pure so the label logic is tested once.
 */
export type EnvPill = { kind: "live" | "demo"; label: string; title: string };

export function envPill(apiBase: string | null | undefined): EnvPill {
  if (apiBase) {
    return {
      kind: "live",
      label: "live · " + apiBase.replace(/^https?:\/\//, ""),
      title: "Calling the deployed Worker API",
    };
  }
  return {
    kind: "demo",
    label: "demo backend",
    title: "No API base configured — using the in-browser demo backend",
  };
}
