/**
 * ApiError — the single normalized error shape every API call rejects with, so
 * screens render one consistent failure path instead of branching on fetch
 * internals. The server returns honest, key-free messages (the credential path
 * never leaks a private key into an error); we surface them VERBATIM.
 */
export class ApiError extends Error {
  /** HTTP status (0 when the request never reached a response — network/abort). */
  readonly status: number;
  /** the parsed `{error}`/`{message}` body when present, else the raw text. */
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  /** a transport/abort failure that never produced an HTTP response. */
  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** the auth boundary — drives the sign-out hook. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/**
 * Pull the most human message out of an error body without ever inventing one.
 * The Worker returns `{ error: "..." }` (see `HttpError` in `cloud/src/api`);
 * some routes use `{ message }`. Falls back to the raw string, then a generic.
 */
export function messageFromBody(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (body && typeof body === "object") {
    const rec = body as Record<string, unknown>;
    if (typeof rec.error === "string" && rec.error.trim()) return rec.error.trim();
    if (typeof rec.message === "string" && rec.message.trim()) return rec.message.trim();
  }
  return fallback;
}
