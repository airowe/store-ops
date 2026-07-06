/**
 * /runs/:id (PRD 07) — the money screen. Migrated LAST, once the pattern was
 * proven on 03–06.
 */
import { useParams } from "@tanstack/react-router";
import { RunView } from "../features/run/RunView.js";
import { client } from "../api.js";

export function RunRoute() {
  const { id } = useParams({ strict: false }) as { id: string };
  return <RunView client={client} id={id} />;
}
