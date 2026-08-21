/**
 * RunTriggerNote (mobile) — why this run exists, on the screen the push
 * notification opens.
 *
 * The notification says "a fix is ready." This is where the reader finds out
 * what the agent saw. The invariants match the web model exactly: an unknown
 * source is never narrated as an agent decision, an empty reason list never
 * becomes an invented one, and a run with no trigger renders nothing at all.
 */
import { render, screen } from "@testing-library/react-native";
import { useColorScheme } from "react-native";
import { ThemeProvider } from "../theme/index.js";

jest.mock("react-native/Libraries/Utilities/useColorScheme");
const mockColorScheme = useColorScheme as unknown as jest.Mock;
beforeEach(() => mockColorScheme.mockReturnValue("dark"));

import { RunTriggerNote } from "./RunTriggerNote.js";

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe("RunTriggerNote", () => {
  it("shows the agent's measured reasons on a cron run", () => {
    wrap(
      <RunTriggerNote
        trigger={{ source: "cron", reasons: ["lead keyword fell 4 places", "competitor changed subtitle"] }}
      />,
    );
    expect(screen.getByText(/ShipASO opened this run/)).toBeTruthy();
    expect(screen.getByText(/lead keyword fell 4 places/)).toBeTruthy();
    expect(screen.getByText(/competitor changed subtitle/)).toBeTruthy();
  });

  it("renders nothing when the run carried no trigger", () => {
    const { toJSON } = wrap(<RunTriggerNote trigger={undefined} />);
    expect(toJSON()).toBeNull();
  });

  it("does not claim the agent decided when the human asked for the run", () => {
    wrap(<RunTriggerNote trigger={{ source: "manual", reasons: [] }} />);
    expect(screen.queryByText(/ShipASO opened this run/)).toBeNull();
    expect(screen.getByText(/You asked for this run/)).toBeTruthy();
  });

  it("invents no reason text when the trace carried none", () => {
    wrap(<RunTriggerNote trigger={{ source: "cron", reasons: [] }} />);
    expect(screen.getByText(/ShipASO opened this run/)).toBeTruthy();
    expect(screen.queryByTestId("run-trigger-reasons")).toBeNull();
  });

  it("does not credit an unrecognized source to the agent", () => {
    wrap(<RunTriggerNote trigger={{ source: "webhook" as never, reasons: ["something"] }} />);
    expect(screen.queryByText(/ShipASO opened this run/)).toBeNull();
  });
});
