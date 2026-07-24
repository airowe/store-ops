/**
 * useListingAudit — the try-before-signup audit state, lifted out of the widget
 * so the redesigned hero can put the INPUT in the left column and the RESULT
 * card in the right one while both read the same audit. The honesty rules live
 * with the data (an unmeasured rank is "—", a 404 surfaces as a real message,
 * never a fabricated preview), so any layout consuming this inherits them.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient, Candidate, PreviewResult } from "@shipaso/api";
import { preview } from "@shipaso/api";

export type ListingAuditState = {
  query: string;
  setQuery: (q: string) => void;
  candidates: Candidate[] | null;
  result: NonNullable<PreviewResult["preview"]> | null;
  note: string | null;
  isPending: boolean;
  search: (q: string) => void;
  pick: (bundleId: string) => void;
};

export function useListingAudit(client: ApiClient): ListingAuditState {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [result, setResult] = useState<NonNullable<PreviewResult["preview"]> | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function apply(r: PreviewResult) {
    if (r.needsChoice) {
      setCandidates(r.candidates ?? []);
      setResult(null);
      setNote((r.candidates ?? []).length === 0 ? "No apps found. Try a name, store link, or bundle id." : null);
    } else if (r.preview) {
      setResult(r.preview);
      setCandidates(null);
      setNote(null);
    } else {
      setNote(r.error ?? "Couldn’t preview that app.");
    }
  }

  function fail(e: unknown) {
    setCandidates(null);
    setResult(null);
    setNote(e instanceof Error ? e.message : "Couldn’t preview that app.");
  }

  const startFresh = () => setNote(null);

  const searchMut = useMutation({
    mutationFn: (q: string) => preview(client, { query: q }),
    onMutate: startFresh,
    onSuccess: apply,
    onError: fail,
  });
  const pickMut = useMutation({
    mutationFn: (bundle_id: string) => preview(client, { bundle_id }),
    onMutate: startFresh,
    onSuccess: apply,
    onError: fail,
  });

  return {
    query,
    setQuery,
    candidates,
    result,
    note,
    isPending: searchMut.isPending || pickMut.isPending,
    search: (q: string) => searchMut.mutate(q),
    pick: (bundleId: string) => pickMut.mutate(bundleId),
  };
}
