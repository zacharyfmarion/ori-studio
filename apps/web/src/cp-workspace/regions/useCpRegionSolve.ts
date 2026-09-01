/**
 * The one exact-solve implementation, and the binding both entry points reach it
 * through.
 *
 * `CpRegionSolveBinding` is four verbs (`stateFor` / `onSolve` / `onAccept` /
 * `onTryAgain`) and the chip has wanted them since it was written; what was
 * missing was anything that could service them. This is that — and it is a hook
 * beside the concern rather than state in `CreasePatternPanel`, because the panel
 * is a composition site: it chooses that a solve binding is mounted, not what one
 * does.
 *
 * **Two entry points, one implementation.** The chip's Solve button calls
 * {@link CpRegionSolveBinding.onSolve} directly; `Crease Pattern ▸ Repair ▸
 * Exact Solve…` dispatches `CP_EXACT_SOLVE_REQUEST_EVENT`, which the effect below
 * listens for, resolves to a region, and hands to the *same* function. The menu
 * route keeps its keyboard shortcut, its command-palette entry and its `command
 * invoked` event at the `handleMenuAction` chokepoint; the button route does not
 * need them, because it is already pointing at the thing it acts on. What neither
 * gets is a second copy of the solve.
 *
 * **What survives, and for how long.** A solve's *outcome* is held here rather
 * than written onto the region, because it describes a moment: it is true of one
 * document revision and of no other. `oristudioCpRevision` is therefore part of
 * every record and `stateFor` drops one that no longer matches — so an undo
 * across the solve returns the chip to Solve rather than leaving "Solved · 45
 * vertices moved" standing over the coordinates that solve produced and undo took
 * away. The *live* half comes from `cpExactSolveRuns` instead, which is where the
 * two stages are already recorded.
 */
import { toast } from 'sonner';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { CP_EXACT_SOLVE_REQUEST_EVENT } from '../../commands/menuActions';
import { runCpExactSolve, type CpExactSolveRunOptions } from '../../engine/cpExactSolve';
import {
  cpExactSolveRunFor,
  cpExactSolveRunsSnapshot,
  isCpExactSolveBusyError,
  requestCpExactSolveStop,
  subscribeCpExactSolveRuns,
  type CpExactSolveRunKind,
} from '../../engine/cpExactSolveRuns';
import { isCpExactSolveCancelledError } from '../../engine/cpExactSolveSession';
import { cpExactSolveReasonLabel } from '../../engine/cpExactSolveMessages';
import {
  isCpExactSolveAccepted,
  primaryCpExactSolveReason,
  type CpExactSolveMovedVertex,
  type CpExactSolveOutcome,
} from '../../engine/cpExactSolveTypes';
import {
  cpSolveCompletionDetail,
  cpSolveCompletionFacts,
  cpSolveCompletionHeadline,
  cpSolveIsExactVerdict,
  cpSolveMeetsFoldabilityCheck,
  cpSolveMovementSentence,
  type CpSolveCompletionFacts,
  type CpSolveMovement,
} from './solveCompletion';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import { isSuppressionRegionAnnotation } from '../annotations/annotation';
import {
  hasAttachedSolveInput,
  type CpSuppressionRegion,
} from '../annotations/suppressionRegion';
import type { CpRegionSolveBinding } from './CpRegionLayer';
import type { CpRegionSolveState } from './SolveRegionChip';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import {
  CpExactSolveInputRebuildError,
  rebuildCpExactSolveInput,
} from '../../engine/cpExactSolveInputRebuild';
import { exportOristudioCpCreasesAsFold } from '../../store/workspaceStore/oristudioCpRuntime';
import type { CpSolveFrameTransform } from '../../engine/cpExactSolveTypes';
import {
  cpRegionPatternLines,
  foldEdgesVertices,
  partialVertexPositions,
  solvedRegionSegments,
  solvedVertexPositions,
  type CpSolvedVertexPositions,
  type CpRegionPatternLines,
  type CpRegionSolvePlacementRefusal,
} from './regionSolveGeometry';

/**
 * The wall-clock budget for a region solve, in seconds, spent across **both**
 * stages.
 *
 * A number rather than nothing, and a number rather than the solver's own
 * default. Two `cp_detect_solve_exact` calls are two independent deadlines, so
 * passing no total would give the staged flow up to 2x the fused path's cap and
 * quietly invalidate every measurement in `crease-topology-repair.md`, which was
 * taken against 25 s.
 *
 * It is spelled here rather than read from the candidate because the recognize
 * path's published `compiler_report.solve.budget.total_seconds` belongs to *that
 * decode*, and a region re-solve happens long after — possibly in a session that
 * opened the `.osf` and never ran a detection. The modal's automatic solve passes
 * the published number; a region solve has none to pass.
 */
export const CP_REGION_SOLVE_BUDGET_SECONDS = 25;

/**
 * The paper edge in pixels, for the chip's "moved < N px".
 *
 * The solver measures movement in unit-square units, where the paper edge is
 * 1.0. The user's mental image is the rectified source image the candidate was
 * read out of, whose paper is 1024 px across — so that is the ruler the sentence
 * uses. It is not the document's own units, which are a kernel storage scale
 * nobody sees.
 */
const PAPER_EDGE_PX = 1024;

/** What a solve left behind, and the revision it was true of. */
interface CpRegionSolveRecord {
  state: CpRegionSolveState;
  /** `oristudioCpRevision` this describes. A later one means the user moved on. */
  revision: number;
  /** The creases as they stood before the solve — what Try again puts back. */
  owned: CpRegionPatternLines;
  /** How to put an answer back on those creases. Null when no solve reached one. */
  frame: CpRegionSolveFrame | null;
  /** A timed-out solve's partial answer, which Accept can still take. */
  partial: readonly CpExactSolveMovedVertex[] | null;
}

/**
 * What is needed to place a solved answer: the graph the solver numbered its
 * vertices in, and the transform out of its unit square.
 *
 * Held rather than re-derived because Accept can write a timed-out solve's
 * partial answer long after the solve, and it has to land in the same frame the
 * solve was computed in.
 */
interface CpRegionSolveFrame {
  /** `edges_vertices` of the FOLD the input was rebuilt from, in segment order. */
  edgesVertices: readonly (readonly [number, number])[];
  transform: CpSolveFrameTransform;
}

const NO_RECORDS: ReadonlyMap<string, CpRegionSolveRecord> = new Map();

/** How a solve is actually run. Injected in tests; the real one by default. */
export type CpRegionSolveRunner = typeof runCpExactSolve;

export interface UseCpRegionSolveOptions {
  /** Overridden in tests, which have neither a worker nor a 43 MiB model. */
  solve?: CpRegionSolveRunner;
}

export function useCpRegionSolve(options: UseCpRegionSolveOptions = {}): CpRegionSolveBinding {
  const { t } = useTranslation();
  const [records, setRecords] = useState(NO_RECORDS);
  const revision = useWorkspaceStore((state) => state.oristudioCpRevision);
  const runs = useSyncExternalStore(subscribeCpExactSolveRuns, cpExactSolveRunsSnapshot);

  // Everything the async body reads, through one ref, so `solveRegion` keeps a
  // stable identity: it is the window listener's dependency below, and
  // re-subscribing on every re-render would be listener churn nobody asked for.
  // Written in an effect rather than during render, as `useVertexSolve` does —
  // every reader runs later (a click, a menu event, an async response), so there
  // is nothing to miss.
  const latest = useRef({ t, solve: options.solve ?? runCpExactSolve });
  useEffect(() => {
    latest.current = { t, solve: options.solve ?? runCpExactSolve };
  });

  const write = useCallback((regionId: string, record: CpRegionSolveRecord | null) => {
    setRecords((current) => {
      if (!record && !current.has(regionId)) return current;
      const next = new Map(current);
      if (record) next.set(regionId, record);
      else next.delete(regionId);
      return next;
    });
  }, []);

  const solveRegion = useCallback(
    async (regionId: string, kind: CpExactSolveRunKind) => {
      const region = solvableRegion(regionId);
      if (!region) return;
      const owned = ownedLines(region);
      // The chip holds the detail; the toast is the "it finished" signal, because
      // a solve can take seconds and the user is looking at the creases, not at
      // a bar above them. Every terminal outcome gets exactly one.
      const failed = (reason: string) => {
        write(regionId, {
          state: { status: 'failed', reason },
          revision: useWorkspaceStore.getState().oristudioCpRevision,
          owned,
          frame: null,
          partial: null,
        });
        toast.error(
          latest.current.t('toasts:cpRegionSolve.failed', 'Could not solve this pattern'),
          { id: `cp-region-solve-${regionId}`, description: reason }
        );
      };
      if (owned.lineIds.length === 0) {
        failed(placementRefusalLabel(latest.current.t, 'no_pattern'));
        return;
      }

      // Solve **what is on screen**, not what detection attached at import.
      //
      // The region carries an `ExactSolveInput` published by the decode, and for
      // as long as that was what got solved, every repair made afterwards was
      // invisible to the solver: a merged degree-2 vertex, two corners joined, a
      // crease recoloured from valley to auxiliary. It then reported blockers
      // about vertices that were no longer there, which is what all three of
      // "it says 3 errors but I fixed them" were. So the creases are exported to
      // FOLD and the compiler rebuilds the input from that.
      //
      // `region.solveInput` is still what makes a region *solvable*
      // (`hasAttachedSolveInput`), and still what the file carries — it says this
      // region came from a detection. It is no longer what gets solved.
      let outcome: CpExactSolveOutcome;
      let frame: CpRegionSolveFrame;
      try {
        const creasePattern =
          useWorkspaceStore.getState().oristudioCpDocument?.document.crease_pattern;
        if (!creasePattern) {
          failed(placementRefusalLabel(latest.current.t, 'no_pattern'));
          return;
        }
        const foldJson = await exportOristudioCpCreasesAsFold(creasePattern, owned.segments);
        const edgesVertices = foldEdgesVertices(foldJson);
        if (!edgesVertices) {
          failed(placementRefusalLabel(latest.current.t, 'graph_mismatch'));
          return;
        }
        const rebuilt = await rebuildCpExactSolveInput(foldJson);
        frame = { edgesVertices, transform: rebuilt.transform };
        const run = await latest.current.solve(rebuilt.input, {
          timeoutSeconds: CP_REGION_SOLVE_BUDGET_SECONDS,
          run: { kind, targetId: regionId },
        } satisfies CpExactSolveRunOptions);
        outcome = run.outcome;
      } catch (error) {
        // The compiler refused the geometry — non-square paper, a boundary that
        // is not a closed quadrilateral. Its own words name the pattern rather
        // than the failure, so they are shown as-is.
        if (error instanceof CpExactSolveInputRebuildError) {
          failed(error.reason);
          return;
        }
        // A second press while the first solve is still running. The chip does
        // not offer Solve then — `stateFor` reports the live run — so this is the
        // race between two presses, and it is refused before the worker is
        // touched. Saying nothing is the honest response to a press that cost
        // nothing and changed nothing.
        if (isCpExactSolveBusyError(error)) return;
        // Stop was pressed. The chip goes back to Solve, and the record is
        // *cleared* rather than left showing whatever the previous attempt said:
        // nothing was written — the solve is abandoned before `place` — so idle
        // is the true state, and a stale "Could not solve" over it would be a
        // verdict on a run that never reached one.
        if (isCpExactSolveCancelledError(error)) {
          write(regionId, null);
          return;
        }
        failed(bridgeFailureLabel(latest.current.t, error));
        return;
      }

      if (outcome.kind === 'timeout') {
        write(regionId, {
          state: {
            status: 'failed',
            reason: cpExactSolveReasonLabel(latest.current.t, 'timeout'),
            partialMovedVertices: outcome.partialMovedVertices.length,
          },
          revision: useWorkspaceStore.getState().oristudioCpRevision,
          owned,
          frame,
          // Held rather than applied: on every non-acceptance the solver returns
          // the coordinates it was given, so the document is unchanged and the
          // partial is an *offer*. Accept is what takes it.
          partial: outcome.partialMovedVertices,
        });
        toast.warning(
          latest.current.t('toasts:cpRegionSolve.timedOut', 'The solve ran out of time'),
          {
            id: `cp-region-solve-${regionId}`,
            // The count is here rather than on the chip because the chip no
            // longer carries prose, and it is the figure that decides whether
            // the partial is worth accepting at all.
            description: latest.current.t('toasts:cpRegionSolve.timedOutDetail', {
              count: outcome.partialMovedVertices.length,
              defaultValue_one:
                'It had placed 1 vertex — accept how far it got, or keep editing and try again.',
              defaultValue_other:
                'It had placed {{count}} vertices — accept how far it got, or keep editing and try again.',
            }),
          }
        );
        return;
      }
      // Acceptance, not exactness. `ambiguous` is an accepted answer whose
      // coordinates are real and better, so it takes this path and *not* the
      // failure one — what differs is every sentence said about it below.
      if (!isCpExactSolveAccepted(outcome)) {
        const reason = primaryCpExactSolveReason(outcome);
        failed(
          reason
            ? cpExactSolveReasonLabel(latest.current.t, reason)
            : cpExactSolveReasonLabel(latest.current.t, 'malformed_input')
        );
        return;
      }

      // `verticesExact`, not `movedVertices` — see `regionSolveGeometry`. The
      // report omits vertices the solver finishes after taking its movement
      // comparison, and those came back as angle violations on a pattern it had
      // just called foldable.
      const placed = await place(
        owned,
        solvedVertexPositions(outcome.verticesExact),
        frame,
        solveLabel(latest.current.t)
      );
      if (!placed.ok) {
        failed(placementRefusalLabel(latest.current.t, placed.refusal));
        return;
      }
      const facts = cpSolveCompletionFacts(outcome);
      const movement = {
        movedVertices: outcome.movedVertices.length,
        maxMovementPx: outcome.maxMovement * PAPER_EDGE_PX,
      };
      write(regionId, {
        state: { status: 'solved', ...movement, ...facts },
        revision: useWorkspaceStore.getState().oristudioCpRevision,
        owned,
        frame,
        partial: null,
      });
      completionToast(latest.current.t, regionId, facts, movement);
    },
    [write]
  );

  // `Crease Pattern ▸ Repair ▸ Exact Solve…`. A window event rather than a store
  // method for the same reason `file.detectCpImage` is one: what it drives is a
  // surface, not document state the dispatcher could call into.
  useEffect(() => {
    const onRequest = () => {
      const target = commandTargetRegion();
      // The menu entry is disabled with the solver's own reason when there is
      // nothing to point at, but `deps.capabilities` is optional on the action
      // handler, so the listener refuses rather than assuming it was checked.
      if (target) void solveRegion(target.id, 'command');
    };
    window.addEventListener(CP_EXACT_SOLVE_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(CP_EXACT_SOLVE_REQUEST_EVENT, onRequest);
  }, [solveRegion]);

  const onSolve = useCallback(
    (regionId: string) => void solveRegion(regionId, 'region'),
    [solveRegion]
  );

  /**
   * Stop this region's solve.
   *
   * Reads the live run rather than holding a handle: the registry is the single
   * record of what is running and how it can be stopped, and a second copy here
   * could disagree with the `cancellable` the chip rendered its button from.
   * The rejection that follows is handled in `solveRegion` above — this call
   * writes no state of its own.
   */
  const onStop = useCallback((regionId: string) => {
    const run = cpExactSolveRunFor(regionId);
    if (run) requestCpExactSolveStop(run.runId);
  }, []);

  /**
   * Keep the result: the region goes away and full checking comes back.
   *
   * **The source image stays, unlocked.** It is still the best thing to compare
   * the solved pattern against, and it is the user's own annotation by then —
   * see {@link removeRegionAndItsImage} for why the underlay goes with it.
   */
  const onAccept = useCallback(
    async (regionId: string) => {
      const record = currentRecord(records, regionId, revision);
      // A timed-out solve applied nothing, so accepting it is where its partial
      // answer is written — and it is written *first*, so that undoing the accept
      // walks back through the coordinates rather than past them.
      if (record?.partial && record.partial.length > 0 && record.frame) {
        const placed = await place(
          record.owned,
          partialVertexPositions(record.partial),
          record.frame,
          partialLabel(latest.current.t)
        );
        if (!placed.ok) {
          // Toasted like every other refusal. It used to be the one ending whose
          // only surface was the chip's own sentence, which meant that once the
          // chip stopped carrying prose it would have failed in silence.
          const reason = placementRefusalLabel(latest.current.t, placed.refusal);
          write(regionId, { ...record, state: { status: 'failed', reason }, partial: null });
          toast.error(
            latest.current.t('toasts:cpRegionSolve.failed', 'Could not solve this pattern'),
            { id: `cp-region-solve-${regionId}`, description: reason }
          );
          return;
        }
      }
      write(regionId, null);
      removeRegionAndItsImage(regionId, acceptLabel(latest.current.t));
    },
    [records, revision, write]
  );

  /**
   * Put the pre-solve coordinates back, with the region still in repair state.
   *
   * Its own history entry rather than an `undo()`: the user may have done
   * something else since, and a button that quietly pops whatever is on top of
   * the stack is not the button this is.
   */
  const onTryAgain = useCallback(
    async (regionId: string) => {
      const record = currentRecord(records, regionId, revision);
      write(regionId, null);
      if (!record || record.owned.lineIds.length === 0) return;
      await writeRegionSegments(
        record.owned.lineIds,
        record.owned.segments,
        tryAgainLabel(latest.current.t)
      );
    },
    [records, revision, write]
  );

  const stateFor = useCallback(
    (regionId: string): CpRegionSolveState | undefined => {
      const run = runs.find((candidate) => candidate.targetId === regionId);
      if (run) {
        return {
          status: 'solving',
          // The registry names the solver's stages; the chip names the waits.
          stage: run.stage === 'refinement' ? 'refining' : 'geometry',
          // Passed through, never assumed: the chip must not offer Stop for a
          // run nothing can reach.
          cancellable: run.cancellable,
          stopping: run.stopping,
        };
      }
      return currentRecord(records, regionId, revision)?.state;
    },
    [records, revision, runs]
  );

  return useMemo(
    () => ({
      stateFor,
      onSolve,
      onStop,
      onAccept: (regionId: string) => void onAccept(regionId),
      onTryAgain: (regionId: string) => void onTryAgain(regionId),
    }),
    [onAccept, onSolve, onStop, onTryAgain, stateFor]
  );
}

/**
 * The record for this region, or undefined once the document has moved past it.
 *
 * The revision check is what makes an undo across a solve honest. Undo restores
 * the pre-solve document *and* the pre-solve annotations from one history entry,
 * but it cannot restore state held outside both — so the state says which
 * revision it was true of and stops answering when that is no longer now.
 */
function currentRecord(
  records: ReadonlyMap<string, CpRegionSolveRecord>,
  regionId: string,
  revision: number
): CpRegionSolveRecord | undefined {
  const record = records.get(regionId);
  return record && record.revision === revision ? record : undefined;
}

/**
 * Write solved coordinates onto the region's creases, as **one** history entry.
 *
 * `replaceOristudioCpLineSegments` captures the previous document *and* the
 * current annotation layer in a single entry, so one undo takes the coordinates
 * and the region's state back together. Nothing here may record a second entry
 * around it, or an undo lands the user on unsolved coordinates with checking
 * already restored — which is silent, and wrong in the dangerous direction.
 */
async function place(
  owned: CpRegionPatternLines,
  positions: CpSolvedVertexPositions,
  frame: CpRegionSolveFrame,
  label: string
): Promise<{ ok: true } | { ok: false; refusal: CpRegionSolvePlacementRefusal }> {
  const placement = solvedRegionSegments(
    owned.segments,
    positions,
    frame.edgesVertices,
    frame.transform
  );
  if (!placement.ok) return placement;
  await writeRegionSegments(owned.lineIds, placement.segments, label);
  return { ok: true };
}

/**
 * Rewrite a region's creases, leaving nothing selected.
 *
 * Shared by every path that writes the whole pattern back — the solve, and Try
 * again putting the pre-solve coordinates back — because the selection clear is
 * not incidental to one of them. `applyOristudioCpLineMutation` derives the
 * selection from the document the kernel hands back
 * (`projectSlice.ts:789`), and a replace marks what it replaced. That is right
 * for a transform the user aimed at a selection, and wrong here: these rewrite
 * *every* crease in the pattern, so the user is handed all ~200 of them
 * selected and the selection toolbar opens on top of the region's own chip.
 * Nothing was aimed at, so nothing should be selected.
 *
 * Try again used to call `replaceOristudioCpLineSegments` directly and so kept
 * the highlight, which is what this being one function now prevents.
 */
async function writeRegionSegments(
  lineIds: number[],
  segments: OristudioCpLineSegment[],
  label: string
): Promise<void> {
  const store = useWorkspaceStore.getState();
  await store.replaceOristudioCpLineSegments(lineIds, segments, label);
  store.setOristudioCpSelection(emptyOristudioCpSelection());
}

function solvableRegion(regionId: string): CpSuppressionRegion | null {
  const found = useWorkspaceStore
    .getState()
    .oristudioCpAnnotations.find((annotation) => annotation.id === regionId);
  if (!found || !isSuppressionRegionAnnotation(found) || !hasAttachedSolveInput(found)) return null;
  return found;
}

function ownedLines(region: CpSuppressionRegion): CpRegionPatternLines {
  const segments =
    useWorkspaceStore.getState().oristudioCpDocument?.document.crease_pattern.line_segments;
  return cpRegionPatternLines(segments, region);
}

/**
 * Which region the menu command means.
 *
 * The same rule `cp.exactSolve`'s capability is gated on: scope is a *pattern*,
 * and the selection is **disambiguation, not extent**. One solvable pattern and
 * the selection is not consulted at all — requiring one there would be asking the
 * user to state the only answer. More than one, and the selected crease says
 * which; with none selected the menu entry is already disabled, so this returns
 * null rather than guessing.
 */
function commandTargetRegion(): CpSuppressionRegion | null {
  const state = useWorkspaceStore.getState();
  const regions = state.oristudioCpAnnotations
    .filter(isSuppressionRegionAnnotation)
    .filter(hasAttachedSolveInput);
  if (regions.length === 0) return null;
  if (regions.length === 1) return regions[0];

  const segments = state.oristudioCpDocument?.document.crease_pattern.line_segments ?? [];
  // Topmost first, matching `annotationAtModelPoint`, so the region a click would
  // select is the region a click disambiguates to.
  const ordered = [...regions].sort((a, b) => b.z - a.z);
  for (const lineId of state.oristudioCpSelection.lines) {
    const segment = segments[lineId - 1];
    if (!segment) continue;
    const owner = ordered.find((region) => {
      const { lineIds } = cpRegionPatternLines([segment], region);
      return lineIds.length > 0;
    });
    if (owner) return owner;
  }
  return null;
}

/**
 * Delete the region **and** the reference image it owned.
 *
 * The image is scaffolding. It is imported by the repair flow, locked so it
 * never takes a click meant for the creases over it, and it exists to be traced
 * and compared against — so when the user accepts the answer, the thing it was
 * there to check is done and it should go with the region that owns it.
 *
 * This used to release it instead: unlock it and leave it behind as an ordinary
 * image. That was an improvement on what came *before* it, which left a locked
 * underlay the user could see and could never select, fade or delete — locked is
 * absolute here, with no body, no handles, no context menu and no lock toggle
 * anywhere in the product. But "unlocked and still there" is not what accepting
 * looks like: it leaves a half-transparent photograph of the pattern sitting
 * under the pattern, which the user then has to find and delete by hand every
 * time. Deleting it is what Accept means.
 *
 * It is one history entry with the region, so a single undo brings both back —
 * which is the escape hatch for the user who did want to keep the photo.
 *
 * Bracketed by hand rather than through `useCpRegionActions.removeRegion` only
 * because the label has to say what the user pressed; the protocol is the same
 * one, and it is the annotation stack's own single-entry rule.
 */
function removeRegionAndItsImage(regionId: string, label: string): void {
  const store = useWorkspaceStore.getState();
  const before = store.oristudioCpAnnotations;
  const region = before.find((annotation) => annotation.id === regionId);
  const imageId =
    region && isSuppressionRegionAnnotation(region) ? region.imageId : undefined;
  store.removeAnnotation(regionId);
  if (imageId) store.removeAnnotation(imageId);
  store.recordAnnotationHistory([...before], label);
}

/**
 * The one toast an accepted solve gets, saying what it actually did.
 *
 * A solve takes seconds and the user is watching the creases, not a chip — so
 * the toast is the moment the result is read, and "Solved" over an editor that
 * still shows 70 angle markers is the single most misleading thing this flow can
 * say. It is a `success` only when the pattern will now pass the check the user
 * is looking at; every other ending is a `warning` carrying the before/after
 * figures, because a 1,900x improvement that still fails is indistinguishable
 * from a no-op unless the numbers are on screen.
 *
 * The action clause is appended here rather than in `solveCompletion` because it
 * names *this* surface's buttons; the modal offers different ones for the same
 * four endings.
 */
function completionToast(
  t: TFunction,
  regionId: string,
  facts: CpSolveCompletionFacts,
  movement: CpSolveMovement
): void {
  const clean = cpSolveMeetsFoldabilityCheck(facts.completion);
  // The movement figures ride along only where the detail has no numbers of its
  // own — that is the `exact` ending, whose sentence is otherwise qualitative.
  // Every other ending already quotes the residuals that matter more.
  const detail =
    facts.completion === 'exact'
      ? `${cpSolveCompletionDetail(t, facts)} ${cpSolveMovementSentence(t, movement)}`
      : cpSolveCompletionDetail(t, facts);
  // The same two-predicate split the chip renders from, so the toast never names
  // a button under a label the chip is not showing: tone follows the check, the
  // action clause follows the solver's verdict.
  const action = cpSolveIsExactVerdict(facts.completion)
    ? t(
        'toasts:cpRegionSolve.solvedAction',
        'Accept to keep it, or Try again to go back and change the topology.'
      )
    : t(
        'toasts:cpRegionSolve.incompleteAction',
        'Try again to repair the topology and solve again, or Accept anyway to keep these coordinates.'
      );
  const headline = cpSolveCompletionHeadline(t, facts.completion);
  const options = {
    id: `cp-region-solve-${regionId}`,
    description: `${detail} ${action}`,
  };
  if (clean) toast.success(headline, options);
  else toast.warning(headline, options);
}

function solveLabel(t: TFunction): string {
  return t('panels:cpRegion.solveHistory', 'Exact solve');
}

function partialLabel(t: TFunction): string {
  return t('panels:cpRegion.acceptPartialHistory', 'Accept partial exact solve');
}

function acceptLabel(t: TFunction): string {
  return t('panels:cpRegion.acceptHistory', 'Accept exact solve');
}

function tryAgainLabel(t: TFunction): string {
  return t('panels:cpRegion.tryAgainHistory', 'Revert exact solve');
}

/**
 * A sentence for each way the answer could not be placed.
 *
 * These are statements about the *document*, not about the solve — every one of
 * them follows a solve that succeeded — so each says what is wrong with the
 * pattern and what would make it placeable again.
 */
function placementRefusalLabel(t: TFunction, refusal: CpRegionSolvePlacementRefusal): string {
  switch (refusal) {
    case 'no_pattern':
      return t(
        'panels:cpRegion.placement.noPattern',
        'There are no creases inside this region, so there is nothing to solve. Move the region over the detected pattern and try again.'
      );
    case 'graph_mismatch':
      return t(
        'panels:cpRegion.placement.graphMismatch',
        'The solved answer does not describe the creases in this region, so nothing was changed. Try solving again.'
      );
  }
}

/**
 * The solve never reached a verdict — the worker died, or the bridge refused the
 * input. Distinct from every rejection sentence, because none of those apply: the
 * solver did not decide anything.
 */
function bridgeFailureLabel(t: TFunction, error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : '';
  return message
    ? t('panels:cpRegion.solveError', 'The solve could not run — {{message}}', { message })
    : t('panels:cpRegion.solveErrorUnknown', 'The solve could not run.');
}
