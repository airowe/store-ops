import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { PlayAudit } from "../types/api.js";
import { PlayAuditView } from "./PlayAuditView.js";

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
