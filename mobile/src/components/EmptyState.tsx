/**
 * EmptyState — a calm, honest "nothing here yet" with an optional call to action.
 * Never dresses an empty list up as data.
 */
import React from "react";
import { Centered, AppText, Button } from "./primitives.js";

export function EmptyState({
  title,
  detail,
  cta,
}: {
  title: string;
  detail?: string;
  cta?: { label: string; onPress: () => void };
}) {
  return (
    <Centered>
      <AppText kind="lead">{title}</AppText>
      {detail ? <AppText kind="dim" style={{ textAlign: "center" }}>{detail}</AppText> : null}
      {cta ? <Button label={cta.label} onPress={cta.onPress} /> : null}
    </Centered>
  );
}
