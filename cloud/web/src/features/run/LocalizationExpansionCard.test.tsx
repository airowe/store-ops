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

  /**
   * #388 density. On a real run (Heathen, 7dd8ee24) all 7 recommendations were
   * `large` / `translate`, so the card printed "large market" seven times and
   * "translate existing copy" seven times — fourteen chips carrying two facts.
   *
   * Meanwhile the one genuinely distinguishing field, `rationale` ("German-
   * speaking audiences across DACH", "Japanese-speaking audiences", …), was
   * never rendered at all. The card was repeating what every row shares and
   * dropping what makes each row worth reading.
   *
   * So: a tier/effort shared by EVERY row is stated once for the group, and the
   * per-locale rationale takes the space that frees up. When they differ the
   * chips stay per row — collapsing genuinely varying labels would hide data.
   */
  describe("shared labels stated once; the distinguishing detail shown (#388)", () => {
    const large = (locale: string, rationale: string): LocaleRecommendation => ({
      locale,
      rationale,
      storefrontTier: "large",
      effort: "translate",
    });

    it("hoists tier and effort when every row shares them, and shows each rationale", () => {
      render(
        <LocalizationExpansionCard
          recommendations={[
            large("de-DE", "German-speaking audiences across DACH."),
            large("ja-JP", "Japanese-speaking audiences."),
            large("ko-KR", "Korean-speaking audiences."),
          ]}
        />,
      );

      // The shared facts appear once, not once per row.
      expect(screen.getAllByText(/large market/)).toHaveLength(1);
      expect(screen.getAllByText(/translate existing copy/)).toHaveLength(1);

      // The per-locale rationale — previously never rendered — is now visible.
      expect(screen.getByText(/German-speaking audiences across DACH/)).toBeInTheDocument();
      expect(screen.getByText(/Japanese-speaking audiences/)).toBeInTheDocument();
      expect(screen.getByText(/Korean-speaking audiences/)).toBeInTheDocument();

      // Locales and their size bars survive.
      for (const l of ["de-DE", "ja-JP", "ko-KR"]) {
        expect(screen.getByTestId(`loc-rec-${l}`)).toHaveTextContent(l);
        expect(screen.getByTestId(`loc-bar-${l}`)).toBeInTheDocument();
      }
    });

    it("keeps tier and effort per row when they differ", () => {
      render(
        <LocalizationExpansionCard
          recommendations={[
            { locale: "de-DE", rationale: "German", storefrontTier: "large", effort: "translate" },
            { locale: "pt-BR", rationale: "Portuguese", storefrontTier: "mid", effort: "new" },
          ]}
        />,
      );
      // Mixed tiers/efforts must NOT collapse — that would misreport pt-BR.
      expect(screen.getByTestId("loc-rec-de-DE")).toHaveTextContent("large market");
      expect(screen.getByTestId("loc-rec-de-DE")).toHaveTextContent("translate existing copy");
      expect(screen.getByTestId("loc-rec-pt-BR")).toHaveTextContent("mid market");
      expect(screen.getByTestId("loc-rec-pt-BR")).toHaveTextContent("net-new metadata");
    });
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
