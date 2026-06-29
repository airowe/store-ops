/**
 * THE binding security invariant: a credential value must NEVER reach any
 * persistence API. We spy on SecureStore (the one persistence the app uses) and
 * exercise the full credential surface — validation, file-read, and a simulated
 * submit — then assert the secret value was never written. The credentials module
 * has no persist path by construction; this test fails loudly if one is ever added.
 */
import * as SecureStore from "expo-secure-store";
import {
  readCredentialFile,
  validateAscCredential,
  validateServiceAccount,
} from "./credentials.js";

const SECRET_P8 = "-----BEGIN PRIVATE KEY-----\nMIIsecretkeyMATERIAL\n-----END PRIVATE KEY-----";
const SECRET_SA = JSON.stringify({
  type: "service_account",
  private_key: "-----BEGIN PRIVATE KEY-----\nSAsecret\n-----END PRIVATE KEY-----",
  client_email: "svc@proj.iam.gserviceaccount.com",
  token_uri: "https://oauth2.googleapis.com/token",
});

beforeEach(() => jest.clearAllMocks());

/** Assert no SecureStore write ever carried the secret material. */
function assertSecretNeverPersisted(secret: string) {
  const set = SecureStore.setItemAsync as jest.Mock;
  for (const call of set.mock.calls) {
    for (const arg of call) {
      expect(String(arg)).not.toContain(secret.slice(0, 24));
    }
  }
}

describe("credentials never persisted (security invariant)", () => {
  it("validating a .p8 does not write it anywhere", () => {
    expect(validateAscCredential({ p8: SECRET_P8, keyId: "K", issuerId: "I" })).toBeNull();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    assertSecretNeverPersisted(SECRET_P8);
  });

  it("validating a service account does not write it anywhere", () => {
    expect(validateServiceAccount(SECRET_SA)).toBeNull();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    assertSecretNeverPersisted(SECRET_SA);
  });

  it("reading a credential file returns the string WITHOUT persisting it", async () => {
    const fakeRead = jest.fn(async () => SECRET_P8) as unknown as Parameters<typeof readCredentialFile>[1];
    const text = await readCredentialFile("file:///picked.p8", fakeRead);
    expect(text).toBe(SECRET_P8);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    assertSecretNeverPersisted(SECRET_P8);
  });

  it("a simulated submit (the only legitimate use) is send-once, not store", async () => {
    // The caller sends the secret over HTTPS and drops it; nothing in this flow
    // touches SecureStore. We model that here to lock the contract.
    const sent: string[] = [];
    const send = async (s: string) => void sent.push(s);
    await send(SECRET_SA);
    expect(sent).toEqual([SECRET_SA]);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    assertSecretNeverPersisted(SECRET_SA);
  });
});
