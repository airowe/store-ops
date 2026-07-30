/**
 * Mobile guided setup — the full-bleed stepper (Mobile Onboarding.dc.html). One
 * decision per screen, prior answers pinned as chips, the honest footer on every
 * step. Presentation over the pure `model`; `onDone`/`onSkip` hand control back
 * to the router so this stays testable without navigation.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { Screen, AppText, Button } from "../components/primitives.js";
import { usePalette, spacing } from "../theme/index.js";
import { OnboardingProgress } from "./OnboardingProgress.js";
import { StoreStep } from "./StoreStep.js";
import { RivalsStep } from "./RivalsStep.js";
import {
  STEPS,
  addRival,
  chooseStore,
  initialState,
  removeRival,
  type OnboardingState,
  type Store,
} from "./model.js";

const PROMISE = "You approve every change. Nothing ships on its own.";

export function OnboardingScreen({
  onDone,
  onSkip,
  initial,
}: {
  onDone: (state: OnboardingState) => void;
  onSkip: () => void;
  initial?: OnboardingState;
}) {
  const palette = usePalette();
  const [state, setState] = useState<OnboardingState>(initial ?? initialState());
  const step = STEPS[state.stepIndex];

  const goBack = () =>
    setState((s) => ({ ...s, stepIndex: Math.max(0, s.stepIndex - 1) }));

  return (
    <Screen>
      <OnboardingProgress
        stepIndex={state.stepIndex}
        onSkip={onSkip}
        {...(state.stepIndex > 0 ? { onBack: goBack } : {})}
      />

      {step === "store" ? (
        <StoreStep onChoose={(s: Store) => setState((prev) => chooseStore(prev, s))} />
      ) : (
        <RivalsStep
          state={state}
          onAdd={(r) => setState((prev) => addRival(prev, r))}
          onRemove={(r) => setState((prev) => removeRival(prev, r))}
        />
      )}

      <View style={{ flex: 1, minHeight: spacing.xl }} />

      {step !== "store" ? (
        <Button label="Continue →" testID="onb-continue" onPress={() => onDone(state)} />
      ) : null}
      <AppText kind="micro" testID="onb-promise" style={{ textAlign: "center", color: palette.faint }}>
        {PROMISE}
      </AppText>
    </Screen>
  );
}
