/** Truthy flag parse for opt-in env switches ("1" or "true", any case). */
export function isFlagOn(v: string | undefined): boolean {
  return v === "1" || v?.toLowerCase() === "true";
}
