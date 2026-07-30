import { render, screen } from "@testing-library/react-native";
import type { LocaleRecommendation } from "../types/api.js";
import { LocalizationExpansionCard } from "./LocalizationExpansionCard.js";
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


const REC = (over: Partial<LocaleRecommendation> = {}): LocaleRecommendation => ({
  locale: "de-DE",
  rationale: "Large storefront; you already rank in adjacent markets.",
  storefrontTier: "large",
  effort: "translate",
  ...over,
});

describe("<LocalizationExpansionCard />", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("dark"));
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

describe("LocalizationExpansionCard theming", () => {
  beforeEach(() => mockColorScheme.mockReturnValue("light"));

  it("the storefront tier uses the LIGHT signal inside a light provider", () => {
    render(
      <ThemeProvider>
        <LocalizationExpansionCard recommendations={[REC()]} />
      </ThemeProvider>,
    );
    expect(flatStyle(screen.getByText("large") as never).color).toBe(lightPalette.signal);
    expect(lightPalette.signal).not.toBe(palette.signal);
  });
});
