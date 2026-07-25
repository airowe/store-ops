/**
 * LocalizationCard (#78) — the mobile review gate. Honesty invariants:
 *   • the verbatim machine-translation caveat rides through and renders — never
 *     softened, never omitted;
 *   • trimmed fields are stated, not hidden;
 *   • the approved-locale set comes from the SERVER, not an optimistic guess;
 *   • RTL drafts render with the right writing direction (allowed, not excluded)
 *     — a right-to-left translation is shown correctly, never broken or dropped.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { LocalizationCard } from "./LocalizationCard.js";
import type { ApiClient } from "../api/client.js";
import type { LocalizedDraft } from "../types/api.js";

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


const CAVEAT = "draft — machine-translated, review before shipping";

function fakeClient(opts: {
  draft?: LocalizedDraft;
  approved?: string[];
} = {}): { client: ApiClient; calls: string[] } {
  const calls: string[] = [];
  let approved = opts.approved ?? [];
  const respond = async (method: string, path: string): Promise<unknown> => {
    calls.push(`${method} ${path}`);
    if (path.endsWith("/localize") && method === "POST") {
      return (
        opts.draft ?? {
          locale: "de-DE",
          copy: { name: "Wetterly", subtitle: "Wetter, ehrlich", keywords: "wetter" },
          trimmed: ["subtitle"],
          label: CAVEAT,
        }
      );
    }
    if (path.endsWith("/localize/approve") && method === "POST") {
      approved = [...approved, "de-DE"];
      return { approved };
    }
    if (method === "DELETE") {
      approved = approved.filter((l) => !path.endsWith(`/${l}`));
      return { approved };
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  const client = {
    get: (p: string) => respond("GET", p),
    post: (p: string) => respond("POST", p),
    request: (p: string, o?: { method?: string }) => respond(o?.method ?? "GET", p),
  } as unknown as ApiClient;
  return { client, calls };
}

beforeEach(() => mockColorScheme.mockReturnValue("dark")); // every other test in this file assumes the dark default

describe("LocalizationCard", () => {
  it("is inert until the run is approved (localization is a post-approval handoff step)", () => {
    const { client } = fakeClient();
    render(<LocalizationCard client={client} runId="run-1" status="awaiting_approval" initialLocales={[]} />);
    // no locale chips / generate control on an unapproved run
    expect(screen.queryByTestId("loc-generate")).toBeNull();
    expect(screen.getByTestId("localization-locked")).toBeTruthy();
  });

  it("generate → renders the verbatim caveat + trimmed note → approve adds the locale from the server", async () => {
    const { client, calls } = fakeClient();
    render(<LocalizationCard client={client} runId="run-1" status="approved" initialLocales={[]} />);

    fireEvent.press(screen.getByTestId("loc-chip-de-DE"));
    fireEvent.press(screen.getByTestId("loc-generate"));

    // the verbatim honesty caveat renders, unmodified
    const caveat = await screen.findByTestId("loc-caveat");
    expect(caveat).toHaveTextContent(CAVEAT);
    // trimmed fields are stated
    expect(screen.getByTestId("loc-trimmed")).toHaveTextContent(/subtitle/);

    fireEvent.press(screen.getByTestId("loc-approve"));
    await waitFor(() => expect(calls).toContain("POST /runs/run-1/localize/approve"));
    await waitFor(() => expect(screen.getByTestId("loc-approved-de-DE")).toBeTruthy());
  });

  it("renders an RTL draft with right-to-left writing direction (allowed, shown correctly)", async () => {
    const { client } = fakeClient({
      draft: {
        locale: "ar-SA",
        copy: { name: "مانجيا", subtitle: "اطبخ بما لديك", keywords: "طبخ" },
        trimmed: [],
        label: CAVEAT,
      },
    });
    render(<LocalizationCard client={client} runId="run-1" status="approved" initialLocales={[]} />);

    fireEvent.press(screen.getByTestId("loc-chip-ar-SA"));
    fireEvent.press(screen.getByTestId("loc-generate"));

    const field = await screen.findByTestId("loc-field-name");
    // the RTL translation is rendered with rtl direction — never dropped, never broken.
    const style = Array.isArray(field.props.style)
      ? Object.assign({}, ...field.props.style.flat(Infinity).filter(Boolean))
      : field.props.style;
    expect(style.writingDirection).toBe("rtl");
  });

  it("removes an approved locale via DELETE, using the server's returned set", async () => {
    const { client, calls } = fakeClient({ approved: ["fr-FR"] });
    render(<LocalizationCard client={client} runId="run-1" status="approved" initialLocales={["fr-FR"]} />);
    expect(screen.getByTestId("loc-approved-fr-FR")).toBeTruthy();

    fireEvent.press(screen.getByTestId("loc-remove-fr-FR"));
    // the DELETE fires (deterministic), then the row clears from the server's set.
    await waitFor(() => expect(calls).toContain("DELETE /runs/run-1/localize/fr-FR"));
    await waitFor(() => expect(screen.queryByTestId("loc-approved-fr-FR")).toBeNull());
  });

  it("paints the machine-translation caveat from the LIVE palette (light provider → light warn)", async () => {
    mockColorScheme.mockReturnValue("light");
    const { client } = fakeClient();
    render(
      <ThemeProvider>
        <LocalizationCard client={client} runId="run-1" status="approved" initialLocales={[]} />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByTestId("loc-chip-de-DE"));
    fireEvent.press(screen.getByTestId("loc-generate"));
    await waitFor(() => expect(screen.getByTestId("loc-caveat")).toBeTruthy());

    expect(flatStyle(screen.getByTestId("loc-caveat")).color).toBe(lightPalette.warn);
    expect(lightPalette.warn).not.toBe(palette.warn);
  });
});
