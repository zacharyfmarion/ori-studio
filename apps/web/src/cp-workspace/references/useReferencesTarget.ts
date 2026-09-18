import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ANALYTICS_EVENTS, bucketCount, DURATION_MS_BUCKETS, track } from '../../analytics';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { Point } from '../../lib/geometry';
import { humanizeError } from '../../lib/toastMessages';
import { reportError } from '../../monitoring';
import {
  getPrecreaseClient,
  releasePrecreaseClient,
  retainPrecreaseClient,
  whilePrecreaseClientAlive,
} from '../../store/workspaceStore/precreaseRuntime';
import {
  getReferenceFinderClient,
  releaseReferenceFinderClient,
  whileReferenceFinderClientAlive,
} from '../../store/workspaceStore/referenceFinderRuntime';
import type { ReferencesCandidate, ReferencesTarget } from '../../store/workspaceStore/types';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  createReferenceFinderClient,
  type ReferenceFinderTransport,
} from './referenceFinder/client';
import type { ExtractedSolution, ExtractedStep } from './referenceFinder/extractor';
import {
  arcSamplePoints,
  arcThroughPoints,
  type DiagramArc,
} from './stepDiagramGeometry';
import {
  DEFAULT_DATABASE_SETTINGS,
  type ReferenceFinderDatabaseSettings,
  type ReferenceFinderQuerySettings,
} from './referenceFinder/protocol';
import type { RawSolution, RfPoint } from './referenceFinder/solution';
import {
  clearReferencesResults,
  referencesResultsSnapshot,
  setReferencesFrames,
  setReferencesPendingTarget,
  setReferencesResults,
  subscribeReferencesResults,
  type ReferencesCandidateResult,
  type ReferencesModelStep,
  type ReferencesOriginals,
  type ReferencesResults,
  type ReferencesTargetRecord,
} from './referencesResults';
import {
  beginReferencesPick,
  beginReferencesRun,
  endReferencesRun,
  stopWindowQuery,
  referencesPickGeneration,
  referencesRunSnapshot,
} from './referencesRun';
import { referencesSidebarWarnings, refusalMessageFor } from './referencesSidebarText';
import { candidateStepCount, clampCandidateStep } from './referencesCandidateSteps';
import { shownCandidates } from './referencesShownCandidates';
import type { ReferencesPick } from './referencesViewGeometry';
import {
  collinearSegments,
  componentForSegment,
  componentForVertex,
  findSegmentByEndpoints,
  paperFallbackRect,
  precreaseInputFromTransport,
  segmentEndpoints,
  type PrecreaseComponent,
  type PrecreaseFrame,
  type PrecreaseRfRect,
  type SheetAnalysis,
} from './sheetFrames';
import type { ReferencesViewState } from './useReferencesView';

/**
 * Upstream's `goodEnoughError` when approximate answers are wanted. At this the
 * core sorts a close approximation above an exact solution of higher rank, so
 * it is opt-in (plan decision D8).
 */
const APPROXIMATE_GOOD_ENOUGH_ERROR = 0.005;
const EXACT_GOOD_ENOUGH_ERROR = 1e-9;

/** What the picked target was, for analytics; `whole_cp` is Phase 5's. */
type TargetKind = 'vertex' | 'crease';

/**
 * The References workspace's target: what was picked, what ReferenceFinder said
 * about it, and the navigation through the answer.
 *
 * The one hook that talks to both workers. It retains the precrease bridge on
 * mount (the frames it computes are what turn a picked model point into a sheet
 * coordinate and a candidate's sheet lines back into model space), releases it
 * and the ReferenceFinder window instance on unmount, and keeps every result
 * keyed on the document revision so an edit marks it stale — never recomputed
 * on its own; Recompute is a button.
 */
export interface ReferencesTargetController {
  target: ReferencesTarget | null;
  candidates: readonly ReferencesCandidate[] | null;
  /** The construction behind the cards, when it describes the current geometry. */
  results: ReferencesResults | null;
  /**
   * What was picked, for the geometry on screen — available from the pick
   * onwards, so the canvas can mark the crease before (and without) an answer.
   */
  picked: ReferencesTargetRecord | null;
  frames: SheetAnalysis | null;
  /** The results were computed for an earlier revision of the pattern. */
  stale: boolean;
  activeCandidate: number;
  activeStep: number;
  active: ReferencesCandidateResult | null;
  stepCount: number;
  /** Things worth knowing that did not stop the analysis (the paper fallback, refused sheets). */
  warnings: string[];
  pick: (hit: ReferencesPick | null) => void;
  clear: () => void;
  recompute: () => void;
  selectCandidate: (index: number) => void;
  selectStep: (index: number) => void;
  nextStep: () => void;
  previousStep: () => void;
  nextCandidate: () => void;
  previousCandidate: () => void;
}

function databaseFor(rect: PrecreaseRfRect): ReferenceFinderDatabaseSettings {
  return { ...DEFAULT_DATABASE_SETTINGS, width: rect.width, height: rect.height };
}

/**
 * A transport over the window instance that also hands back the core's raw
 * answers, which the client's extracted solutions no longer carry and the
 * sidebar's diagrams need. A fresh client (and cache) per query, so the raw
 * list is always the one the extracted list came from.
 */
function recordingTransport(
  database: ReferenceFinderDatabaseSettings
): ReferenceFinderTransport & { raw: RawSolution[] } {
  const transport = {
    raw: [] as RawSolution[],
    async solvePoint(x: number, y: number, query: ReferenceFinderQuerySettings) {
      const raw = await getReferenceFinderClient('window', database).solvePoint(x, y, query);
      transport.raw = raw;
      return raw;
    },
    async solveLine(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      query: ReferenceFinderQuerySettings
    ) {
      const raw = await getReferenceFinderClient('window', database).solveLine(x1, y1, x2, y2, query);
      transport.raw = raw;
      return raw;
    },
  };
  return transport;
}

/** The sheet's own references in ReferenceFinder coordinates, by the core's names. */
function rfOriginals(rect: PrecreaseRfRect): { lines: [string, RfPoint, RfPoint][]; marks: [string, RfPoint][] } {
  const { width: w, height: h } = rect;
  return {
    lines: [
      ['s', [0, 0], [w, 0]],
      ['n', [0, h], [w, h]],
      ['w', [0, 0], [0, h]],
      ['e', [w, 0], [w, h]],
      ['sw_ne', [0, 0], [w, h]],
      ['nw_se', [0, h], [w, 0]],
    ],
    marks: [
      ['sw', [0, 0]],
      ['se', [w, 0]],
      ['nw', [0, h]],
      ['ne', [w, h]],
    ],
  };
}

/**
 * ReferenceFinder's own arrow for a step, if its diagram draws one.
 *
 * O1 and O4 draw none — nothing is brought onto anything — and the core emits
 * the arc as a plain element among the rest, so this looks for it rather than
 * assuming a position.
 */
function stepArc(raw: RawSolution | undefined, step: ExtractedStep): DiagramArc | null {
  if (!raw || step.diagramIndex === null) return null;
  const diagram = raw.diagrams[step.diagramIndex];
  for (const element of diagram ?? []) {
    const e = element as unknown as Record<string, unknown>;
    if (e.type !== 2) continue;
    const at = (v: unknown) => (Array.isArray(v) ? ([v[0], v[1]] as [number, number]) : null);
    const center = at(e.center);
    if (!center || typeof e.radius !== 'number') continue;
    return {
      center,
      radius: e.radius,
      from: Number(e.from),
      to: Number(e.to),
      ccw: Boolean(e.ccw),
    };
  }
  return null;
}

/**
 * Map every sheet point a set of solutions mentions into model space in one
 * bridge call: each step's line chord or mark and its arrow, then the sheet's
 * own references.
 *
 * The request and the read-back below are one positional contract — anything
 * pushed has to be taken back in the same order — which is why the arc's three
 * samples go in immediately after their own step's points.
 */
async function mapSolutionsToModel(
  frame: PrecreaseFrame,
  rect: PrecreaseRfRect,
  solutions: readonly ExtractedSolution[],
  raws: readonly (RawSolution | undefined)[]
): Promise<{ modelSteps: ReferencesModelStep[][]; originals: ReferencesOriginals }> {
  const coords: number[] = [];
  const push = (p: RfPoint) => {
    coords.push(p[0], p[1]);
  };
  // An arc is not a point, and no point map moves a centre or an angle. Three
  // points on it are, and the frame map is a similarity, so a circle's image is
  // a circle and the three images determine it exactly.
  const arcs = solutions.map((solution, s) =>
    solution.steps.map((step) => stepArc(raws[s], step))
  );
  for (const [s, solution] of solutions.entries()) {
    for (const [i, step] of solution.steps.entries()) {
      if (step.line) {
        push(step.line.a);
        push(step.line.b);
      } else if (step.point) {
        push(step.point);
      }
      const arc = arcs[s][i];
      if (arc) for (const sample of arcSamplePoints(arc)) push(sample);
    }
  }
  const originals = rfOriginals(rect);
  for (const [, a, b] of originals.lines) {
    push(a);
    push(b);
  }
  for (const [, p] of originals.marks) push(p);

  const mapped = await getPrecreaseClient().rfToModelMany(frame, Float64Array.from(coords));
  let cursor = 0;
  const next = (): Point => {
    const point = { x: mapped[cursor], y: mapped[cursor + 1] };
    cursor += 2;
    return point;
  };
  const modelSteps = solutions.map((solution, s) =>
    solution.steps.map((step, i): ReferencesModelStep => {
      const mapped: ReferencesModelStep = step.line
        ? { line: { a: next(), b: next() } }
        : step.point
          ? { point: next() }
          : {};
      if (arcs[s][i]) {
        const [from, middle, to] = [next(), next(), next()];
        const arc = arcThroughPoints([from.x, from.y], [middle.x, middle.y], [to.x, to.y]);
        // Null only for three collinear samples, which is a degenerate arc and
        // has no arrow to draw.
        if (arc) mapped.arc = arc;
      }
      return mapped;
    })
  );
  const lines: ReferencesOriginals['lines'] = {};
  for (const [name] of originals.lines) lines[name] = { a: next(), b: next() };
  const marks: ReferencesOriginals['marks'] = {};
  for (const [name] of originals.marks) marks[name] = next();
  return { modelSteps, originals: { lines, marks } };
}

function summarize(solution: ExtractedSolution): ReferencesCandidate {
  return {
    rank: solution.rank,
    foldCount: solution.foldCount,
    stepCount: candidateStepCount(solution),
    err: solution.err,
    exact: solution.exact,
  };
}

function asRfPoint(pair: readonly [number, number]): RfPoint {
  return [pair[0], pair[1]];
}

/**
 * What a query is about, as the resolver wants it: a vertex by its coordinates
 * (never by draw index — Recompute has no index to give), a crease by its
 * 1-based id in the geometry being asked about.
 */
type TargetRequest = { kind: 'vertex'; point: Point } | { kind: 'line'; id: number };

export function useReferencesTarget(view: ReferencesViewState): ReferencesTargetController {
  const { t } = useTranslation();
  const { geometry, hasDocument, revision } = view;

  const target = useWorkspaceStore((state) => state.referencesTarget);
  const candidates = useWorkspaceStore((state) => state.referencesCandidates);
  const viewState = useWorkspaceStore((state) => state.referencesView);
  const run = useWorkspaceStore((state) => state.referencesRun);
  const settings = useWorkspaceStore((state) => state.referencesSettings);
  const setReferencesTarget = useWorkspaceStore((state) => state.setReferencesTarget);
  const setReferencesCandidates = useWorkspaceStore((state) => state.setReferencesCandidates);
  const setReferencesView = useWorkspaceStore((state) => state.setReferencesView);
  const setReferencesRun = useWorkspaceStore((state) => state.setReferencesRun);

  const side = useSyncExternalStore(subscribeReferencesResults, referencesResultsSnapshot);
  const frames = side.frames?.revision === revision ? side.frames.analysis : null;
  const results = side.results;
  const current = results !== null && results.revision === revision;
  const stale = results !== null && !current;
  // The pick, for the geometry on screen: the answered target when there is a
  // current answer, otherwise the record published at pick time.
  const picked: ReferencesTargetRecord | null = current
    ? (results?.target ?? null)
    : side.pending?.revision === revision
      ? side.pending.record
      : null;

  // The latest values the async flows read after an await. Store reads after an
  // await must name what they are about; these refs are how the flows know
  // whether the document they answered for is still the one on screen.
  const revisionRef = useRef(revision);
  const geometryRef = useRef(geometry);
  const settingsRef = useRef(settings);
  useEffect(() => {
    revisionRef.current = revision;
    geometryRef.current = geometry;
    settingsRef.current = settings;
  });

  // Workers: the planner bridge is retained for the panel's life, the
  // ReferenceFinder window instance is spawned by the first query and killed
  // on leaving (plan D7: the only cancel is terminate).
  //
  // The generation bump comes *first*, and is load-bearing. Releasing either
  // worker rejects whatever it is running with the same envelope a crash would
  // produce — `lostError` does not carry the reason — so nothing downstream can
  // tell a deliberate teardown from a failure except a flag the releaser sets.
  // Without it, switching to Edit mid-query reported an ordinary navigation to
  // Sentry and left a red "References unavailable" overlay waiting for the next
  // visit. Resetting the run has to happen here too rather than in the
  // rejection handler: the `await` continuations are microtasks, so they run
  // strictly after this cleanup returns.
  useEffect(() => {
    retainPrecreaseClient();
    return () => {
      beginReferencesPick();
      endReferencesRun(referencesRunSnapshot().runId);
      setReferencesRun({ status: 'idle' });
      releasePrecreaseClient();
      releaseReferenceFinderClient('window');
    };
  }, [setReferencesRun]);

  // Frames: recomputed on mount and on every revision (cheap), and the first
  // sheet's ReferenceFinder database warmed so the first pick does not pay for
  // the build. Results are *not* recomputed here — that is Recompute's job.
  //
  // Keyed on `revision`, deliberately *not* on the transport's identity: the
  // kernel returns a fresh transport object after every command, including the
  // selection-only ones that leave the creases byte-identical, and re-running
  // `sheetFrames` for those was a worker round trip per box-select. The
  // geometry is read through its ref, which this render has already updated.
  useEffect(() => {
    const geometry = geometryRef.current;
    if (!geometry) {
      setReferencesFrames(null);
      return;
    }
    let cancelled = false;
    const input = precreaseInputFromTransport(geometry);
    getPrecreaseClient()
      .sheetFrames(input.segments, input.colors, paperFallbackRect())
      .then((analysis) => {
        if (cancelled) return;
        setReferencesFrames({ revision, analysis });
        const sheet = analysis.components.find((component) => component.rf_rect);
        if (sheet?.rf_rect) {
          getReferenceFinderClient('window', databaseFor(sheet.rf_rect))
            .ready()
            .catch(() => undefined);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        reportError(error, { surface: 'references:frames' });
        setReferencesFrames(null);
        setReferencesRun({ status: 'error', message: humanizeError(error, t) });
      });
    return () => {
      cancelled = true;
    };
  }, [revision, setReferencesRun, t]);

  // Staleness: results for another revision are marked, never replaced.
  useEffect(() => {
    if (!hasDocument) {
      if (target) setReferencesTarget(null);
      if (candidates) setReferencesCandidates(null);
      clearReferencesResults();
      if (run.status !== 'idle') setReferencesRun({ status: 'idle' });
      return;
    }
    if (stale && run.status !== 'running' && run.status !== 'stopping' && run.status !== 'stale') {
      setReferencesRun({ status: 'stale' });
    }
  }, [
    hasDocument,
    stale,
    run.status,
    target,
    candidates,
    setReferencesTarget,
    setReferencesCandidates,
    setReferencesRun,
  ]);

  const refusalMessage = useCallback(
    (component: PrecreaseComponent): string => refusalMessageFor(t, component),
    [t]
  );

  /**
   * Dismiss the pick, and with it any query still resolving for it.
   *
   * The generation bump is what makes the dismissal stick: `query()` spends its
   * first hundreds of ms in `framesFor` and `resolve` with the registry still
   * idle, so without it the flow simply resumed past its awaits and re-published
   * the pick the user had just dismissed. The worker call itself is *not*
   * cancelled — `requestReferencesStop` would throw away a 2-6 s database build
   * for a pick that may be re-made a second later — its answer is just dropped.
   */
  const clear = useCallback(() => {
    beginReferencesPick();
    endReferencesRun(referencesRunSnapshot().runId);
    setReferencesTarget(null);
    setReferencesCandidates(null);
    setReferencesResults(null);
    setReferencesPendingTarget(null);
    setReferencesView({ activeCandidate: 0, activeStep: 0 });
    setReferencesRun({ status: 'idle' });
  }, [setReferencesCandidates, setReferencesRun, setReferencesTarget, setReferencesView]);

  /**
   * Whether the answer this flow is about to publish is still wanted: the
   * document has not moved, the run has not been superseded, and the pick has
   * not been dismissed or replaced. All three are read after an await, so all
   * three are read from a ref or a module snapshot rather than from a closure.
   */
  const superseded = useCallback(
    (forRevision: string, runId: number, generation: number) =>
      revisionRef.current !== forRevision ||
      referencesRunSnapshot().runId !== runId ||
      referencesPickGeneration() !== generation,
    []
  );

  /**
   * Ask ReferenceFinder about `record` on `component`'s sheet, then map the
   * answer into model space and publish it — unless the document moved on
   * while the worker was busy, in which case the answer is dropped.
   */
  const runQuery = useCallback(
    async (
      record: ReferencesTargetRecord,
      component: PrecreaseComponent,
      forRevision: string,
      generation: number
    ) => {
      const frame = component.frame;
      const rect = component.rf_rect;
      if (!frame || !rect) return;
      const runId = beginReferencesRun(stopWindowQuery);
      setReferencesRun({ status: 'running', startedAt: Date.now() });
      setReferencesCandidates(null);
      setReferencesResults(null);
      const started = performance.now();
      const kind: TargetKind = record.kind;
      const database = databaseFor(rect);
      const transport = recordingTransport(database);
      const { candidateCount, includeApproximate } = settingsRef.current;
      const client = createReferenceFinderClient({
        transport,
        database,
        query: {
          goodEnoughError: includeApproximate ? APPROXIMATE_GOOD_ENOUGH_ERROR : EXACT_GOOD_ENOUGH_ERROR,
          count: candidateCount,
          worstCase: 1,
        },
      });
      const durationBucket = () =>
        bucketCount(Math.round(performance.now() - started), DURATION_MS_BUCKETS);

      let solutions: readonly ExtractedSolution[];
      try {
        solutions = await whileReferenceFinderClientAlive(
          'window',
          // Scoped to *this* sheet's database: another sheet's idle teardown or
          // eviction is not this query's problem.
          client.databaseKey,
          record.kind === 'vertex'
            ? client.solvePoint(record.rf)
            : client.solveLine(record.rf[0], record.rf[1])
        );
      } catch (error) {
        const wasStopping = referencesRunSnapshot().stopping;
        endReferencesRun(runId);
        // A superseded, dismissed or unmounted flow is a cancellation, not a
        // failure: no Sentry event, no error overlay, and — for parity with the
        // Stop branch below, which returns before it — no `outcome: 'error'`.
        if (superseded(forRevision, runId, generation)) return;
        if (wasStopping) {
          setReferencesRun({ status: 'idle' });
          return;
        }
        reportError(error, { surface: 'references:query' });
        setReferencesRun({ status: 'error', message: humanizeError(error, t) });
        track(ANALYTICS_EVENTS.referenceQueryCompleted, {
          target_kind: kind,
          outcome: 'error',
          duration_bucket: durationBucket(),
        });
        return;
      }

      if (superseded(forRevision, runId, generation)) {
        // The document changed under the query, a newer pick superseded it, or
        // the pick was dismissed.
        endReferencesRun(runId);
        return;
      }

      // ReferenceFinder answers from the bare sheet, and that is the ranking
      // shown: a construction for one crease, on its own. The core's raw
      // output is parallel to the extracted list. Without approximate
      // solutions asked for, the near misses after an exact answer are not
      // listed (`referencesShownCandidates`).
      const shown = shownCandidates(solutions, includeApproximate);
      solutions = shown.map((index) => solutions[index]);
      const raws = shown.map((index) => transport.raw[index]);

      try {
        const { modelSteps, originals } = await whilePrecreaseClientAlive(
          mapSolutionsToModel(frame, rect, solutions, raws)
        );
        if (superseded(forRevision, runId, generation)) {
          endReferencesRun(runId);
          return;
        }
        const mapped: ReferencesCandidateResult[] = solutions.map((solution, i) => ({
          solution,
          raw: raws[i],
          modelSteps: modelSteps[i],
        }));
        setReferencesResults({
          revision: forRevision,
          target: record,
          frame,
          originals,
          candidates: mapped,
          durationMs: performance.now() - started,
        });
        setReferencesPendingTarget(null);
        setReferencesCandidates(solutions.map(summarize));
        setReferencesView({ activeCandidate: 0, activeStep: 0 });
        setReferencesRun({ status: 'idle' });
        endReferencesRun(runId);
        track(ANALYTICS_EVENTS.referenceQueryCompleted, {
          target_kind: kind,
          outcome: solutions.some((s) => s.exact)
            ? 'exact'
            : solutions.length > 0
              ? 'approximate'
              : 'none',
          duration_bucket: durationBucket(),
        });
        if (solutions.length > 0) {
          track(ANALYTICS_EVENTS.foldingStepsOpened, { target_kind: kind });
        }
      } catch (error) {
        endReferencesRun(runId);
        if (superseded(forRevision, runId, generation)) return;
        reportError(error, { surface: 'references:map' });
        setReferencesRun({ status: 'error', message: humanizeError(error, t) });
      }
    },
    [setReferencesCandidates, setReferencesRun, setReferencesView, superseded, t]
  );

  /** The frames for `forRevision`, from the side table or computed now. */
  const framesFor = useCallback(
    async (geometry: CpGeometryTransport, forRevision: string): Promise<SheetAnalysis> => {
      const known = referencesResultsSnapshot().frames;
      if (known && known.revision === forRevision) return known.analysis;
      const input = precreaseInputFromTransport(geometry);
      const analysis = await getPrecreaseClient().sheetFrames(
        input.segments,
        input.colors,
        paperFallbackRect()
      );
      if (revisionRef.current === forRevision) setReferencesFrames({ revision: forRevision, analysis });
      return analysis;
    },
    []
  );

  /**
   * Resolve a pick against the geometry and frames into a target record, or
   * the message saying why it cannot be. Keyed on coordinates for a vertex and
   * on endpoints for a crease, so Recompute can find the same thing again.
   */
  const resolve = useCallback(
    async (
      hit: TargetRequest,
      geometry: CpGeometryTransport,
      analysis: SheetAnalysis
    ): Promise<
      | { ok: true; record: ReferencesTargetRecord; component: PrecreaseComponent }
      | { ok: false; message: string }
    > => {
      const component =
        hit.kind === 'line'
          ? componentForSegment(analysis, hit.id - 1)
          : componentForVertex(analysis, geometry, hit.point);
      if (!component) {
        return {
          ok: false,
          message: t('panels:references.outsideSheet', 'This pick is not inside any sheet.'),
        };
      }
      if (!component.frame || !component.rf_rect) {
        return { ok: false, message: refusalMessage(component) };
      }
      const frame = component.frame;
      const client = getPrecreaseClient();
      if (hit.kind === 'vertex') {
        const rf = await client.modelToRf(frame, hit.point.x, hit.point.y);
        return {
          ok: true,
          component,
          record: { kind: 'vertex', component: component.id, point: hit.point, rf: asRfPoint(rf) },
        };
      }
      const segmentIndex = hit.id - 1;
      const endpoints = segmentEndpoints(geometry, segmentIndex);
      if (!endpoints) {
        return {
          ok: false,
          message: t('panels:references.targetGone', 'The picked crease is no longer in the pattern.'),
        };
      }
      const [a, b] = await Promise.all([
        client.modelToRf(frame, endpoints.a.x, endpoints.a.y),
        client.modelToRf(frame, endpoints.b.x, endpoints.b.y),
      ]);
      return {
        ok: true,
        component,
        record: {
          kind: 'crease',
          component: component.id,
          lineId: hit.id,
          a: endpoints.a,
          b: endpoints.b,
          cpLineIds: collinearSegments(component, segmentIndex).map((i) => i + 1),
          rf: [asRfPoint(a), asRfPoint(b)],
        },
      };
    },
    [refusalMessage, t]
  );

  const query = useCallback(
    async (hit: TargetRequest, forRevision: string, fromPick: boolean) => {
      const geometry = geometryRef.current;
      if (!geometry) return;
      // Captured before the first await: `framesFor` and `resolve` both run
      // with the registry still idle, so this is the only thing that can tell a
      // dismissal in that window from a query nobody touched.
      const generation = referencesPickGeneration();
      const abandoned = () =>
        revisionRef.current !== forRevision || referencesPickGeneration() !== generation;
      try {
        const analysis = await framesFor(geometry, forRevision);
        if (abandoned()) return;
        const resolved = await resolve(hit, geometry, analysis);
        if (abandoned()) return;
        if (!resolved.ok) {
          setReferencesTarget(null);
          setReferencesCandidates(null);
          setReferencesResults(null);
          setReferencesPendingTarget(null);
          setReferencesRun({ status: 'error', message: resolved.message });
          return;
        }
        const { record, component } = resolved;
        // Published before the query so the canvas marks the pick during the
        // wait, and keeps marking it if the query errors or is stopped.
        setReferencesPendingTarget({ revision: forRevision, record });
        setReferencesTarget(
          record.kind === 'vertex'
            ? { kind: 'vertex', component: record.component, point: record.point }
            : { kind: 'crease', component: record.component, lineId: record.lineId }
        );
        if (fromPick) track(ANALYTICS_EVENTS.referenceTargetPicked, { target_kind: record.kind });
        await runQuery(record, component, forRevision, generation);
      } catch (error) {
        if (abandoned()) return;
        reportError(error, { surface: 'references:resolve' });
        setReferencesRun({ status: 'error', message: humanizeError(error, t) });
      }
    },
    [framesFor, resolve, runQuery, setReferencesCandidates, setReferencesRun, setReferencesTarget, t]
  );

  const pick = useCallback(
    (hit: ReferencesPick | null) => {
      if (!hit) {
        clear();
        return;
      }
      beginReferencesPick();
      void query(
        hit.kind === 'vertex' ? { kind: 'vertex', point: hit.point } : { kind: 'line', id: hit.id },
        revisionRef.current,
        true
      );
    },
    [clear, query]
  );

  /**
   * Ask again about the same target on the pattern as it is now. A vertex is
   * found by its coordinates, a crease by its endpoints; either gone is a
   * message, not a guess at a neighbour.
   */
  const recompute = useCallback(() => {
    const geometry = geometryRef.current;
    const record = referencesResultsSnapshot().results?.target;
    if (!geometry) return;
    beginReferencesPick();
    if (!record) {
      // No prior answer to repeat (an error cleared it); the store target, if
      // any, cannot be re-run without its coordinates.
      if (target?.kind === 'vertex') {
        void query({ kind: 'vertex', point: target.point }, revisionRef.current, false);
      }
      return;
    }
    if (record.kind === 'vertex') {
      void query({ kind: 'vertex', point: record.point }, revisionRef.current, false);
      return;
    }
    const index = findSegmentByEndpoints(geometry, record.a, record.b);
    if (index < 0) {
      setReferencesRun({
        status: 'error',
        message: t('panels:references.targetGone', 'The picked crease is no longer in the pattern.'),
      });
      setReferencesTarget(null);
      setReferencesCandidates(null);
      setReferencesResults(null);
      setReferencesPendingTarget(null);
      return;
    }
    void query({ kind: 'line', id: index + 1 }, revisionRef.current, false);
  }, [query, setReferencesCandidates, setReferencesRun, setReferencesTarget, t, target]);

  // A setting that shapes the answer — how many candidates, whether inexact
  // ones are listed — asks again about the current target, as Recompute
  // would. Zach: "checking it should probably recompute solutions, right now
  // it doesn't." Keyed on the two values alone, with `recompute` behind a ref,
  // so it runs for a change in them and for nothing else; skipped on mount,
  // where the settings are whatever the store already held; and a no-op with
  // nothing picked, so a toggle in Sequence mode plans nothing.
  const recomputeRef = useRef(recompute);
  useEffect(() => {
    recomputeRef.current = recompute;
  });
  const answerSettings = `${settings.candidateCount}|${settings.includeApproximate}`;
  const seenAnswerSettings = useRef(answerSettings);
  useEffect(() => {
    if (seenAnswerSettings.current === answerSettings) return;
    seenAnswerSettings.current = answerSettings;
    const side = referencesResultsSnapshot();
    const asked =
      side.results !== null ||
      side.pending !== null ||
      useWorkspaceStore.getState().referencesTarget !== null;
    if (asked) recomputeRef.current();
  }, [answerSettings]);

  // --- Navigation -----------------------------------------------------------
  const activeCandidate = current && results ? Math.min(viewState.activeCandidate, Math.max(0, results.candidates.length - 1)) : 0;
  const active = current && results ? (results.candidates[activeCandidate] ?? null) : null;
  // The steps as they are read: the diagonals the answer leans on, then its own.
  const stepCount = candidateStepCount(active?.solution ?? null);
  const activeStep = clampCandidateStep(active?.solution ?? null, viewState.activeStep);

  const selectCandidate = useCallback(
    (index: number) => {
      const count = referencesResultsSnapshot().results?.candidates.length ?? 0;
      if (count === 0) return;
      setReferencesView({ activeCandidate: Math.max(0, Math.min(count - 1, index)), activeStep: 0 });
    },
    [setReferencesView]
  );
  const selectStep = useCallback(
    (index: number) => {
      if (stepCount === 0) return;
      setReferencesView({ activeStep: Math.max(0, Math.min(stepCount - 1, index)) });
    },
    [setReferencesView, stepCount]
  );
  const nextStep = useCallback(() => selectStep(activeStep + 1), [selectStep, activeStep]);
  const previousStep = useCallback(() => selectStep(activeStep - 1), [selectStep, activeStep]);
  const nextCandidate = useCallback(
    () => selectCandidate(activeCandidate + 1),
    [selectCandidate, activeCandidate]
  );
  const previousCandidate = useCallback(
    () => selectCandidate(activeCandidate - 1),
    [selectCandidate, activeCandidate]
  );

  // --- Warnings --------------------------------------------------------------
  const warnings = useMemo(() => referencesSidebarWarnings(t, frames), [frames, t]);

  return {
    target,
    candidates,
    results: current ? results : null,
    picked,
    frames,
    stale,
    activeCandidate,
    activeStep,
    active,
    stepCount,
    warnings,
    pick,
    clear,
    recompute,
    selectCandidate,
    selectStep,
    nextStep,
    previousStep,
    nextCandidate,
    previousCandidate,
  };
}
