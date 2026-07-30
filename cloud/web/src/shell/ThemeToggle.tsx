/**
 * Dark ⇄ light toggle in the topbar.
 *
 * The preference is three-state and defaults to `system` (#362) — see
 * `shell/theme.ts`. This control is a quick flip, so clicking it makes an
 * EXPLICIT choice: it resolves what is on screen now and stores the opposite.
 * "Follow my system again" lives in Settings → Appearance, because a two-state
 * toggle cannot express three states honestly.
 *
 * While the preference is `system`, the button also follows the OS live, so a
 * machine that switches at sunset updates without a reload.
 */
import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  resolveScheme,
  storedMode,
  storeMode,
  systemScheme,
  watchSystemTheme,
  type Scheme,
} from "./theme.js";

export function ThemeToggle() {
  // Lazy initializer — resolving reads the DOM/OS, and passing the call would
  // run it on every render only for React to discard the result after the first.
  const [scheme, setScheme] = useState<Scheme>(() => resolveScheme(storedMode(), systemScheme()));

  // Follow the OS while the preference is `system`. watchSystemTheme is a no-op
  // when an explicit choice is stored, so this never fights the customer.
  useEffect(() => watchSystemTheme(setScheme), []);

  const toggle = useCallback(() => {
    const next: Scheme = scheme === "light" ? "dark" : "light";
    storeMode(next);
    applyTheme(next);
    setScheme(next);
  }, [scheme]);

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label="Toggle light / dark theme"
      title="Toggle light / dark theme"
      onClick={toggle}
    >
      {scheme === "light" ? "☾" : "☀"}
    </button>
  );
}
