import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { PlayAudit } from "../types/api.js";
import { PlayAuditView } from "./PlayAuditView.js";
import { useColorScheme } from "react-native";
import { ThemeProvider } from "../theme/index.js";
import { lightPalette, palette } from "../theme/tokens.js";

jest.mock("react-native/Libraries/Utilities/useColorScheme");
const mockColorScheme = useColorScheme as unknown as jest.Mock;

/** Flatten RN's style prop (array | object) into one resolved object. */
function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  const flatten = (s: unknown): Record<string, unknown> =>
    Array.isArray(s) ? Object.assign({}, ...s.map(flatten)) : ((s ?? {}) as Record<string, unknown>);
  return flatten(node.props.style);
}


function audit(over: Partial<PlayAudit> = {}): PlayAudit {
  return {
    appId: "com.acme.app",
    listing: {
      store: "googleplay",
      appId: "com.acme.app",
      title: "Acme",
      tagline: null, // unmeasured short description
      keywordField: null, // Play has none — absent, never "empty 0/100"
      longDescription: "Long copy.",
      screenshots: [],
      category: null,
      reliable: true,
    },
    screenshots: {
      app: "Acme", primaryFamily: "phone", primaryCount: 4,
      families: [], score: 81, grade: "B", findings: [], aspectHint: "",
    },
    coverage: { fieldFill: [], distinctTerms: 12, waste: [], coverageScore: 74, stuffingRisk: false },
    keywords: { terms: [], missingFromDescription: [], uncovered: [], stuffed: [] },
    findings: [],
    summary: { critical: 0, warn: 1, good: 2, info: 0, total: 3, topImpact: "conversion", label: "1 fix available" },
    locks: [], // reliable connected tier → NO locks
    ...over,
  };
}

describe("PlayAuditView (connected tier honesty)", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("dark"));
  it("shows grade + a measured title, and an UNMEASURED short description as em-dash", () => {
    render(<PlayAuditView audit={audit()} />);
    expect(screen.getByText(/B · 81/)).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("— (unmeasured)")).toBeTruthy();
  });

  it("renders the summary label and coverage score", () => {
    render(<PlayAuditView audit={audit()} />);
    expect(screen.getByText("1 fix available")).toBeTruthy();
    expect(screen.getByText("74/100")).toBeTruthy();
  });

  it("a measured-but-empty field reads '(empty)', distinct from unmeasured", () => {
    render(<PlayAuditView audit={audit({ listing: { ...audit().listing, tagline: "" } })} />);
    expect(screen.getByText("(empty)")).toBeTruthy();
    expect(screen.queryByText("— (unmeasured)")).toBeNull();
  });
});

describe("PlayAuditView theming", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("light"));

  it("the coverage score uses the LIGHT signal inside a light provider", () => {
    render(
      <ThemeProvider>
        <PlayAuditView audit={audit()} />
      </ThemeProvider>,
    );
    expect(flatStyle(screen.getByText("74/100") as never).color).toBe(lightPalette.signal);
    expect(lightPalette.signal).not.toBe(palette.signal);
  });

  it("a stuffing-risk warning uses the LIGHT warn colour", () => {
    render(
      <ThemeProvider>
        <PlayAuditView audit={audit({ coverage: { ...audit().coverage, stuffingRisk: true } })} />
      </ThemeProvider>,
    );
    const warning = screen.getByText(/Possible keyword stuffing/);
    expect(flatStyle(warning as never).color).toBe(lightPalette.warn);
    expect(lightPalette.warn).not.toBe(palette.warn);
  });
});
