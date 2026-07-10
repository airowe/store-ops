/**
 * ONE credential-resolution path for every ASC route (#179): in-request creds
 * win when the full trio is supplied; otherwise the STORED credential (opt-in,
 * envelope-encrypted, #67) is decrypted for this single use — so an approved
 * run can be pushed from the UI without re-pasting the .p8. Semantics mirror
 * runAppWithAsc, which established them:
 *   (useStored || no p8) + storage enabled → stored key;
 *   useStored with nothing stored → 404; missing creds otherwise → 400.
 *
 * Deps arrive injected (the enabled flag and a loadStored closure) so the
 * logic unit-tests without a KEK, a DB, or module mocks — and the plaintext
 * stays a transient in the caller, never persisted or logged.
 */

export type AscCred = { p8: string; keyId: string; issuerId: string };

export type AscCredBody = {
  p8?: string;
  keyId?: string;
  issuerId?: string;
  /** Explicitly ask for the saved key (404 if none) instead of body creds. */
  useStored?: boolean;
};

export type StoredAscCredential = {
  plaintext: string;
  meta: { keyId: string; issuerId: string };
};

/** Routes map `status` onto their HttpError; messages are key-free. */
export class AscCredentialError extends Error {
  constructor(
    public readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

const MISSING = "p8, keyId, and issuerId are required (or save a key once and use it stored)";

export async function resolveAscCredential(opts: {
  body: AscCredBody;
  /** credentialsEnabled(env) — false when this deployment has no KEK. */
  enabled: boolean;
  /** Decrypt-and-return the stored ASC credential for this user+app, or null. */
  loadStored: () => Promise<StoredAscCredential | null>;
}): Promise<AscCred> {
  const { body, enabled, loadStored } = opts;

  if ((body.useStored || !body.p8) && enabled) {
    const stored = await loadStored();
    if (stored) {
      return {
        p8: stored.plaintext,
        keyId: stored.meta.keyId,
        issuerId: stored.meta.issuerId,
      };
    }
    if (body.useStored) {
      throw new AscCredentialError(404, "no saved App Store Connect key for this app");
    }
    throw new AscCredentialError(400, MISSING);
  }

  if (!body.p8 || !body.keyId || !body.issuerId) {
    throw new AscCredentialError(400, MISSING);
  }
  return { p8: body.p8, keyId: body.keyId, issuerId: body.issuerId };
}
