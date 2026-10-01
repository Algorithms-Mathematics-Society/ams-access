import type { StageStatus } from "../support";

/** A distinct object identifies each visit, including a retry of the same step. */
export type StageAdvanceRun = Readonly<{ stage: number }>;

type Timer = ReturnType<typeof setTimeout>;
type AdvanceOptions = {
  finalStage: number;
  onBegin(stage: number, status: StageStatus): void;
  onAdvance(nextStage: number): void;
  onFinalize(): void;
  clock?: {
    setTimeout(callback: () => void, delay: number): Timer;
    clearTimeout(timer: Timer): void;
  };
};

/** Coordinate the existing transition; this never evaluates or bypasses a check.
 * Child checks retain their pass/warn decisions. Late callbacks may only act on
 * the committed visit that created them, and each visit can advance once.
 */
export function createStageAdvanceController(options: AdvanceOptions) {
  // Browser timer methods require the global receiver; calling a copied native
  // function as clock.setTimeout would bind this to the clock object instead.
  const clock = options.clock ?? {
    setTimeout: (callback: () => void, delay: number) => globalThis.setTimeout(callback, delay),
    clearTimeout: (handle: Timer) => globalThis.clearTimeout(handle),
  };
  let active: StageAdvanceRun | null = null;
  let timer: Timer | null = null;
  let transitioning = false;

  function cancelTimer() {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  }

  return {
    activate(run: StageAdvanceRun) {
      cancelTimer();
      active = run;
      transitioning = false;
    },
    deactivate(run: StageAdvanceRun) {
      if (active !== run) return;
      active = null;
      transitioning = false;
      cancelTimer();
    },
    advance(run: StageAdvanceRun, status: StageStatus = "pass") {
      if (active !== run || transitioning) return false;
      // Lock synchronously, before React commits the presentation state.
      transitioning = true;
      options.onBegin(run.stage, status);
      timer = clock.setTimeout(() => {
        if (active !== run || !transitioning) return;
        timer = null;
        // Invalidate this visit before scheduling React's next render. An old
        // callback cannot race that commit and advance the following step.
        active = null;
        transitioning = false;
        const nextStage = run.stage + 1;
        options.onAdvance(nextStage);
        if (nextStage >= options.finalStage) options.onFinalize();
      }, 300);
      return true;
    },
  };
}
