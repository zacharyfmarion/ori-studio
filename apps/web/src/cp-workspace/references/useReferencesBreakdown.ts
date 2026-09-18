import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ANALYTICS_EVENTS, bucketCount, COUNT_BUCKETS, DURATION_MS_BUCKETS, track } from '../../analytics';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { humanizeError } from '../../lib/toastMessages';
import { reportError } from '../../monitoring';
import {
  getPrecreaseClient,
  peekPrecreaseClient,
  releasePrecreaseClient,
  retainPrecreaseClient,
  type PrecreaseClient,
} from '../../store/workspaceStore/precreaseRuntime';
import { releaseReferenceFinderClient } from '../../store/workspaceStore/referenceFinderRuntime';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type {
  ReferencesAnalysisSummaryState,
  ReferencesPlanSummary,
  ReferencesProgress,
} from '../../store/workspaceStore/types';
import { createWorkerReferenceFinderClient } from './referenceFinder/client';
import { createReferenceFinderCache, type ReferenceFinderCache } from './referenceFinder/cache';
import { DEFAULT_DATABASE_SETTINGS, databaseKey } from './referenceFinder/protocol';
import {
  createWorkerPlannerHandle,
  runPrecreasePlan,
  type PrecreasePlanProgress,
  type PrecreasePlanResult,
  type PrecreasePlanStopReason,
} from './precreasePlan';
import type {
  PrecreasePlannerInfo,
  PrecreaseSequence,
  PrecreaseSide,
  PrecreaseStep,
} from './precreaseSequence';
import { analyzeReferences, type ReferencesAnalysis } from './referencesAnalysis';
import {
  breakdownTotals,
  flatPlanSteps,
  planIsForSheet,
  type ReferencesFlatStep,
} from './referencesBreakdown';
import { decodePlanModel, planModelPoints } from './referencesPlanGeometry';
import {
  planVariant,
  referencesResultsSnapshot,
  setReferencesAnalysisRecord,
  setReferencesPlanRecord,
  subscribeReferencesResults,
  type ReferencesPlanComponent,
  type ReferencesPlanRecord,
  type ReferencesPlanVariant,
} from './referencesResults';
import { beginReferencesRun, endReferencesRun, referencesRunSnapshot } from './referencesRun';
import { referencesViewSteps, type ReferencesViewStep } from './referencesSequenceView';
import { refusalMessageFor } from './referencesSidebarText';
import type {
  PrecreaseComponent,
  PrecreaseRefusalKind,
  PrecreaseRfRect,
  SheetAnalysis,
} from './sheetFrames';
import { paperFallbackRect, precreaseInputFromTransport } from './sheetFrames';

/**
 * The whole-pattern breakdown and the CP-wide analysis: the two runs the
 * References workspace makes when no vertex or crease is picked.
 *
 * The loop itself is `precreasePlan.ts` / `referencesAnalysis.ts`, which are
 * React-free and unit-tested. What this hook owns is everything that makes it
 * a *workspace feature*: which sheets to plan, the planner's lifetime in the
 * worker, mapping the answer into model space once, keying it to the document
 * revision, the run registry that gives Stop something to stop, and the
 * analytics.
 *
 * Neither run starts on its own. Both cost seconds, and the plan is explicit
 * that a stale result is marked, never silently recomputed.
 */

/** One planned sheet in the order currently shown, as the sidebar reads it. */
export interface ReferencesBreakdownComponent {
  component: number;
  /** The presentation order the "landmarks first" toggle selected. */
  sequence: PrecreaseSequence;
  totals: ReturnType<typeof breakdownTotals>;
  result: PrecreasePlanResult;
}

export interface ReferencesBreakdownController {
  /** The breakdown for the geometry on screen, or null. */
  record: ReferencesPlanRecord | null;
  components: ReferencesBreakdownComponent[];
  /** The presentation order currently shown, per planned sheet. */
  variants: ReferencesPlanVariant[];
  /** Sheets the planner refused, with the reason, listed rather than planned. */
  refused: ReferencesPlanRecord['refused'];
  /** A breakdown exists but describes an earlier revision. */
  stale: boolean;
  analysis: ReferencesAnalysisSummaryState | null;
  /** The analysis itself, for the findings list. */
  analysisRecord: ReferencesAnalysis | null;
  /** Steps of every planned sheet, in order; what the scrubber walks. */
  flatSteps: ReferencesFlatStep[];
  /** The steps the reader walks: the folds, then the closing flips. */
  viewSteps: ReferencesViewStep[];
  /** Why each sheet's run ended, in `variants` order — the strip's last card is worded by it. */
  stopReasons: PrecreasePlanStopReason[];
  activeStep: number;
  landmarksFirst: boolean;
  activeFinding: number | null;
  running: boolean;
  progress: ReferencesProgress | null;
  /** Compute (or recompute) the breakdown. */
  run: () => void;
  /** Compute (or recompute) the CP-wide analysis. */
  runAnalysis: () => void;
  selectStep: (index: number) => void;
  selectFinding: (index: number | null) => void;
  toggleLandmarksFirst: () => void;
}

/**
 * ReferenceFinder caches, shared per database so a second run of the same
 * pattern re-asks nothing. Module-level rather than in the hook: the panel is
 * unmounted on every workspace switch and the answers do not change with it.
 */
const planCaches = new Map<string, ReferenceFinderCache>();

function cacheFor(rect: PrecreaseRfRect): ReferenceFinderCache {
  const database = { ...DEFAULT_DATABASE_SETTINGS, width: rect.width, height: rect.height };
  const key = databaseKey(database);
  let cache = planCaches.get(key);
  if (!cache) {
    cache = createReferenceFinderCache();
    planCaches.set(key, cache);
  }
  return cache;
}

/**
 * The planner instance's two clients for one sheet: exact for the stuck
 * fallback, approximate for the findings list. Both on the `'planner'` worker,
 * never the window one, so a change to the per-target settings can never
 * change what a plan's cache was computed from (D7).
 */
function plannerClients(rect: PrecreaseRfRect) {
  const database = { ...DEFAULT_DATABASE_SETTINGS, width: rect.width, height: rect.height };
  const cache = cacheFor(rect);
  return {
    exact: createWorkerReferenceFinderClient('planner', {
      database,
      query: { goodEnoughError: 1e-9, count: 5, worstCase: 1 },
      cache,
    }),
    approximate: createWorkerReferenceFinderClient('planner', {
      database,
      query: { goodEnoughError: 0.005, count: 1, worstCase: 1 },
      cache,
    }),
  };
}

/** `0` is "no ceiling" to both the loop and the crate's `Deadline::after`. */
const NO_TIME_CEILING_MS = 0;

/**
 * The sheet to plan: the selected one, or the largest plannable one when the
 * selection names nothing.
 *
 * A list rather than one component because the run loop below still walks it —
 * the workspace answers for one sheet at a time (plan D12).
 */
function plannableComponents(
  analysis: SheetAnalysis,
  selected: number | null
): PrecreaseComponent[] {
  const plannable = analysis.components
    .filter((component) => component.frame !== null && component.rf_rect !== null)
    .sort((a, b) => b.segment_indices.length - a.segment_indices.length);
  // A named sheet is answered for as named: falling back to another one when
  // the selection is refused would plan a pattern the user is not looking at
  // and label it as theirs.
  const chosen =
    selected === null ? plannable[0] : plannable.find((component) => component.id === selected);
  return chosen ? [chosen] : [];
}

/**
 * How many times the folder turns the paper over.
 *
 * The sheet starts front side up, so a plan whose first step is on the back
 * opens with one; the closing turn-over that puts the pattern back on the front
 * is counted too, since the folder performs it.
 */
function turnOversOf(steps: readonly PrecreaseStep[]): number {
  let side: PrecreaseSide = 'front';
  let count = 0;
  for (const step of steps) {
    if (step.side !== side) {
      count += 1;
      side = step.side;
    }
  }
  return side === 'front' ? count : count + 1;
}

/**
 * How many of the pattern's lines it creases both ways: a property of the
 * design, so a line the grid pleats counts exactly as one folded on its own
 * would, or the number would move with the setting instead of the pattern.
 * An auxiliary fold has no assignment and a share of exactly 0.
 */
function mixedLinesOf(steps: readonly PrecreaseStep[]): number {
  let count = 0;
  for (const step of steps) {
    const shares =
      step.grid?.lines.map((line) => line.pattern_share) ??
      (step.kind === 'cp' ? [step.direction_share] : []);
    count += shares.filter((share) => share > 0 && share < 1).length;
  }
  return count;
}

/** The plan's counts, as the store's summary descriptor. */
function summaryOf(record: ReferencesPlanRecord): ReferencesPlanSummary | null {
  const first = record.components[0];
  if (!first) return null;
  const totals = record.components.reduce(
    (acc, entry) => {
      const t = entry.result.sequence.totals;
      return {
        folds: acc.folds + t.folds,
        cpLines: acc.cpLines + t.cp_lines,
        aux: acc.aux + t.aux,
        visibleAux: acc.visibleAux + t.visible_aux,
        lowerBound: acc.lowerBound + t.lower_bound,
        freeLines: acc.freeLines + t.free_lines,
        unsolved: acc.unsolved + t.unsolved,
        stepCount: acc.stepCount + entry.result.sequence.steps.length,
        findingCount: acc.findingCount + entry.result.sequence.findings.length,
        approximateCount: acc.approximateCount + entry.result.approximate.length,
        inexactSteps: acc.inexactSteps + t.approximate,
        turnOvers: acc.turnOvers + turnOversOf(entry.result.sequence.steps),
        mixedSteps: acc.mixedSteps + mixedLinesOf(entry.result.sequence.steps),
      };
    },
    {
      folds: 0,
      cpLines: 0,
      aux: 0,
      visibleAux: 0,
      lowerBound: 0,
      freeLines: 0,
      unsolved: 0,
      stepCount: 0,
      findingCount: 0,
      approximateCount: 0,
      inexactSteps: 0,
      turnOvers: 0,
      mixedSteps: 0,
    }
  );
  // The worst class across sheets, because the summary speaks for the whole
  // pattern: one off-lattice sheet makes the plan an off-lattice plan.
  const order = { exact: 0, snappable: 1, off_lattice: 2 } as const;
  let exactnessClass: ReferencesPlanSummary['exactnessClass'] = null;
  let maxDisplacementModel = 0;
  for (const entry of record.components) {
    const exactness = entry.result.sequence.exactness;
    if (!exactness) continue;
    maxDisplacementModel = Math.max(maxDisplacementModel, exactness.max_displacement_model);
    if (exactnessClass === null || order[exactness.class] > order[exactnessClass]) {
      exactnessClass = exactness.class;
    }
  }
  const partial = record.components.some((entry) => entry.result.partial) || record.refused.length > 0;
  // The first sheet's grid, like its status: the workspace plans one sheet at
  // a time (D12), so there is no second one to be worst-case across.
  const grid = first.result.sequence.grid ?? null;
  return {
    computedAtRevision: record.revision,
    component: first.component,
    status: first.result.sequence.status,
    stopReason: first.result.stopReason,
    partial,
    certification: first.result.sequence.certification,
    ...totals,
    gridKind: grid?.kind ?? null,
    gridN: grid?.n ?? 0,
    gridLines: first.result.sequence.totals.grid_lines,
    gridCpLines: first.result.sequence.totals.grid_cp_lines,
    gridSteps: grid?.steps ?? 0,
    gridUnwantedLength: first.result.sequence.totals.grid_unwanted_length ?? 0,
    reachLength: first.result.sequence.totals.reach_length ?? 0,
    exactnessClass,
    maxDisplacementModel,
    durationMs: record.durationMs,
  };
}

function progressOf(progress: PrecreasePlanProgress): ReferencesProgress {
  if (progress.phase === 'querying' || progress.phase === 'approximating') {
    return {
      phase: progress.phase,
      done: progress.queried ?? 0,
      total: progress.queryTotal ?? 0,
    };
  }
  return {
    phase: progress.phase === 'done' ? 'done' : progress.phase,
    done: progress.folded,
    total: progress.targets,
  };
}

export function useReferencesBreakdown(
  geometry: CpGeometryTransport | null,
  revision: string,
  frames: SheetAnalysis | null,
  /** The sheet the sidebar has selected; null falls back to the largest. */
  selectedSheet: number | null,
  /**
   * A vertex or crease is picked, so the workspace is showing that target's
   * construction rather than the whole-pattern plan. The auto-plan and
   * Recompute both leave the plan alone then, and so does a settings change.
   */
  targeted = false
): ReferencesBreakdownController {
  const { t } = useTranslation();
  const viewState = useWorkspaceStore((state) => state.referencesView);
  const precreaseGrid = useWorkspaceStore((state) => state.referencesSettings.precreaseGrid);
  const gridWhereNeeded = useWorkspaceStore(
    (state) => state.referencesSettings.gridWhereNeeded
  );
  const allowDanglingFolds = useWorkspaceStore(
    (state) => state.referencesSettings.allowDanglingFolds
  );
  const mergeSymmetricSteps = useWorkspaceStore(
    (state) => state.referencesSettings.mergeSymmetricSteps
  );
  // `referencesPlan` is one slot for a whole document, cleared on every sheet
  // switch, and nothing here reads it: the record says which sheet has a plan,
  // and the store's copy is the analytics descriptor.
  const analysisSummary = useWorkspaceStore((state) => state.referencesAnalysis);
  const progress = useWorkspaceStore((state) => state.referencesProgress);
  const setReferencesPlan = useWorkspaceStore((state) => state.setReferencesPlan);
  const setReferencesAnalysis = useWorkspaceStore((state) => state.setReferencesAnalysis);
  const setReferencesProgress = useWorkspaceStore((state) => state.setReferencesProgress);
  const setReferencesRun = useWorkspaceStore((state) => state.setReferencesRun);
  const setReferencesView = useWorkspaceStore((state) => state.setReferencesView);
  const toggleLandmarks = useWorkspaceStore((state) => state.toggleReferencesLandmarksFirst);

  const side = useSyncExternalStore(subscribeReferencesResults, referencesResultsSnapshot);
  // A plan belongs to a revision *and* to a sheet. The side table keeps the last
  // one computed, and switching sheets changes neither the document nor its
  // revision — so keyed on the revision alone the workspace went on serving the
  // previous sheet's plan against the new sheet's canvas, where its crease ids
  // name nothing and the build-up draws an empty page.
  //
  // Keyed rather than cleared, so switching back to a sheet already planned
  // costs nothing. A plan for another sheet is not *stale*, either: nothing
  // about it is out of date, it simply is not this sheet's, and offering
  // Recompute for it would be answering a question nobody asked.
  const record = side.plan?.revision === revision && planIsForSheet(side.plan, selectedSheet)
    ? side.plan
    : null;
  const stale =
    side.plan !== null && planIsForSheet(side.plan, selectedSheet) && side.plan.revision !== revision;
  // Same rule for the CP-wide analysis, whose own `analysis.component` records
  // the sheet it read.
  const analysisRecord =
    side.analysis?.revision === revision &&
    (selectedSheet === null || side.analysis.analysis.component === selectedSheet)
      ? side.analysis
      : null;

  // The values the async runs read after an await, and the abort they answer
  // to. A run belongs to one revision; the document moving on drops it.
  const latest = useRef({
    geometry,
    revision,
    frames,
    selectedSheet,
    precreaseGrid,
    gridWhereNeeded,
    allowDanglingFolds,
    mergeSymmetricSteps,
  });
  useEffect(() => {
    latest.current = {
      geometry,
      revision,
      frames,
      selectedSheet,
      precreaseGrid,
      gridWhereNeeded,
      allowDanglingFolds,
      mergeSymmetricSteps,
    };
  });
  const abortRef = useRef<AbortController | null>(null);
  // The planner bridge is retained here in its own right rather than leaning on
  // the target hook's reference: the counts are what keep the worker alive
  // across the two cleanups, and `peek` covers the order in which they run —
  // whichever releases last terminates the worker, and disposing a planner in a
  // worker that is already gone is a no-op, not an error.
  useEffect(() => {
    retainPrecreaseClient();
    return () => {
      abortRef.current?.abort();
      void peekPrecreaseClient()
        ?.plannerDispose()
        .catch(() => undefined);
      releasePrecreaseClient();
      releaseReferenceFinderClient('planner');
    };
  }, []);

  /**
   * Plan one sheet: create the planner, run the loop, map its geometry into
   * model space in one round trip. The planner is disposed by the caller —
   * one lives at a time, so the next sheet's `plannerCreate` replaces it.
   */
  const planComponent = useCallback(
    async (
      client: PrecreaseClient,
      component: PrecreaseComponent,
      input: { segments: Float64Array; colors: Int32Array },
      forRevision: string,
      signal: AbortSignal,
      budgetMs: number,
      /**
       * Open a pleated design with its grid pleated, and only where it is
       * needed (`referencesSettings.precreaseGrid` / `gridWhereNeeded`); let a
       * crease dangle at one end (`allowDanglingFolds`), or not; show
       * mirrored folds as one card (`mergeSymmetricSteps`), or not.
       */
      grid: {
        precreaseGrid: boolean;
        gridWhereNeeded: boolean;
        allowDanglingFolds: boolean;
        mergeSymmetricSteps: boolean;
      },
      onProgress: (progress: PrecreasePlanProgress) => void
    ): Promise<
      ReferencesPlanComponent | { refusedKind: PrecreaseRefusalKind | null }
    > => {
      const created = await client.plannerCreate(
        input.segments,
        input.colors,
        component.id,
        {
          total_budget_ms: budgetMs,
          precrease_grid: grid.precreaseGrid,
          grid_where_needed: grid.gridWhereNeeded,
          allow_dangling_folds: grid.allowDanglingFolds,
          merge_symmetric_steps: grid.mergeSymmetricSteps,
        },
        paperFallbackRect()
      );
      const info: PrecreasePlannerInfo = created.info;
      if (info.refused || !component.frame || !component.rf_rect) {
        return { refusedKind: component.refused?.kind ?? null };
      }
      const handle = createWorkerPlannerHandle(client, created.token);
      const result = await runPrecreasePlan(handle, {
        computedAtRevision: forRevision,
        referenceFinder: plannerClients(component.rf_rect),
        totalBudgetMs: budgetMs,
        signal,
        onProgress,
      });
      // Both presentation orders, now, while the planner still holds the
      // closure they are derived from: `sequence()` is a presentation pass,
      // and computing the hoisted one later would need this planner back.
      const frame = component.frame;
      const variant = async (sequence: PrecreaseSequence) => ({
        sequence,
        model: decodePlanModel(
          sequence,
          await client.rfToModelMany(frame, planModelPoints(sequence))
        ),
      });
      return {
        component: component.id,
        result,
        frame,
        plain: await variant(result.sequence),
        hoisted: await variant(await handle.sequence(true)),
      };
    },
    []
  );

  const run = useCallback(() => {
    const current = latest.current;
    if (!current.geometry || !current.frames) return;
    if (referencesRunSnapshot().running) return;
    const forRevision = current.revision;
    const sheets = plannableComponents(current.frames, current.selectedSheet);
    if (sheets.length === 0) {
      const refusal =
        current.selectedSheet === null
          ? null
          : (current.frames.components.find((entry) => entry.id === current.selectedSheet) ?? null);
      setReferencesRun({
        status: 'error',
        message:
          refusal && refusal.frame === null
            ? refusalMessageFor(t, refusal)
            : t(
                'panels:references.noRectangularSheet',
                'No rectangular sheet: references can only be found on rectangular sheets for now.'
              ),
      });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = beginReferencesRun(() => controller.abort());
    setReferencesRun({ status: 'running', startedAt: Date.now() });
    setReferencesProgress({ phase: 'closing', done: 0, total: 0 });
    const started = performance.now();
    const input = precreaseInputFromTransport(current.geometry);
    // Taken now, with the rest of `current`, so a toggle mid-run cannot make
    // a plan that is for neither setting.
    const grid = {
      precreaseGrid: current.precreaseGrid,
      gridWhereNeeded: current.gridWhereNeeded,
      allowDanglingFolds: current.allowDanglingFolds,
      mergeSymmetricSteps: current.mergeSymmetricSteps,
    };

    void (async () => {
      const client = getPrecreaseClient();
      const planned: ReferencesPlanComponent[] = [];
      const refused: ReferencesPlanRecord['refused'] = [];
      try {
        // No time ceiling: the run lasts as long as the pattern needs, and the
        // Stop button — the overlay's and the long-run toast's — is the way
        // out. A 30 s ceiling used to end a pattern off its lattice everywhere
        // after a handful of folds, with nothing on screen saying so and no way
        // to ask for the rest. The list is one sheet (D12); a multi-sheet run
        // would simply take its sheets in turn.
        for (const sheet of sheets) {
          if (controller.signal.aborted) break;
          const outcome = await planComponent(
            client,
            sheet,
            input,
            forRevision,
            controller.signal,
            NO_TIME_CEILING_MS,
            grid,
            (progress) => setReferencesProgress(progressOf(progress))
          );
          if ('refusedKind' in outcome) refused.push({ component: sheet.id, kind: outcome.refusedKind });
          else planned.push(outcome);
        }
      } catch (error) {
        endReferencesRun(runId);
        setReferencesProgress(null);
        if (latest.current.revision !== forRevision) return;
        reportError(error, { surface: 'references:plan' });
        setReferencesRun({ status: 'error', message: humanizeError(error, t) });
        track(ANALYTICS_EVENTS.foldingStepsRefused, {
          target_kind: 'whole_cp',
          refusal_reason: 'error',
        });
        return;
      } finally {
        // The planner is not kept: both presentation orders were read while
        // it held the closure, and nothing asks it anything afterwards.
        await client.plannerDispose().catch(() => undefined);
      }

      endReferencesRun(runId);
      setReferencesProgress(null);
      if (latest.current.revision !== forRevision) return;
      const record: ReferencesPlanRecord = {
        revision: forRevision,
        components: planned,
        refused,
        durationMs: performance.now() - started,
        precreaseGrid: grid.precreaseGrid,
        gridWhereNeeded: grid.gridWhereNeeded,
        allowDanglingFolds: grid.allowDanglingFolds,
        mergeSymmetricSteps: grid.mergeSymmetricSteps,
      };
      setReferencesPlanRecord(record);
      const nextSummary = summaryOf(record);
      setReferencesPlan(nextSummary);
      setReferencesView({ activeStep: 0, activeFinding: null });
      setReferencesRun({ status: 'idle' });
      trackPlan(record, nextSummary, controller.signal.aborted);
    })();
  }, [planComponent, setReferencesPlan, setReferencesProgress, setReferencesRun, setReferencesView, t]);

  const runAnalysis = useCallback(() => {
    const current = latest.current;
    if (!current.geometry || !current.frames) return;
    if (referencesRunSnapshot().running) return;
    const sheets = plannableComponents(current.frames, current.selectedSheet);
    const sheet = sheets[0];
    const rect = sheet?.rf_rect ?? null;
    if (!sheet || !rect) {
      setReferencesRun({
        status: 'error',
        message: t(
          'panels:references.noRectangularSheet',
          'No rectangular sheet: references can only be found on rectangular sheets for now.'
        ),
      });
      return;
    }
    const forRevision = current.revision;
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = beginReferencesRun(() => controller.abort());
    setReferencesRun({ status: 'running', startedAt: Date.now() });
    setReferencesProgress({ phase: 'closing', done: 0, total: 0 });
    const input = precreaseInputFromTransport(current.geometry);

    void (async () => {
      const client = getPrecreaseClient();
      try {
        // No grid, whatever the folding-sequence setting says: the analysis
        // gives every line an axiom or a rank, and a pleated line has neither
        // — it is in no cp step and never remaining, so it would simply be
        // missing from the count.
        const created = await client.plannerCreate(
          input.segments,
          input.colors,
          sheet.id,
          { precrease_grid: false },
          paperFallbackRect()
        );
        const handle = createWorkerPlannerHandle(client, created.token);
        const analysis = await analyzeReferences(handle, {
          computedAtRevision: forRevision,
          client: plannerClients(rect).exact,
          signal: controller.signal,
          onProgress: (update) =>
            setReferencesProgress({
              phase: update.phase === 'querying' ? 'querying' : update.phase === 'done' ? 'done' : 'closing',
              done: update.phase === 'querying' ? update.queried : update.closed,
              total: update.phase === 'querying' ? update.queryTotal : update.closed + update.remaining,
            }),
        });
        endReferencesRun(runId);
        setReferencesProgress(null);
        if (latest.current.revision !== forRevision) return;
        setReferencesAnalysisRecord({ revision: forRevision, analysis });
        setReferencesAnalysis({
          computedAtRevision: forRevision,
          component: analysis.component,
          ...analysis.summary,
          partial: analysis.partial,
          durationMs: analysis.durationMs,
        });
        setReferencesRun({ status: 'idle' });
        track(ANALYTICS_EVENTS.referenceBatchCompleted, {
          lines_bucket: bucketCount(analysis.summary.lines, COUNT_BUCKETS),
          unreachable_bucket: bucketCount(
            analysis.summary.exact + analysis.summary.approximate + analysis.summary.unsolved,
            COUNT_BUCKETS
          ),
          duration_bucket: bucketCount(Math.round(analysis.durationMs), DURATION_MS_BUCKETS),
        });
      } catch (error) {
        endReferencesRun(runId);
        setReferencesProgress(null);
        if (latest.current.revision !== forRevision) return;
        reportError(error, { surface: 'references:analysis' });
        setReferencesRun({ status: 'error', message: humanizeError(error, t) });
      } finally {
        await client.plannerDispose().catch(() => undefined);
      }
    })();
  }, [setReferencesAnalysis, setReferencesProgress, setReferencesRun, t]);

  // Precrease grid changes the plan, not its presentation: the grid is pleated
  // before the first close, so there is no second `sequence()` reading to
  // switch to the way `landmarksFirst` does. The plan on screen records the
  // setting it was made under, and whenever the two disagree — a toggle, or a
  // toggle made while a run was in flight or while another sheet was up, once
  // the plan it should have changed is back on screen — it is re-planned.
  // Keyed on the record rather than on the click, so a toggle can never be
  // swallowed. A picked target defers it: the whole-pattern run is not what is
  // wanted then, and it would reset the target's step when it landed.
  useEffect(() => {
    if (record === null) return;
    // "Only where needed" says nothing without a grid, so with the grid off
    // a plan made under either value of it is the plan wanted.
    if (
      record.precreaseGrid === precreaseGrid &&
      (!precreaseGrid || record.gridWhereNeeded === gridWhereNeeded) &&
      record.allowDanglingFolds === allowDanglingFolds &&
      record.mergeSymmetricSteps === mergeSymmetricSteps
    ) {
      return;
    }
    if (targeted || referencesRunSnapshot().running) return;
    run();
  }, [
    precreaseGrid,
    gridWhereNeeded,
    allowDanglingFolds,
    mergeSymmetricSteps,
    record,
    run,
    targeted,
  ]);

  const landmarksFirst = viewState.landmarksFirst;
  const variants = useMemo<ReferencesPlanVariant[]>(
    () => record?.components.map((entry) => planVariant(entry, landmarksFirst)) ?? [],
    [record, landmarksFirst]
  );

  const components = useMemo<ReferencesBreakdownComponent[]>(
    () =>
      record?.components.map((entry, index) => {
        const sequence = variants[index].sequence;
        return {
          component: entry.component,
          sequence,
          totals: breakdownTotals(sequence.totals),
          result: entry.result,
        };
      }) ?? [],
    [record, variants]
  );

  const flatSteps = useMemo(
    () => flatPlanSteps(variants.map((variant) => variant.sequence)),
    [variants]
  );

  /** Why each sheet's run ended, in `variants` order, for the strip's last card. */
  const stopReasons = useMemo(
    () => record?.components.map((entry) => entry.result.stopReason) ?? [],
    [record]
  );

  /**
   * The steps as they are *read*, which is longer than the planner's own list:
   * turning the paper over and reversing the mountains are steps the reader
   * walks, and the step index addresses this list.
   *
   * Derived here rather than in the panel so one place owns the length. Clamped
   * against `flatSteps`, the closing steps were unreachable — every press on one
   * of their cards landed back on the last fold.
   */
  const viewSteps = useMemo(
    () => referencesViewSteps(variants, flatSteps),
    [variants, flatSteps]
  );

  const activeStep = Math.max(0, Math.min(viewSteps.length - 1, viewState.activeStep));

  const selectStep = useCallback(
    (index: number) => {
      if (viewSteps.length === 0) return;
      setReferencesView({
        activeStep: Math.max(0, Math.min(viewSteps.length - 1, index)),
        activeFinding: null,
      });
    },
    [viewSteps.length, setReferencesView]
  );

  const selectFinding = useCallback(
    (index: number | null) => setReferencesView({ activeFinding: index }),
    [setReferencesView]
  );

  // Landmarks first swaps between two orders the crate produced, rather than
  // reordering steps here: which auxiliary folds may be hoisted is its
  // judgement (`order.rs` — monotonicity lets a fold move later, never
  // earlier), and both orders were computed when the plan landed.
  const toggleLandmarksFirst = useCallback(() => {
    toggleLandmarks();
  }, [toggleLandmarks]);

  return {
    record,
    components,
    variants,
    refused: record?.refused ?? [],
    stale,
    analysis: analysisSummary?.computedAtRevision === revision ? analysisSummary : null,
    analysisRecord: analysisRecord?.analysis ?? null,
    flatSteps,
    viewSteps,
    stopReasons,
    activeStep,
    landmarksFirst,
    activeFinding: viewState.activeFinding,
    running: progress !== null,
    progress,
    run,
    runAnalysis,
    selectStep,
    selectFinding,
    toggleLandmarksFirst,
  };
}

/**
 * One of the three breakdown outcomes, with bucketed counts only — never a
 * fold count, never a coordinate (`docs/analytics.md`). A run that produced no
 * plan at all is `refused`, which is the fact worth knowing: it means the
 * workspace had nothing to offer for this pattern.
 */
function trackPlan(
  record: ReferencesPlanRecord,
  summary: ReferencesPlanSummary | null,
  aborted: boolean
): void {
  const duration_bucket = bucketCount(Math.round(record.durationMs), DURATION_MS_BUCKETS);
  if (!summary) {
    track(ANALYTICS_EVENTS.foldingStepsRefused, {
      target_kind: 'whole_cp',
      refusal_reason: 'non_rectangular',
      duration_bucket,
    });
    return;
  }
  const properties = {
    target_kind: 'whole_cp' as const,
    lines_bucket: bucketCount(summary.cpLines, COUNT_BUCKETS),
    aux_bucket: bucketCount(summary.aux, COUNT_BUCKETS),
    visible_aux_bucket: bucketCount(summary.visibleAux, COUNT_BUCKETS),
    duration_bucket,
    exactness_class: summary.exactnessClass ?? 'exact',
    // The whole architecture of the schedule was chosen on this number, so it
    // is the one to watch: a median of 4 was what the corpus predicted.
    turn_overs_bucket: bucketCount(summary.turnOvers, COUNT_BUCKETS),
    mixed_steps_bucket: bucketCount(summary.mixedSteps, COUNT_BUCKETS),
    // Whether the design was pleated on a grid at all, and how big the grid
    // was — the share of real designs the grid-first opening applies to.
    grid_kind: summary.gridKind ?? 'none',
    grid_lines_bucket: bucketCount(summary.gridLines, COUNT_BUCKETS),
    // How the grid was made — one pleat per family, or pleats plus bands —
    // and how much crease it put where the pattern has none, in tenths of a
    // sheet-length: the number "only where needed" exists to lower.
    grid_steps_bucket: bucketCount(summary.gridSteps, COUNT_BUCKETS),
    grid_unwanted_bucket: bucketCount(
      Math.round(summary.gridUnwantedLength * 10),
      COUNT_BUCKETS
    ),
    // How much crease the steps made past the pattern's own to end at
    // references, in tenths of a sheet-length: the cost of the reach rule,
    // and of "Allow dangling folds" being off on top of it — which is why
    // the setting the plan was made under goes with it.
    reach_bucket: bucketCount(Math.round(summary.reachLength * 10), COUNT_BUCKETS),
    dangling_folds: record.allowDanglingFolds ? ('allowed' as const) : ('disallowed' as const),
    // Whether mirrored folds were shown as one card, and how many cards that
    // saved — bucketed, like every count here.
    symmetric_steps: record.mergeSymmetricSteps ? ('merged' as const) : ('separate' as const),
  };
  if (aborted) {
    track(ANALYTICS_EVENTS.foldingStepsCancelled, properties);
    return;
  }
  const refusal = REFUSAL_REASONS[summary.stopReason];
  if (refusal) {
    track(ANALYTICS_EVENTS.foldingStepsRefused, { ...properties, refusal_reason: refusal });
    return;
  }
  track(ANALYTICS_EVENTS.foldingStepsCompleted, properties);
}

/** Which stop reasons are refusals, and what to call them. */
const REFUSAL_REASONS: Readonly<Record<string, 'non_rectangular' | 'point_cap' | 'budget'>> = {
  refused_sheet: 'non_rectangular',
  point_cap: 'point_cap',
  budget: 'budget',
};
