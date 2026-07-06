/**
 * /settings — first real route cutover (PRD 03). Wraps the injectable
 * SettingsView with the singleton client; sign-out returns to "/".
 */
import { useNavigate } from "@tanstack/react-router";
import { SettingsView } from "../features/settings/SettingsView.js";
import { client } from "../api.js";

export function SettingsRoute() {
  const navigate = useNavigate();
  return <SettingsView client={client} onSignedOut={() => void navigate({ to: "/" })} />;
}
