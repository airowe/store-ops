/**
 * /runs/:id (PRD 07) — the money screen. Migrated LAST, once the pattern was
 * proven on 03–06.
 */
import { useNavigate, useParams } from "@tanstack/react-router";
import { RunView } from "../features/run/RunView.js";
import { client } from "../api.js";

export function RunRoute() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  return <RunView client={client} id={id} onConnect={() => void navigate({ to: "/settings" })} />;
}
