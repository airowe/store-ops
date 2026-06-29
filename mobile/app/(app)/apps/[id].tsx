/**
 * App detail — placeholder (Phase 2 builds the "money screen": rank movement,
 * trend, runs → run detail → approval gate + handoff). For now it confirms the
 * route + param wiring so the dashboard can navigate here.
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import { Centered, AppText } from "../../../src/components/primitives.js";

export default function AppDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Centered>
      <AppText kind="lead">App {id}</AppText>
      <AppText kind="dim">Detail view lands in Phase 2.</AppText>
    </Centered>
  );
}
