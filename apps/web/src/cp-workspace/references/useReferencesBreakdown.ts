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
  summary: ReferencesPlanSummary | null;
  analysis: ReferencesAnalysisSummaryState | null;
  /** The analysis itself, for the findings list. */
  analysisRecord: ReferencesAnalysis | null;
  /** Steps of every planned sheet, in order; what the scrubber walks. */
  flatSteps: ReferencesFlatStep[];
  /** The steps the reader walks: the folds, then the closing flips. */
  viewSteps: ReferencesViewStep[];
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

/**
 * The sheet to plan: the selected one, or the largest plannable one when the
 * selection names nothing.
 *
 * A list rather than one component because the run loop below still walks it —
 * the workspace answers for one sheet at a time (plan D12), and planning one
 * sheet is what makes `planned.length === 1` true on every document, so the
 * planner survives a run and `startFromPlan` has a state to score against.
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
        mixedSteps:
          acc.mixedSteps +
          entry.result.sequence.steps.filter(
            // A pattern line creased the other way for part of its length;
            // an auxiliary fold has no assignment and a share of exactly 0.
            (step) => step.kind === 'cp' && step.direction_share > 0 && step.direction_share < 1
          ).length,
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
  // The worst class across sheets, because the summary strip speaks for the
  // whole pattern: one off-lattice sheet makes the plan an off-lattice plan.
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
  return {
    computedAtRevision: record.revision,
    component: first.component,
    status: first.result.sequence.status,
    stopReason: first.result.stopReason,
    partial,
    certification: first.result.sequence.certification,
    ...totals,
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
  selectedSheet: number | null
): ReferencesBreakdownController {
  const { t } = useTranslation();
  const viewState = useWorkspaceStore((state) => state.referencesView);
  // The summary is derived from the record below, not read from the store.
  // `referencesPlan` is one slot for a whole document and is cleared on every
  // sheet switch, so switching away and back left the toolbar blank over a plan
  // the filmstrip was still showing. The record already says which sheet has a
  // plan; the store keeps its own copy for the analytics descriptor.
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
  const latest = useRef({ geometry, revision, frames, selectedSheet });
  useEffect(() => {
    latest.current = { geometry, revision, frames, selectedSheet };
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
      onProgress: (progress: PrecreasePlanProgress) => void
    ): Promise<
      (ReferencesPlanComponent & { token: number }) | { refusedKind: PrecreaseRefusalKind | null }
    > => {
      const created = await client.plannerCreate(
        input.segments,
        input.colors,
        component.id,
        { total_budget_ms: budgetMs },
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
        token: created.token,
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
    const runId = beginReferencesRun();
    setReferencesRun({ status: 'running', startedAt: Date.now() });
    setReferencesProgress({ phase: 'closing', done: 0, total: 0 });
    const started = performance.now();
    const input = precreaseInputFromTransport(current.geometry);

    void (async () => {
      const client = getPrecreaseClient();
      const planned: ReferencesPlanComponent[] = [];
      const refused: ReferencesPlanRecord['refused'] = [];
      let lastToken: number | null = null;
      try {
        // The whole run shares one budget; each sheet gets what is left,
        // divided by the sheets still to do, so one pathological component
        // cannot eat a canvas.
        const totalBudgetMs = 30_000;
        for (let i = 0; i < sheets.length; i += 1) {
          if (controller.signal.aborted) break;
          const spent = performance.now() - started;
          const share = Math.max(1_000, (totalBudgetMs - spent) / (sheets.length - i));
          const outcome = await planComponent(
            client,
            sheets[i],
            input,
            forRevision,
            controller.signal,
            share,
            (progress) => setReferencesProgress(progressOf(progress))
          );
          if ('refusedKind' in outcome) refused.push({ component: sheets[i].id, kind: outcome.refusedKind });
          else {
            planned.push(outcome);
            lastToken = outcome.token;
          }
          if (performance.now() - started >= totalBudgetMs) break;
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
        // A single-sheet plan keeps its planner: it is the state
        // `settings.startFromPlan` scores a target's candidates against, and
        // rebuilding it would mean re-running the closure. Anything else is
        // disposed — the survivor would be the wrong sheet's.
        if (planned.length !== 1) await client.plannerDispose().catch(() => undefined);
      }

      endReferencesRun(runId);
      setReferencesProgress(null);
      if (latest.current.revision !== forRevision) return;
      const record: ReferencesPlanRecord = {
        revision: forRevision,
        components: planned,
        refused,
        durationMs: performance.now() - started,
        plannerToken: planned.length === 1 ? (lastToken ?? null) : null,
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
    const runId = beginReferencesRun();
    setReferencesRun({ status: 'running', startedAt: Date.now() });
    setReferencesProgress({ phase: 'closing', done: 0, total: 0 });
    const input = precreaseInputFromTransport(current.geometry);

    void (async () => {
      const client = getPrecreaseClient();
      try {
        const created = await client.plannerCreate(
          input.segments,
          input.colors,
          sheet.id,
          {},
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
    summary: record ? summaryOf(record) : null,
    analysis: analysisSummary?.computedAtRevision === revision ? analysisSummary : null,
    analysisRecord: analysisRecord?.analysis ?? null,
    flatSteps,
    viewSteps,
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
