/**
 * Theme preference — three states, defaulting to the OS (#362).
 *
 * Mirrors `mobile/src/theme/ThemeProvider.tsx` (#353): the stored preference is
 * `system | light | dark`, an explicit choice always wins, and `system` defers
 * to the OS. Before this, the preference was two-state and an absent value
 * meant dark — so a machine set to Light rendered a dark app until the person
 * found the toggle.
 *
 * Pure and DOM-free so it unit-tests like the other shell helpers; the DOM
 * plumbing lives in `applyTheme` / `watchSystemTheme` below and in the
 * pre-paint script in index.html.
 */

/** What the customer chose. `system` means "whatever the OS says, live". */
export type ThemeMode = "system" | "light" | "dark";
/** What actually gets rendered. */
export type Scheme = "light" | "dark";

/** Shared with the legacy dashboard, which reads the same key. */
export const THEME_STORAGE_KEY = "store-ops:theme";

/** The media query the OS preference is read from. */
export const LIGHT_QUERY = "(prefers-color-scheme: light)";

/**
 * Normalize whatever is in storage into a mode.
 *
 * Anything unrecognised — absent, empty, mis-cased, or written by a future
 * version — becomes `system`. Defaulting to `dark` here is what caused #362.
 */
export function readMode(stored: string | null | undefined): ThemeMode {
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

/**
 * Resolve the preference against the OS.
 *
 * `os` is null/undefined where the browser cannot tell us (older engines, some
 * headless contexts). Dark is the brand default, so it is the honest fallback —
 * but only when we genuinely could not read a preference, never as a stand-in
 * for one we simply did not ask for.
 */
export function resolveScheme(mode: ThemeMode, os: Scheme | null | undefined): Scheme {
  if (mode === "light" || mode === "dark") return mode;
  return os === "light" ? "light" : "dark";
}

/** The OS scheme, or null when the browser cannot report one. */
export function systemScheme(): Scheme | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

/** Read the stored preference. Storage can throw (private mode, blocked cookies). */
export function storedMode(): ThemeMode {
  try {
    return readMode(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/** Persist the preference. Silent on failure — a theme is not worth an error. */
export function storeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** Paint a mode: resolve it against the OS and set the attribute the CSS keys on. */
export function applyTheme(mode: ThemeMode): Scheme {
  const scheme = resolveScheme(mode, systemScheme());
  document.documentElement.setAttribute("data-theme", scheme);
  return scheme;
}

/**
 * Re-apply on OS change, so a machine that auto-switches at sunset follows
 * without a reload. Only while the preference is `system` — an explicit choice
 * must not be overridden by the OS moving underneath it.
 *
 * Returns an unsubscribe function.
 */
export function watchSystemTheme(onChange: (scheme: Scheme) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(LIGHT_QUERY);
  const listener = (e: MediaQueryListEvent) => {
    if (storedMode() !== "system") return;
    const scheme: Scheme = e.matches ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", scheme);
    onChange(scheme);
  };
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}
