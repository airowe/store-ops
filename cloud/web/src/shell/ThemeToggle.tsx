/**
 * Dark ⇄ light toggle — opt-in, dark-first (matches the legacy app + brand).
 * Persists to the shared `store-ops:theme` key so the two surfaces agree.
 */
import { useCallback, useState } from "react";

function current(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function ThemeToggle() {
  // Lazy initializer — `current()` reads the DOM, and passing the call would run
  // it on every render only for React to discard the result after the first.
  const [theme, setThemeState] = useState<"light" | "dark">(current);
  const toggle = useCallback(() => {
    const next = current() === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("store-ops:theme", next);
    } catch {
      /* ignore */
    }
    setThemeState(next);
  }, []);
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label="Toggle light / dark theme"
      title="Toggle light / dark theme"
      onClick={toggle}
    >
      {theme === "light" ? "☾" : "☀"}
    </button>
  );
}
