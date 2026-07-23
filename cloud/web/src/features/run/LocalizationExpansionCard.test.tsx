import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LocaleRecommendation } from "@shipaso/api";
import { LocalizationExpansionCard } from "./LocalizationExpansionCard.js";

const rec: LocaleRecommendation = {
  locale: "es-MX",
  rationale: "Large Spanish-speaking market you don’t list in.",
  storefrontTier: "large",
  effort: "new",
};

const translatable: LocaleRecommendation = {
  locale: "fr-FR",
  rationale: "You already ship English copy to translate.",
  storefrontTier: "mid",
  effort: "translate",
};

describe("<LocalizationExpansionCard />", () => {
  it("renders each locale with its tier, effort, and honest rationale", () => {
    render(<LocalizationExpansionCard recommendations={[rec]} />);
    const row = screen.getByTestId("loc-rec-es-MX");
    expect(row).toHaveTextContent("es-MX");
    expect(row).toHaveTextContent("large market");
    expect(row).toHaveTextContent("net-new metadata");
    expect(screen.getByTestId("loc-rationale")).toBeInTheDocument();
  });

  it("labels a translate-effort locale distinctly", () => {
    render(<LocalizationExpansionCard recommendations={[translatable]} />);
    expect(screen.getByTestId("loc-rec-fr-FR")).toHaveTextContent("translate existing copy");
  });

  it("renders nothing when there are no recommendations", () => {
    const { container } = render(<LocalizationExpansionCard recommendations={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("states the rationale once and renders a compact ranked table with size bars", () => {
    render(
      <LocalizationExpansionCard
        recommendations={[
          { locale: "de-DE", rationale: "German", storefrontTier: "large", effort: "translate" },
          { locale: "pt-BR", rationale: "Portuguese", storefrontTier: "mid", effort: "new" },
        ]}
      />,
    );
    // one shared rationale line (heuristic disclosure kept)
    expect(screen.getByTestId("loc-rationale")).toBeInTheDocument();
    // rows present, in order, with size bars scaled by tier
    const de = screen.getByTestId("loc-rec-de-DE");
    const pt = screen.getByTestId("loc-rec-pt-BR");
    expect(de).toHaveTextContent("large market");
    expect(pt).toHaveTextContent("net-new metadata");
    expect(screen.getByTestId("loc-bar-de-DE")).toHaveStyle({ width: "100%" });
    expect(screen.getByTestId("loc-bar-pt-BR")).toHaveStyle({ width: "60%" });
  });
});
