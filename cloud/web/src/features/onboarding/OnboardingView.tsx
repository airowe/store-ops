/**
 * OnboardingView — guided setup, the chosen direction (design 1a). Replaces the
 * old form-wall with a progressive stepper: one decision at a time, prior
 * answers stay visible as collapsed rows, and the live audit already ran inline
 * (the "Audited: A−" pill) — the hook, never behind a wall of questions.
 *
 * Presentation over the pure `onboardingModel`. The only interactive step is
 * "rivals" (add/remove chips); the rest are collapsed answers or a dimmed,
 * optional upcoming step. Honesty carries through: the grade is whatever the
 * audit returned, and the footer keeps the "nothing ships on its own" promise.
 */
import { useState } from "react";
import type { ApiClient } from "@shipaso/api";
import { ConnectAppCard } from "../connect/ConnectAppCard.js";
import {
  STEPS,
  addRival,
  chooseStore,
  setApp,
  storeLabel,
  removeRival,
  progressState,
  emptyState,
  type OnboardingState,
} from "./onboardingModel.js";

type Props = {
  /** The shared API client — steps 2 and 3 talk to the real backend. */
  client: ApiClient;
  /** The connected app's id, once step 2 completes. Null until then. */
  appId: string | null;
  /** Step 2 connected an app: hand the id up so the route can hold it. */
  onAppConnected: (id: string) => void;
  /** Continue → : setup is done, hand back the collected answers. */
  onDone: (state: OnboardingState) => void;
  /** Skip setup / Skip step → : bail to the dashboard. */
  onSkip: () => void;
  /** Seed state — defaults to the design's step-3 sample. */
  initial?: OnboardingState;
};

export function OnboardingView({ client, appId, onAppConnected, onDone, onSkip, initial }: Props) {
  const [state, setState] = useState<OnboardingState>(initial ?? emptyState());
  const segments = progressState(state.stepIndex);
  const stepNo = state.stepIndex + 1;

  return (
    <div className="onb-wrap">
      <div className="onb-card" data-testid="onboarding">
        {/* ── header ─────────────────────────────────────────────── */}
        <header className="onb-head">
          <span className="onb-logo" aria-hidden="true">✓</span>
          <b className="onb-title">Set up ShipASO</b>
          <span className="onb-step-count mono">Step {stepNo} of {STEPS.length}</span>
          <button
            type="button"
            className="onb-skip-link mono"
            data-testid="onb-skip-setup"
            onClick={onSkip}
          >
            Skip setup →
          </button>
          <div className="onb-progress">
            {segments.map((filled, i) => (
              <span
                key={STEPS[i]}
                className={"onb-seg" + (filled ? " filled" : "")}
                data-testid={`onb-seg-${STEPS[i]}`}
                data-filled={filled}
              />
            ))}
          </div>
        </header>

        <div className="onb-body">
          {/* ── completed answers (stay visible) ─────────────────── */}
          {state.store ? (
            <div className="onb-answer" data-testid="onb-answer-store">
              <span className="onb-check" aria-hidden="true">✓</span>
              <span className="onb-answer-label">Optimizing first for</span>
              <span className="onb-answer-value">{storeLabel(state.store)}</span>
              <button type="button" className="onb-edit mono">Edit</button>
            </div>
          ) : null}

          {state.app ? (
            <div className="onb-answer" data-testid="onb-answer-app">
              <span className="onb-check" aria-hidden="true">✓</span>
              <span className="onb-answer-label">Your app</span>
              <span className="onb-answer-value">{state.app.name}</span>
              <button type="button" className="onb-edit mono">Edit</button>
            </div>
          ) : null}

          {/* ── active step 1: which store ───────────────────────── */}
          {state.store === null ? (
            <section className="onb-active">
              <div className="onb-active-head">
                <span className="onb-num" aria-hidden="true">1</span>
                <h2 className="onb-question" data-testid="onb-question">Which store are you optimizing first?</h2>
              </div>
              <p className="onb-help">
                App Store is what we audit and rank today. Google Play is coming — we
                will not connect a listing we cannot measure.
              </p>
              <div className="onb-chip-area">
                <button
                  type="button"
                  className="btn primary"
                  data-testid="onb-store-app-store"
                  onClick={() => setState((s) => chooseStore(s, "app-store"))}
                >
                  App Store
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  data-testid="onb-store-google-play"
                  disabled
                >
                  Google Play · coming soon
                </button>
              </div>
            </section>
          ) : null}

          {/* ── active step 2: which app ─────────────────────────── */}
          {state.store !== null && state.app === null ? (
            <section className="onb-active">
              <div className="onb-active-head">
                <span className="onb-num" aria-hidden="true">2</span>
                <h2 className="onb-question" data-testid="onb-question">Which app?</h2>
              </div>
              <p className="onb-help">
                We audit it on live iTunes data as soon as it is connected.
              </p>
              <ConnectAppCard
                client={client}
                heading="Search the App Store"
                onConnected={(id, name) => {
                  onAppConnected(id);
                  setState((s) => setApp(s, { name }));
                }}
              />
            </section>
          ) : null}

          {/* ── active step 3: rivals ────────────────────────────── */}
          {state.app !== null ? (
          <section className="onb-active">
            <div className="onb-active-head">
              <span className="onb-num" aria-hidden="true">{stepNo}</span>
              <h2 className="onb-question" data-testid="onb-question">Who are your top rivals?</h2>
            </div>
            <p className="onb-help">
              Only confirmed rivals feed your runs. We suggested a few from your keywords —
              add or remove any.
            </p>

            <div className="onb-chip-area">
              <div className="onb-chips" data-testid="onb-rivals">
                {state.rivals.map((r) => (
                  <span key={r} className="onb-chip confirmed" data-testid={`onb-rival-${r}`}>
                    {r}
                    <button
                      type="button"
                      className="onb-chip-x"
                      aria-label={`Remove ${r}`}
                      onClick={() => setState((s) => removeRival(s, r))}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button type="button" className="onb-chip add">+ Add rival</button>
              </div>

              {state.suggested.length ? (
                <>
                  <div className="onb-suggest-label mono">Suggested from your keywords</div>
                  <div className="onb-chips">
                    {state.suggested.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="onb-chip suggest"
                        data-testid={`onb-suggest-${s}`}
                        onClick={() => setState((prev) => addRival(prev, s))}
                      >
                        + {s}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </section>
          ) : null}

          {/* ── upcoming step (dimmed, optional) ─────────────────── */}
          <div className="onb-upcoming" data-testid="onb-upcoming">
            <span className="onb-num muted" aria-hidden="true">{STEPS.length}</span>
            <span className="onb-answer-label">Connect a key to push</span>
            <span className="onb-upcoming-note mono">optional · read-only until you do</span>
          </div>

          {/* ── footer ───────────────────────────────────────────── */}
          <footer className="onb-foot">
            <span className="onb-promise">You approve every change. Nothing ships on its own.</span>
            <button
              type="button"
              className="btn ghost"
              data-testid="onb-skip-step"
              onClick={onSkip}
            >
              Skip
            </button>
            <button
              type="button"
              className="btn primary onb-continue"
              data-testid="onb-continue"
              onClick={() => onDone(state)}
            >
              Continue →
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
