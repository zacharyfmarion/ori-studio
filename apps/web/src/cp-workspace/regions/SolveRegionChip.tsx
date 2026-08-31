import { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import {
  SuppressionRegionChip,
  type SuppressionRegionChipProps,
} from './SuppressionRegionChip';
import { cpSolveIsExactVerdict, type CpSolveCompletionFacts } from './solveCompletion';

/**
 * A suppression region that also carries an attached `ExactSolveInput`, and so
 * can be handed back to the solver.
 *
 * It **renders the base chip and appends** to it. Two components rather than one
 * with a flag: the base is what the rail tool makes and must never grow a Solve
 * button, while everything below — a two-stage wait, a rejection vocabulary, a
 * partial result, an accept/revert gate — belongs only to the detection case.
 * Merging them would put that state machine inside a component whose job is a
 * label and four checkboxes, and the flag would then have to be read at every
 * branch to prove the rail tool's box could not reach it.
 *
 * The discriminator is the **attachment's presence**, decided by the caller from
 * `hasAttachedSolveInput` — never a geometric "does this box contain a solvable
 * pattern" test, which runs continuously and can flicker mid-edit, exactly when
 * it must not.
 *
 * Like everything else on the bar, the solve affordance shows whether or not the
 * region is selected. It is the primary thing to do with a freshly detected
 * candidate, and — for the post-solve gate especially — a result waiting to be
 * accepted must not be able to sit unseen behind a selection the user has moved
 * on from.
 */

/** Which half of the solve is running. Both are named; neither is a spinner. */
export type CpRegionSolveStage = 'geometry' | 'refining';

/**
 * Where a region's solve has got to.
 *
 * Modelled as data the host owns rather than state held here, because the solve
 * outlives the chip: it is a command with a menu entry, its result is a document
 * mutation, and reverting it is an undo. This component is the readout and the
 * two buttons.
 *
 * `failed` covers both refusal and timeout. It carries a `reason` the caller has
 * already translated — the solver's vocabulary is nine `rejection_reasons` tokens
 * plus a timeout string, and a malformed input returns no `rejection_reasons` key
 * at all, so mapping that to a sentence is the caller's job and not a `switch`
 * here. `partialMovedVertices` is the timeout case's partial solution, which is
 * worth offering: "the solver got this far — accept, or keep editing."
 */
export type CpRegionSolveState =
  | { status: 'idle' }
  | {
      status: 'solving';
      stage: CpRegionSolveStage;
      /**
       * Whether this run can actually be stopped — read from the run registry,
       * never assumed. False renders no Stop at all rather than a disabled one,
       * the same rule that gives a region without a solve binding the base chip:
       * a control that does nothing is worse than an absent one.
       */
      cancellable: boolean;
      /** A stop is already on its way. Near-instant, so rarely seen; see below. */
      stopping: boolean;
    }
  /**
   * The solver accepted an answer and it has been written onto the creases.
   *
   * `status: 'solved'` is the **transport** state — coordinates landed, and there
   * is a gate to clear — not a claim that the pattern is done. What it completed
   * *to* is `completion`, and only `exact` may be presented as success: an
   * accepted-but-ambiguous solve is a real improvement (14.367° -> 0.00747° on
   * the file this split came from) that still fails every foldability check it
   * failed before.
   */
  | ({
      status: 'solved';
      movedVertices: number;
      maxMovementPx: number;
    } & CpSolveCompletionFacts)
  | { status: 'failed'; reason: string; partialMovedVertices?: number };

/** The shared no-solve-yet state, so callers need not allocate one per render. */
export const CP_REGION_SOLVE_IDLE: CpRegionSolveState = { status: 'idle' };

/**
 * The running-solve indicator: a spinner, not a sentence.
 *
 * Every other thing this component had to say now goes to a toast, which has
 * room for it — but "a solve is running" is the one state a toast cannot carry,
 * because it is not an event, it is a condition that lasts up to 25 s. It also
 * cannot be left to the Stop button: `cancellable: false` renders no Stop, and
 * without this the chip would then be indistinguishable from idle for the whole
 * wait.
 *
 * So it stays, as the smallest thing that is not prose. The stage it is in is
 * the element's accessible name and its tooltip rather than text on the bar —
 * "Solving geometry…" and "Refining to fold precision…" are worth having, and
 * are not worth 140 px of a 200 px bar.
 *
 * The rotation is `.cp-panel__spinner`, which already exists in `theme.css` with
 * its keyframe; only the layout is inline, like the rest of this stage.
 */
const SPINNER_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  flex: '0 0 auto',
  color: 'var(--text-secondary)',
};

export interface SolveRegionChipProps extends Omit<SuppressionRegionChipProps, 'children'> {
  state: CpRegionSolveState;
  /** Run (or re-run) the exact solve on this region's attachment. */
  onSolve: () => void;
  /**
   * Stop the running solve. Nothing lands: the solve is abandoned before it can
   * write, so there is no revert and the region stays exactly as it was.
   */
  onStop: () => void;
  /** Keep the solved coordinates: the region goes away, checking comes back. */
  onAccept: () => void;
  /**
   * Put the pre-solve coordinates back with the region still in repair state, so
   * the topology can be changed and solved again. Offered only after a *success* —
   * a refusal leaves the document untouched, so there is nothing to revert.
   */
  onTryAgain: () => void;
}

export function SolveRegionChip({
  state,
  onSolve,
  onStop,
  onAccept,
  onTryAgain,
  ...base
}: SolveRegionChipProps) {
  return (
    <SuppressionRegionChip {...base}>
      <SolveAffordance
        state={state}
        onSolve={onSolve}
        onStop={onStop}
        onAccept={onAccept}
        onTryAgain={onTryAgain}
      />
    </SuppressionRegionChip>
  );
}

function SolveAffordance({
  state,
  onSolve,
  onStop,
  onAccept,
  onTryAgain,
}: {
  state: CpRegionSolveState;
  onSolve: () => void;
  onStop: () => void;
  onAccept: () => void;
  onTryAgain: () => void;
}) {
  const { t } = useTranslation();
  const solveLabel = t('panels:cpRegion.solve', 'Solve');
  const acceptLabel = t('panels:cpRegion.accept', 'Accept');

  switch (state.status) {
    case 'idle':
      return (
        <Button size="sm" variant="secondary" onClick={onSolve}>
          {solveLabel}
        </Button>
      );

    case 'solving': {
      // The stage is still named — stage 1 fails fast and stage 2 is up to six
      // individually-accepted refinement rounds, so "still working" and "nearly
      // done" really are different states — but it is named in the accessible
      // name, not in 140 px of bar.
      const stage =
        state.stage === 'geometry'
          ? t('panels:cpRegion.solvingGeometry', 'Solving geometry…')
          : t('panels:cpRegion.solvingRefining', 'Refining to fold precision…');
      return (
        <>
          <span
            className="cp-region-chip__spinner cp-panel__spinner"
            style={SPINNER_STYLE}
            role="status"
            aria-label={stage}
            title={stage}
          >
            <Loader2 size={13} aria-hidden="true" />
          </span>
          {/* The wait this is for is the long one: a hard pattern spends the
              whole 25 s budget, and the measurement behind the mechanism
              (`cpExactSolveSession.ts`) is why Stop is immediate there rather
              than seconds late. `stopping` is a real transition and not
              decoration, but terminating settles the call in the same turn, so
              it is normally too brief to see. */}
          {state.cancellable && (
            <Button size="sm" variant="secondary" onClick={onStop} disabled={state.stopping}>
              {state.stopping
                ? t('panels:cpRegion.stopping', 'Stopping…')
                : t('panels:cpRegion.stop', 'Stop')}
            </Button>
          )}
        </>
      );
    }

    case 'solved': {
      // Whether the *solver* called the answer exact is what decides which button
      // is primary. The tone this used to carry as well now belongs to the toast,
      // which is where the sentence went.
      const exact = cpSolveIsExactVerdict(state.completion);
      return (
        <>
          <Button size="sm" variant={exact ? 'secondary' : 'primary'} onClick={onTryAgain}>
            {t('panels:cpRegion.tryAgain', 'Try again')}
          </Button>
          {/* Still offered, and still the same verb: the coordinates really are
              better, so keeping them is a legitimate choice. What changes is that
              it stops being the recommended one and stops being called a plain
              Accept, which over an unfoldable pattern reads as "this is done". */}
          <Button size="sm" variant={exact ? 'primary' : 'secondary'} onClick={onAccept}>
            {exact ? acceptLabel : t('panels:cpRegion.acceptAnyway', 'Accept anyway')}
          </Button>
        </>
      );
    }

    case 'failed':
      // The reason is the toast's, and only the toast's — it is a sentence, and
      // `useCpRegionSolve` raises one for every ending that reaches this state.
      return (
        <>
          {/* Retry, not "Try again": the document is unchanged on every
              non-acceptance — the solver hands back the input coordinates — so
              there is nothing to revert, and offering a revert would imply the
              failed attempt had landed. */}
          <Button size="sm" variant="secondary" onClick={onSolve}>
            {solveLabel}
          </Button>
          {state.partialMovedVertices !== undefined && (
            <Button size="sm" variant="primary" onClick={onAccept}>
              {acceptLabel}
            </Button>
          )}
        </>
      );
  }
}
