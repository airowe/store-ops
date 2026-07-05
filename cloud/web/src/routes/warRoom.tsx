/**
 * /apps/:id/war-room (PRD 06) — the standalone competitor rank route.
 */
import { useParams } from "@tanstack/react-router";
import { WarRoomView } from "../features/warRoom/WarRoomView.js";
import { client } from "../api.js";

export function WarRoomRoute() {
  const { id } = useParams({ strict: false }) as { id: string };
  return <WarRoomView client={client} id={id} />;
}
