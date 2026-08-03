import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `app.config.ts` must not name a package that ships no config plugin.
 *
 * #427 added `"react-native-purchases"` to `plugins`. That package has no
 * `app.plugin.js`, so Expo falls back to loading its MAIN ENTRY as a plugin and
 * throws `PluginError: Unexpected token 'typeof'`. The blast radius is the
 * build, not the tests: `expo config --type prebuild` exits 1, and
 * `fastlane build` runs `expo prebuild` as its first step — so `main` could not
 * produce an .ipa while every unit test stayed green.
 *
 * The SDK autolinks natively; it never needed a plugin entry.
 *
 * This is a static guard — it reads the config source rather than resolving
 * plugins, so it stays fast and needs no Expo runtime. The real end-to-end
 * check is `npx expo config --type prebuild`, which is what caught this.
 */
const mobileRoot = join(__dirname, "..", "..");
const config = readFileSync(join(mobileRoot, "app.config.ts"), "utf8");

/**
 * Plugin NAMES from the `plugins: [...]` array, comments stripped.
 *
 * An entry is either `"name"` on its own line or `["name", {...}]`. Only the
 * leading string of a line counts — the options object also contains quoted
 * strings ("contain", a colour, an asset path), and scraping those produced a
 * false "contain (not installed)" the first time this was written.
 */
function pluginEntries(): string[] {
  const block = /plugins:\s*\[([\s\S]*?)\n  \],/.exec(config)?.[1] ?? "";
  const code = block
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"));

  const names: string[] = [];
  for (const line of code) {
    // `"pkg",` or `["pkg", { … }]` — the name is the first quoted token, and
    // only when it opens the entry.
    const m = /^\s*\[?\s*"([^"]+)"/.exec(line);
    if (m?.[1]) names.push(m[1]);
  }
  return names.filter((s) => !s.startsWith("./"));
}

describe("app.config.ts plugins", () => {
  it("does not list react-native-purchases (it ships no config plugin)", () => {
    expect(pluginEntries()).not.toContain("react-native-purchases");
  });

  /**
   * Generalizes the rule. Anything named in `plugins` must actually resolve as
   * one, or prebuild dies — and the failure surfaces only at build time.
   */
  it("every named plugin package resolves to a config plugin", () => {
    const offenders: string[] = [];
    for (const name of pluginEntries()) {
      // expo-* packages ship their plugin in-package; require.resolve on the
      // plugin entry is the honest check for third-party ones.
      try {
        require.resolve(`${name}/app.plugin.js`, { paths: [mobileRoot] });
      } catch {
        try {
          require.resolve(name, { paths: [mobileRoot] });
          // Resolves as a package but has no app.plugin.js — that is exactly
          // the react-native-purchases failure mode, EXCEPT for expo-* packages
          // which register plugins through their own main entry legitimately.
          if (!name.startsWith("expo-")) offenders.push(name);
        } catch {
          offenders.push(`${name} (not installed)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
