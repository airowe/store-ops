/**
 * Public (logged-out) routes: /login, /preview, /proof (PRD 09). SPA for now;
 * SSR (first-paint + SEO via TanStack Start) is the documented follow-up.
 */
import { useNavigate } from "@tanstack/react-router";
import { LandingView } from "../features/public/LandingView.js";
import { LoginView } from "../features/public/LoginView.js";
import { PreviewView } from "../features/public/PreviewView.js";
import { ProofView } from "../features/public/ProofView.js";
import { BroadcastView } from "../features/broadcast/BroadcastView.js";
import { client } from "../api.js";

export function LandingRoute() {
  const navigate = useNavigate();
  return (
    <LandingView
      client={client}
      onSignIn={() => void navigate({ to: "/login" })}
    />
  );
}

export function LoginRoute() {
  return <LoginView client={client} />;
}

export function PreviewRoute() {
  const navigate = useNavigate();
  return <PreviewView client={client} onSignIn={() => void navigate({ to: "/login" })} />;
}

export function ProofRoute() {
  return <ProofView client={client} />;
}

export function BroadcastRoute() {
  return <BroadcastView client={client} />;
}
