/**
 * resolveAscCredential (#179) — ONE way every ASC route resolves credentials:
 * in-request creds win when supplied; otherwise the STORED credential (opt-in,
 * envelope-encrypted) is used, so an approved run can be pushed from the UI
 * without re-pasting the .p8. Mirrors runAppWithAsc's semantics exactly:
 *   (useStored || no p8) + storage enabled → stored key;
 *   useStored with nothing stored → 404; otherwise missing creds → 400.
 * Deps are injected (enabled flag + loadStored closure) so this tests without
 * a KEK, a DB, or module mocks.
 */
import { describe, expect, it, vi } from "vitest";
import { AscCredentialError, resolveAscCredential } from "./ascCredentials.js";

const BODY_CRED = { p8: "-----BEGIN body key-----", keyId: "BODY1", issuerId: "iss-body" };
const STORED = {
  plaintext: "-----BEGIN stored key-----",
  meta: { keyId: "STOR1", issuerId: "iss-stored" },
};

const loadNone = async () => null;
const loadStored = async () => STORED;

describe("resolveAscCredential", () => {
  it("uses in-request creds when the full trio is supplied (stored untouched)", async () => {
    const load = vi.fn(loadStored);
    const cred = await resolveAscCredential({ body: BODY_CRED, enabled: true, loadStored: load });
    expect(cred).toEqual({ p8: BODY_CRED.p8, keyId: "BODY1", issuerId: "iss-body" });
    expect(load).not.toHaveBeenCalled();
  });

  it("falls back to the stored credential when no p8 arrives", async () => {
    const cred = await resolveAscCredential({ body: {}, enabled: true, loadStored });
    expect(cred).toEqual({ p8: STORED.plaintext, keyId: "STOR1", issuerId: "iss-stored" });
  });

  it("prefers the stored credential when useStored is explicit, even with body creds", async () => {
    const cred = await resolveAscCredential({
      body: { ...BODY_CRED, useStored: true },
      enabled: true,
      loadStored,
    });
    expect(cred.keyId).toBe("STOR1");
  });

  it("404s an explicit useStored when nothing is stored", async () => {
    const err = await resolveAscCredential({
      body: { useStored: true },
      enabled: true,
      loadStored: loadNone,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AscCredentialError);
    expect((err as AscCredentialError).status).toBe(404);
  });

  it("400s when no creds arrive and nothing is stored", async () => {
    const err = await resolveAscCredential({ body: {}, enabled: true, loadStored: loadNone })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AscCredentialError);
    expect((err as AscCredentialError).status).toBe(400);
  });

  it("400s without ever reading storage when credential storage is disabled", async () => {
    const load = vi.fn(loadStored);
    const err = await resolveAscCredential({ body: {}, enabled: false, loadStored: load })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AscCredentialError);
    expect((err as AscCredentialError).status).toBe(400);
    expect(load).not.toHaveBeenCalled();
  });

  it("400s an incomplete in-request trio (p8 without keyId/issuerId)", async () => {
    const err = await resolveAscCredential({
      body: { p8: BODY_CRED.p8 },
      enabled: true,
      loadStored: loadNone,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AscCredentialError);
    expect((err as AscCredentialError).status).toBe(400);
  });
});
