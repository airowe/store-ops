/**
 * AscPushCard (#270) — push approved copy to App Store Connect. Safety
 * invariants (load-bearing):
 *   • present ONLY on an approved/shipped run with a STORED key — never a way to
 *     push an unapproved run;
 *   • the push uses the stored key (useStored:true) — no .p8 is sent from the
 *     device here;
 *   • Apple's refusal is shown VERBATIM — never a fake "success" on a refusal;
 *   • a refused push offers the create-version recovery, then push again.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ApiClient } from "../api/client.js";
import type { AscPushResult, AscCreateVersionResult } from "../types/api.js";
import { AscPushCard } from "./AscPushCard.js";

function fakeClient(opts: {
  push?: AscPushResult;
  createVersion?: AscCreateVersionResult;
}): { client: ApiClient; bodies: Array<{ path: string; body: unknown }> } {
  const bodies: Array<{ path: string; body: unknown }> = [];
  const client = {
    get: async () => ({}),
    post: async (path: string, body?: unknown) => {
      bodies.push({ path, body });
      if (path.endsWith("/asc/push")) return opts.push ?? { ok: true, versionId: "v1", localizationId: "l1", fieldsPushed: ["subtitle", "keywords"] };
      if (path.endsWith("/asc/create-version")) return opts.createVersion ?? { ok: true, versionId: "v2", versionString: "1.2.0", state: "PREPARE_FOR_SUBMISSION" };
      throw new Error("unexpected " + path);
    },
    request: async () => ({}),
  } as unknown as ApiClient;
  return { client, bodies };
}

describe("AscPushCard", () => {
  it("renders nothing unless the run is approved AND a key is stored", () => {
    const { client } = fakeClient({});
    expect(render(<AscPushCard client={client} runId="r1" approved={false} storedKeyId="KID" />).toJSON()).toBeNull();
    expect(render(<AscPushCard client={client} runId="r1" approved={true} storedKeyId={null} />).toJSON()).toBeNull();
  });

  it("pushes with the STORED key (no .p8 from the device) and reports the staged fields", async () => {
    const { client, bodies } = fakeClient({});
    render(<AscPushCard client={client} runId="r1" approved={true} storedKeyId="KID123" />);

    fireEvent.press(screen.getByTestId("asc-push"));
    await waitFor(() => expect(screen.getByTestId("push-result")).toHaveTextContent(/subtitle, keywords/));
    // the push used the stored key — no raw .p8 in the request body
    const push = bodies.find((b) => b.path.endsWith("/asc/push"))!;
    expect(push.body).toEqual({ useStored: true });
    expect(JSON.stringify(push.body)).not.toMatch(/p8|BEGIN PRIVATE KEY/);
  });

  it("shows Apple's refusal VERBATIM — never a fake success", async () => {
    const { client } = fakeClient({ push: { ok: false, reason: "No editable version in PREPARE_FOR_SUBMISSION state." } });
    render(<AscPushCard client={client} runId="r1" approved={true} storedKeyId="KID" />);
    fireEvent.press(screen.getByTestId("asc-push"));
    await waitFor(() => expect(screen.getByTestId("push-result")).toHaveTextContent(/No editable version/));
    expect(screen.getByTestId("push-result")).not.toHaveTextContent(/Staged|success/i);
  });

  it("offers create-version recovery on a refused push, then lets you push again", async () => {
    const { client, bodies } = fakeClient({ push: { ok: false, reason: "no editable version" } });
    render(<AscPushCard client={client} runId="r1" approved={true} storedKeyId="KID" />);
    fireEvent.press(screen.getByTestId("asc-push"));
    await waitFor(() => expect(screen.getByTestId("create-version")).toBeTruthy());

    fireEvent.changeText(screen.getByTestId("cv-version"), "1.2.0");
    fireEvent.press(screen.getByTestId("cv-create"));
    await waitFor(() => expect(screen.getByTestId("cv-result")).toHaveTextContent(/1\.2\.0/));
    // create-version used the stored key + the typed version string
    const cv = bodies.find((b) => b.path.endsWith("/asc/create-version"))!;
    expect(cv.body).toEqual({ useStored: true, versionString: "1.2.0" });
  });
});
