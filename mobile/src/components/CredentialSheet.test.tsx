import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
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
