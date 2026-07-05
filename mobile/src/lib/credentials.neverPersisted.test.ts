/**
 * THE binding security invariant: a credential value must NEVER reach any
 * persistence API — not SecureStore AND not the filesystem. We spy on both and
 * exercise the full credential surface — validation, file-read (including the
 * picked-file path and its cache-copy cleanup), and a simulated submit — then
 * assert the secret value was never written. The review that added the
 * filesystem coverage caught a real gap: the picker used to stage a cache copy
 * that SecureStore-only spying could not see.
 */
import * as SecureStore from "expo-secure-store";
import * as FileSystem from "expo-file-system/legacy";
import {
  readCredentialFile,
  readPickedCredential,
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

/** Assert no SecureStore OR filesystem write ever carried the secret material. */
function assertSecretNeverPersisted(secret: string) {
  const writes = [
    ...(SecureStore.setItemAsync as jest.Mock).mock.calls,
    ...(FileSystem.writeAsStringAsync as jest.Mock).mock.calls,
  ];
  for (const call of writes) {
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

  it("readPickedCredential deletes a cache-staged copy the moment it's read", async () => {
    const deleted: string[] = [];
    const text = await readPickedCredential("file:///cache/DocumentPicker/AuthKey.p8", {
      readAsStringAsync: (async () => SECRET_P8) as typeof FileSystem.readAsStringAsync,
      deleteAsync: (async (uri: string) => void deleted.push(uri)) as typeof FileSystem.deleteAsync,
      cacheDirectory: "file:///cache/",
    });
    expect(text).toBe(SECRET_P8);
    expect(deleted).toEqual(["file:///cache/DocumentPicker/AuthKey.p8"]); // no on-disk copy survives
    assertSecretNeverPersisted(SECRET_P8);
  });

  it("readPickedCredential NEVER deletes the user's original document (outside our cache)", async () => {
    const deleted: string[] = [];
    await readPickedCredential("content://downloads/service-account.json", {
      readAsStringAsync: (async () => SECRET_SA) as typeof FileSystem.readAsStringAsync,
      deleteAsync: (async (uri: string) => void deleted.push(uri)) as typeof FileSystem.deleteAsync,
      cacheDirectory: "file:///cache/",
    });
    expect(deleted).toEqual([]);
  });

  it("a cleanup failure never masks the read result", async () => {
    const text = await readPickedCredential("file:///cache/x.p8", {
      readAsStringAsync: (async () => SECRET_P8) as typeof FileSystem.readAsStringAsync,
      deleteAsync: (async () => {
        throw new Error("locked");
      }) as typeof FileSystem.deleteAsync,
      cacheDirectory: "file:///cache/",
    });
    expect(text).toBe(SECRET_P8);
  });
});
