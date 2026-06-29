import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import type { CopyFields, PushCommand } from "../types/api.js";
import { ApprovalGate } from "./ApprovalGate.js";

const current: CopyFields = { name: "Old Name", subtitle: "old sub" };
const proposed: CopyFields = { name: "New Name", subtitle: "new sub", keywords: "a,b,c" };
const cmds: PushCommand[] = [
  { store: "appstore", tool: "asc", description: "Stage name", command: "asc metadata set --name 'New Name'" },
];

describe("ApprovalGate (honesty: no push before approval)", () => {
  it("pending: shows approve/reject and HIDES the handoff commands", () => {
    render(
      <ApprovalGate status="awaiting_approval" current={current} proposed={proposed} pushCommands={[]} onApprove={() => {}} onReject={() => {}} />,
    );
    expect(screen.getByTestId("approve")).toBeTruthy();
    expect(screen.getByTestId("reject")).toBeTruthy();
    expect(screen.queryByTestId("handoff")).toBeNull();
  });

  it("approved: reveals the handoff commands as a copyable (non-executed) list", () => {
    render(
      <ApprovalGate status="approved" current={current} proposed={proposed} pushCommands={cmds} onApprove={() => {}} onReject={() => {}} />,
    );
    expect(screen.getByTestId("handoff")).toBeTruthy();
    expect(screen.getByText(/asc metadata set/)).toBeTruthy();
    expect(screen.getByText(/never pushes to a live store/)).toBeTruthy();
    // no approve button once decided
    expect(screen.queryByTestId("approve")).toBeNull();
  });

  it("even if pushCommands arrive while pending, the handoff stays hidden", () => {
    // defensive: a non-empty pushCommands with a pending status must NOT render.
    render(
      <ApprovalGate status="awaiting_approval" current={current} proposed={proposed} pushCommands={cmds} onApprove={() => {}} onReject={() => {}} />,
    );
    expect(screen.queryByTestId("handoff")).toBeNull();
  });

  it("approve / reject fire their callbacks", () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();
    render(
      <ApprovalGate status="awaiting_approval" current={current} proposed={proposed} pushCommands={[]} onApprove={onApprove} onReject={onReject} />,
    );
    fireEvent.press(screen.getByTestId("approve"));
    fireEvent.press(screen.getByTestId("reject"));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("a field the run could not read shows '(was unread)', not a blank diff", () => {
    render(
      <ApprovalGate status="awaiting_approval" current={{}} proposed={{ keywords: "x,y" }} pushCommands={[]} onApprove={() => {}} onReject={() => {}} />,
    );
    expect(screen.getByText("(was unread)")).toBeTruthy();
  });
});
