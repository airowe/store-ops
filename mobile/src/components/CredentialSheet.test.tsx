import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { CredentialSheet, type AscSubmit, type PlaySubmit } from "./CredentialSheet.js";

const P8 = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";
const SA = JSON.stringify({
  type: "service_account",
  private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----",
  client_email: "s@p.iam.gserviceaccount.com",
  token_uri: "https://oauth2.googleapis.com/token",
});

beforeEach(() => jest.clearAllMocks());

describe("CredentialSheet — asc", () => {
  it("blocks submit until p8 + key + issuer are valid, then emits the credential", () => {
    const onSubmit = jest.fn();
    render(<CredentialSheet variant="asc" onSubmit={onSubmit} />);

    // missing fields → validation error, no submit
    fireEvent.press(screen.getByTestId("asc-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/valid .p8/)).toBeTruthy();

    fireEvent.changeText(screen.getByTestId("asc-p8"), P8);
    fireEvent.changeText(screen.getByTestId("asc-keyid"), "KEY123");
    fireEvent.changeText(screen.getByTestId("asc-issuer"), "ISSUER123");
    fireEvent.press(screen.getByTestId("asc-submit"));

    expect(onSubmit).toHaveBeenCalledWith({ kind: "asc", cred: { p8: P8, keyId: "KEY123", issuerId: "ISSUER123" } });
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled(); // never persisted
  });
});

describe("CredentialSheet — asc save-key option (#270)", () => {
  it("does NOT offer to save the key when the deployment can't store (allowStore off)", () => {
    render(<CredentialSheet variant="asc" onSubmit={jest.fn()} />);
    expect(screen.queryByTestId("asc-store")).toBeNull();
  });

  it("offers save (default on) and emits store:true — the .p8 still never touches device storage", () => {
    const onSubmit = jest.fn();
    render(<CredentialSheet variant="asc" onSubmit={onSubmit} allowStore />);
    expect(screen.getByTestId("asc-store")).toBeTruthy();

    fireEvent.changeText(screen.getByTestId("asc-p8"), P8);
    fireEvent.changeText(screen.getByTestId("asc-keyid"), "KEY123");
    fireEvent.changeText(screen.getByTestId("asc-issuer"), "ISSUER123");
    fireEvent.press(screen.getByTestId("asc-submit"));

    expect(onSubmit).toHaveBeenCalledWith({ kind: "asc", cred: { p8: P8, keyId: "KEY123", issuerId: "ISSUER123" }, store: true });
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled(); // storage is server-side; never on device
  });

  it("toggling save off emits store:false (use-once)", () => {
    const onSubmit = jest.fn();
    render(<CredentialSheet variant="asc" onSubmit={onSubmit} allowStore />);
    fireEvent.press(screen.getByTestId("asc-store")); // on → off
    fireEvent.changeText(screen.getByTestId("asc-p8"), P8);
    fireEvent.changeText(screen.getByTestId("asc-keyid"), "K");
    fireEvent.changeText(screen.getByTestId("asc-issuer"), "I");
    fireEvent.press(screen.getByTestId("asc-submit"));
    expect(onSubmit).toHaveBeenCalledWith({ kind: "asc", cred: { p8: P8, keyId: "K", issuerId: "I" }, store: false });
  });
});

describe("CredentialSheet — asc how-to guidance", () => {
  it("offers a 'how to get your key' link that opens Apple's API-keys page", async () => {
    const Linking = jest.requireMock("expo-linking") as { openURL: jest.Mock };
    render(<CredentialSheet variant="asc" onSubmit={jest.fn()} />);
    fireEvent.press(screen.getByTestId("asc-key-help"));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalled());
    expect(Linking.openURL).toHaveBeenCalledWith(
      expect.stringContaining("appstoreconnect.apple.com"),
    );
  });

  it("mentions the self-serve Individual-key path (no admin role needed)", () => {
    render(<CredentialSheet variant="asc" onSubmit={jest.fn()} />);
    expect(screen.getByText(/individual/i)).toBeTruthy();
  });
});

describe("CredentialSheet — file picking (security)", () => {
  it("invokes the picker with copyToCacheDirectory:false — a cache copy would persist the credential", async () => {
    const DocumentPicker = jest.requireMock("expo-document-picker") as {
      getDocumentAsync: jest.Mock;
    };
    render(<CredentialSheet variant="asc" onSubmit={jest.fn()} />);
    fireEvent.press(screen.getByTestId("asc-pick"));
    await waitFor(() => expect(DocumentPicker.getDocumentAsync).toHaveBeenCalled());
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({ copyToCacheDirectory: false });
  });
});

describe("CredentialSheet — play", () => {
  it("rejects non-service-account JSON and accepts a valid one", () => {
    const onSubmit = jest.fn();
    render(<CredentialSheet variant="play" onSubmit={onSubmit} />);

    fireEvent.changeText(screen.getByTestId("play-json"), "{not json");
    fireEvent.press(screen.getByTestId("play-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/valid JSON/)).toBeTruthy();

    fireEvent.changeText(screen.getByTestId("play-json"), SA);
    fireEvent.press(screen.getByTestId("play-submit"));
    expect(onSubmit).toHaveBeenCalledWith({ kind: "play", serviceAccount: SA });
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled(); // never persisted
  });
});
