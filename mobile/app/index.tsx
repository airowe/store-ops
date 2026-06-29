/**
 * Entry route — bounce into the authed group. The `(app)` guard handles the
 * loading spinner and the redirect to `(public)/login` when unauthed, so the
 * routing decision lives in exactly one place.
 */
import { Redirect } from "expo-router";

export default function Index() {
  return <Redirect href="/(app)" />;
}
