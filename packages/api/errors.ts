/** A typed API failure carrying the HTTP status (lifted from mobile/src/api). */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
  /** 402 → the tier-limit paywall surface (web modal / native sheet). */
  get isTierLimit(): boolean {
    return this.status === 402;
  }
}
