import { render, screen } from "@testing-library/react-native";
import type { LocaleRecommendation } from "../types/api.js";
import { LocalizationExpansionCard } from "./LocalizationExpansionCard.js";

const REC = (over: Partial<LocaleRecommendation> = {}): LocaleRecommendation => ({
  locale: "de-DE",
  rationale: "Large storefront; you already rank in adjacent markets.",
  storefrontTier: "large",
  effort: "translate",
  ...over,
});

describe("<LocalizationExpansionCard />", () => {
  it("renders each recommended locale with its rationale and effort", () => {
    render(
      <LocalizationExpansionCard
        recommendations={[
          REC(),
          REC({ locale: "ja", storefrontTier: "mid", effort: "new", rationale: "Untapped." }),
        ]}
      />,
    );
    expect(screen.getByTestId("locale-rec-de-DE")).toBeTruthy();
    expect(screen.getByTestId("locale-rec-ja")).toBeTruthy();
    expect(screen.getByText(/already rank in adjacent markets/)).toBeTruthy();
    // effort is labeled honestly, not hidden — "translate" existing vs net-new.
    expect(screen.getByText(/translate existing copy/)).toBeTruthy();
    expect(screen.getByText(/new metadata/)).toBeTruthy();
  });

  it("renders nothing when there are no recommendations (no empty card)", () => {
    const { toJSON } = render(<LocalizationExpansionCard recommendations={[]} />);
    expect(toJSON()).toBeNull();
  });

  it("renders nothing when the field is absent (older runs)", () => {
    const { toJSON } = render(<LocalizationExpansionCard recommendations={undefined} />);
    expect(toJSON()).toBeNull();
  });
});
