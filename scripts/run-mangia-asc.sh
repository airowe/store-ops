#!/usr/bin/env bash
#
# run-mangia-asc.sh — trigger a keyed App Store Connect read-run for Mangia
# WITHOUT re-typing your credentials in the browser.
#
# SECURITY MODEL:
#   • All secrets live ONLY in the macOS Keychain (encrypted at rest, gated by
#     your login). Nothing is written to disk in plaintext, kept in the browser's
#     localStorage, or printed. The .p8 is read into a shell variable for the
#     single request and never persisted.
#   • The ShipASO Worker still uses the .p8 per-request and never stores it
#     (the server-side guarantee is unchanged).
#
# ONE-TIME SETUP (run these four lines yourself, once — they prompt for the value
# via -w so the secret isn't in your shell history):
#
#   security add-generic-password -a "$USER" -s shipaso-asc-p8       -w
#   security add-generic-password -a "$USER" -s shipaso-asc-issuer   -w
#   security add-generic-password -a "$USER" -s shipaso-asc-keyid    -w
#   security add-generic-password -a "$USER" -s shipaso-session      -w
#
#   - shipaso-asc-p8     : paste the FULL contents of AuthKey_Q258S87XBL.p8
#                          (the -----BEGIN/END PRIVATE KEY----- block).
#   - shipaso-asc-issuer : your App Store Connect Issuer ID (UUID).
#   - shipaso-asc-keyid  : Q258S87XBL
#   - shipaso-session    : the value of the `store_ops_session` cookie. Grab it
#                          from Chrome → DevTools → Application → Cookies →
#                          https://app.shipaso.com → store_ops_session → copy the
#                          Value. (It's httpOnly, so it can't be read by scripts.)
#                          Refresh this if you get a 401 (sessions expire).
#
# To UPDATE any value later, re-run the same line (add -U to overwrite):
#   security add-generic-password -U -a "$USER" -s shipaso-session -w
#
# USAGE:
#   ./scripts/run-mangia-asc.sh
#
set -euo pipefail

API="https://api.shipaso.com"
APP_ID="8eee0f6a-18f8-43c9-b0f9-497cf60f858f"   # Mangia - Recipe Manager
LOCALE="en-US"

kc() {  # read a secret from the login Keychain by service name
  security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null || {
    echo "✗ Missing Keychain item '$1'. See ONE-TIME SETUP at the top of this script." >&2
    exit 1
  }
}

P8="$(kc shipaso-asc-p8)"
ISSUER="$(kc shipaso-asc-issuer)"
KEYID="$(kc shipaso-asc-keyid)"
SESSION="$(kc shipaso-session)"

echo "▶ Triggering ASC read-run for Mangia ($APP_ID)…"

# jq -Rs encodes the multi-line .p8 as a JSON string safely (preserves newlines).
BODY="$(jq -n \
  --arg p8 "$P8" \
  --arg keyId "$KEYID" \
  --arg issuerId "$ISSUER" \
  --arg locale "$LOCALE" \
  '{p8:$p8, keyId:$keyId, issuerId:$issuerId, locale:$locale}')"

RESP="$(curl -sS -X POST "$API/apps/$APP_ID/run-asc" \
  -H "content-type: application/json" \
  -H "cookie: store_ops_session=$SESSION" \
  --data "$BODY")"

# Surface the result. A 401 means the session cookie expired — refresh it.
if echo "$RESP" | grep -qi '"error"'; then
  echo "✗ Run failed:"
  echo "$RESP" | jq . 2>/dev/null || echo "$RESP"
  echo
  echo "  If this is a 401/auth error, refresh the session cookie:" >&2
  echo "    security add-generic-password -U -a \"\$USER\" -s shipaso-session -w" >&2
  exit 1
fi

RUN_ID="$(echo "$RESP" | jq -r '.id // empty')"
if [ -n "$RUN_ID" ]; then
  echo "✓ Run created: $RUN_ID"
  echo "  View: https://app.shipaso.com/#/runs/$RUN_ID"
else
  echo "Response:"; echo "$RESP" | jq . 2>/dev/null || echo "$RESP"
fi
