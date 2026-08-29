import { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import {
  SuppressionRegionChip,
  type SuppressionRegionChipProps,
} from './SuppressionRegionChip';

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
  | { status: 'solving'; stage: CpRegionSolveStage }
  | { status: 'solved'; movedVertices: number; maxMovementPx: number }
  | { status: 'failed'; reason: string; partialMovedVertices?: number };

/** The shared no-solve-yet state, so callers need not allocate one per render. */
export const CP_REGION_SOLVE_IDLE: CpRegionSolveState = { status: 'idle' };

const STATUS_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  color: 'var(--text-secondary)',
};

/** Same reasoning as the chip's hidden count: a preset-written token, not a guess. */
const FAILED_STYLE: CSSProperties = { ...STATUS_STYLE, color: 'var(--status-danger)' };

export interface SolveRegionChipProps extends Omit<SuppressionRegionChipProps, 'children'> {
  state: CpRegionSolveState;
  /** Run (or re-run) the exact solve on this region's attachment. */
  onSolve: () => void;
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
  onAccept,
  onTryAgain,
  ...base
}: SolveRegionChipProps) {
  return (
    <SuppressionRegionChip {...base}>
      <SolveAffordance
        state={state}
        onSolve={onSolve}
        onAccept={onAccept}
        onTryAgain={onTryAgain}
      />
    </SuppressionRegionChip>
  );
}

function SolveAffordance({
  state,
  onSolve,
  onAccept,
  onTryAgain,
}: {
  state: CpRegionSolveState;
  onSolve: () => void;
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

    case 'solving':
      // Named stages, not a spinner: stage 1 fails fast and stage 2 is up to six
      // individually-accepted refinement rounds, so "still working" and "nearly
      // done" are different sentences and the wait is p50 0.4 s on an easy sample
      // and 3.5 s on a medium one.
      return (
        <span className="cp-region-chip__status" style={STATUS_STYLE} role="status">
          {state.stage === 'geometry'
            ? t('panels:cpRegion.solvingGeometry', 'Solving geometry…')
            : t('panels:cpRegion.solvingRefining', 'Refining to fold precision…')}
        </span>
      );

    case 'solved':
      return (
        <>
          <span className="cp-region-chip__status" style={STATUS_STYLE} role="status">
            {t('panels:cpRegion.solved', {
              count: state.movedVertices,
              // Rounded **up**, so the sentence stays true: a 0.42 px worst case
              // reads "< 1 px", never "< 0.4 px" that a later measurement could
              // contradict.
              max: Math.max(1, Math.ceil(state.maxMovementPx)),
              defaultValue_one: 'Solved · 1 vertex moved < {{max}} px',
              defaultValue_other: 'Solved · {{count}} vertices moved < {{max}} px',
            })}
          </span>
          <Button size="sm" variant="secondary" onClick={onTryAgain}>
            {t('panels:cpRegion.tryAgain', 'Try again')}
          </Button>
          <Button size="sm" variant="primary" onClick={onAccept}>
            {acceptLabel}
          </Button>
        </>
      );

    case 'failed':
      return (
        <>
          <span className="cp-region-chip__status" style={FAILED_STYLE} role="status">
            {t('panels:cpRegion.solveFailed', 'Could not solve — {{reason}}', {
              reason: state.reason,
            })}
          </span>
          {state.partialMovedVertices !== undefined && (
            <span className="cp-region-chip__status" style={STATUS_STYLE}>
              {t('panels:cpRegion.solvePartial', {
                count: state.partialMovedVertices,
                defaultValue_one: 'Partial result · 1 vertex',
                defaultValue_other: 'Partial result · {{count}} vertices',
              })}
            </span>
          )}
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
