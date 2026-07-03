/**
 * AuthProvider — owns the app's auth state and the single ApiClient instance.
 *
 * The client is wired to the session token store: it reads the Bearer token from
 * the keychain on every call and, on any 401, clears the token and flips state to
 * unauthed (the `onUnauthorized` hook). Deep links carrying a magic-link token are
 * captured and exchanged for a session token, then we re-boot.
 *
 * State machine: `loading` (boot in flight) → `authed` | `unauthed`. Screens read
 * it via `useAuth()`; the `(app)` group guard redirects to `(public)/login` when
 * unauthed.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as Linking from "expo-linking";
import { createApiClient, type ApiClient } from "../api/client.js";
import { apiBase } from "../lib/config.js";
import type { Me } from "../types/api.js";
import * as session from "./session.js";

export type AuthStatus = "loading" | "authed" | "unauthed";

export type AuthContextValue = {
  status: AuthStatus;
  me: Me | null;
  client: ApiClient;
  /** request a magic link for this email. */
  requestLink: (email: string) => Promise<void>;
  /** exchange a captured magic token, persist the session, re-boot. */
  completeMagicLink: (magicToken: string) => Promise<void>;
  /** re-run the boot check (e.g. after connecting an app). */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

export function AuthProvider({
  children,
  /** test seam: inject a client/base; defaults to the real wired client. */
  clientOverride,
}: {
  children: React.ReactNode;
  clientOverride?: ApiClient;
}) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [me, setMe] = useState<Me | null>(null);
  // Keep the latest setStatus reachable from the client's onUnauthorized.
  const flippedUnauthed = useRef(false);

  const client = useMemo<ApiClient>(() => {
    if (clientOverride) return clientOverride;
    return createApiClient({
      baseUrl: apiBase(),
      fetch: globalThis.fetch,
      getToken: session.getToken,
      onUnauthorized: () => {
        flippedUnauthed.current = true;
        void session.clearToken();
        setMe(null);
        setStatus("unauthed");
      },
    });
  }, [clientOverride]);

  const refresh = useMemo(
    () => async () => {
      try {
        const res = await session.boot(client);
        setMe(res);
        setStatus(res.authed ? "authed" : "unauthed");
      } catch {
        // A 401 already flipped us via onUnauthorized; any other error (offline)
        // leaves us unauthed but keeps the token for a later retry.
        if (!flippedUnauthed.current) setStatus("unauthed");
      }
    },
    [client],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      me,
      client,
      requestLink: async (email: string) => {
        await client.post("/auth/request", { email });
      },
      completeMagicLink: async (magicToken: string) => {
        setStatus("loading");
        try {
          await session.exchangeMagicLink(client, magicToken);
        } catch {
          // Invalid/expired link — NEVER strand the UI on "loading". Fall through
          // to a fresh boot: an existing session survives untouched; a logged-out
          // user lands back on the login screen.
        }
        await refresh();
      },
      refresh,
      signOut: async () => {
        await session.signOut();
        setMe(null);
        setStatus("unauthed");
      },
    }),
    [status, me, client, refresh],
  );

  // Boot on mount.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Capture a magic-link token from the launch URL + subsequent deep links.
  useEffect(() => {
    let active = true;
    void Linking.getInitialURL().then((url) => {
      const token = session.extractMagicToken(url);
      if (active && token) void value.completeMagicLink(token);
    });
    const sub = Linking.addEventListener("url", ({ url }) => {
      const token = session.extractMagicToken(url);
      if (token) void value.completeMagicLink(token);
    });
    return () => {
      active = false;
      sub.remove();
    };
    // value.completeMagicLink is stable enough for this effect's purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
