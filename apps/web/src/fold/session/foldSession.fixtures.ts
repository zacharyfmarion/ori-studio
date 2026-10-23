/**
 * What the Fold session's tests drive it with: a fake engine that lands
 * labelled states, an in-process runtime that loses its engine the way the
 * worker runtime does, and a document held in memory.
 *
 * The runtime takes any `FoldEngineCalls` — the fake here, or the real bridge
 * in the wasm test — so both run the session over exactly the calls the
 * worker exposes, minus comlink.
 */

import type {
  FoldSequenceClientLossListener,
  FoldSequenceClientLossReason,
} from '../../store/workspaceStore/foldSequenceRuntime';
import type { FoldEngineCrashCause } from '../engine/foldEngineTrap';
import { foldStateFingerprint } from '../document/foldDigest';
import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import { createFoldSequence, SQUARE_PAPER, type FoldIdFactory } from '../document/foldSequenceDocument';
import { appendFoldStep, type FoldStepDraft } from '../document/foldSequenceEdits';
import type { FoldEngineCalls } from '../engine/foldEngineCalls';
import type { FoldEngineCompoundCalls } from '../engine/foldEngineCompoundCalls';
import { previewStep, resolveOrdersWithPreview } from '../engine/foldEnginePreview';
import { axiomRootsWithSections } from '../engine/foldEngineRoots';
import type { FoldCompoundReport } from '../engine/foldEngineCompoundWire';
import type {
  FoldAnalysis,
  FoldEngineOp,
  FoldEngineRefused,
  FoldRefusalBody,
  FoldRefusalCode,
  FoldReport,
  FoldStateSummary,
} from '../engine/foldEngineWire';
import type {
  FoldSessionChannel,
  FoldSessionDocument,
  FoldSessionDocumentSource,
  FoldSessionRuntime,
  FoldSessionWorker,
} from './foldSession';

/** Let every queued promise reaction run, and the timers they set. */
export async function settle(rounds = 5): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// A fake engine

/** `valley@0.25` for a valley along the free line at 0.25; the kind otherwise. */
export function foldOpLabel(op: FoldEngineOp): string {
  return (op.kind === 'valley' || op.kind === 'mountain') && op.line.via === 'free'
    ? `${op.kind}@${op.line.through[0][1]}`
    : op.kind;
}

export interface FakeFoldEngine extends FoldEngineCalls {
  /** Every call, in order: `sheet`, `apply:<label>`, `step:<label>`, `analyse:<label>`, `fingerprint`, `summary`. */
  readonly log: string[];
  /** The labels of the steps that landed a state, the sheet's first. */
  trail(state: number): readonly string[] | undefined;
}

export interface FakeFoldEngineOptions {
  /** A refusal code for a step, or null to land it. */
  refuse?: (op: FoldEngineOp) => FoldRefusalCode | null;
  /** An error to throw for a step, as a broken bridge would. */
  fail?: (op: FoldEngineOp) => { code: string; message: string } | null;
  /** A compound fold's report for a step, landed in place of a plain fold's, as the bridge lands one; null for none. */
  compound?: (op: FoldEngineOp) => FoldCompoundReport | null;
  /** What a plain fold's report changes from the stock one — an unfold's creases, say; null for none. */
  report?: (op: FoldEngineOp) => Partial<FoldReport> | null;
}

const REPORT: FoldReport = {
  line: { n: [0, 1], d: 0.5 },
  side: 'positive',
  snap: { clusters: 0, angle: 0, max_shift: 0 },
  direction: 'valley',
  flaps: [],
  picked: [],
  added: [],
  moving: [0],
  moving_faces: [1],
  created: [4],
  unfolded: [],
  refolded: [],
  split: 1,
};

const ANALYSIS: FoldAnalysis = {
  line: { n: [0, 1], d: 0.5 },
  side: 'positive',
  snap: { clusters: 0, angle: 0, max_shift: 0 },
  direction: 'valley',
  flaps: [{ faces: [0], witness: [0.5, 0.75] }],
  picked: [0],
  added: [],
  moving: [0],
};

/** A refusal's body, with the fields the codes that type them carry. */
function refusalBody(code: FoldRefusalCode): FoldRefusalBody {
  switch (code) {
    case 'closure_adds_flaps':
      return { code, added: [0] };
    case 'near_miss':
      return { code, vertex: 0, distance: 0.0002, cause: 'band' };
    case 'sliver':
      return { code, vertex: 0, face: 0, penetration: 0.0002 };
    // Compound folds' (plan D4), one block per family.
    case 'choice_needed':
      return { code, choice: 'opening' };
    case 'choice_broken':
      return { code, broken: 'opening', opening: 0 };
    case 'reverse_no_opening':
      return { code, faces: [0], cause: 'no_spine' };
    case 'reverse_kind_infeasible':
      return { code, kind: 'inside', faces: [0] };
    case 'reverse_tip_not_free':
      return { code, blocking: [0], faces: [0] };
    case 'crimp_kind_infeasible':
      return { code, kind: 'inside', faces: [0] };
    case 'tuck_infeasible':
      return { code, target: 0, placement: 'under', faces: [0] };
    // The vertex folds'.
    case 'squash_no_flap':
      return { code, faces: [0], cause: 'single_layer' };
    case 'petal_not_precreased':
      return { code, faces: [0], missing: 'line' };
    case 'petal_no_flap':
      return { code, faces: [0], cause: 'no_ends' };
    // The sinks'.
    case 'sink_several_points':
      return { code, flaps: 2, faces: [0, 1] };
    default:
      return { code };
  }
}

/** A query the fake does not model: the session's tests never ask it. */
function notFaked(call: string): never {
  throw { code: 'not_faked', message: `the fake fold engine has no ${call}` };
}

const fingerprintOf = (trail: readonly string[]) =>
  foldStateFingerprint({ keys: trail.map((label, k) => `${k}:${label}`) });

/** States that are the labels of the steps that landed them: a step's state is its path, as the engine's is. */
export function fakeFoldEngine({ refuse, fail, compound, report: plain }: FakeFoldEngineOptions = {}): FakeFoldEngine {
  const states = new Map<number, readonly string[]>();
  const log: string[] = [];
  let next = 0;

  const held = (state: number) => {
    const trail = states.get(state);
    if (!trail) throw { code: 'unknown_state', message: `no state ${state}` };
    return trail;
  };
  const summaryOf = (trail: readonly string[]): FoldStateSummary => ({
    step: trail.length - 1,
    faces: trail.length,
    pairs: trail.length - 1,
    creases: { border: 4, mountain: 0, valley: trail.length - 1, flat: 0 },
    view: { flipped: trail.includes('turn'), rotation: 0 },
    residual: 0,
    sheet: [],
  });
  const land = (trail: readonly string[]) => {
    next += 1;
    states.set(next, trail);
    return next;
  };
  const refused = (code: FoldRefusalCode): FoldEngineRefused => ({
    status: 'refused',
    refusal: refusalBody(code),
    fixes: [{ fix: 'opposite_direction' }],
    faces: [0],
    vertices: [],
  });
  const apply = (state: number, op: FoldEngineOp) => {
    const parent = held(state);
    const failure = fail?.(op);
    if (failure) throw failure;
    const code = refuse?.(op) ?? null;
    if (code) return refused(code);
    const trail = [...parent, foldOpLabel(op)];
    const folded = compound?.(op) ?? null;
    const report = op.kind === 'turn' || op.kind === 'rotate' || folded ? null : { ...REPORT, ...plain?.(op) };
    return {
      status: 'ok' as const,
      state: land(trail),
      report,
      ...(folded ? { compound: folded } : {}),
      summary: summaryOf(trail),
    };
  };

  return {
    log,
    trail: (state) => states.get(state),

    sheet(paper) {
      log.push('sheet');
      const trail = [`sheet:${paper.shape.kind}:${paper.startSide ?? 'front'}`];
      return { status: 'ok', state: land(trail), summary: summaryOf(trail), fingerprint: fingerprintOf(trail) };
    },

    analyse(state, op) {
      log.push(`analyse:${foldOpLabel(op)}`);
      held(state);
      const code = refuse?.(op) ?? null;
      return code ? refused(code) : { status: 'ok', analysis: ANALYSIS };
    },

    apply(state, op) {
      log.push(`apply:${foldOpLabel(op)}`);
      return apply(state, op);
    },

    step(state, op) {
      log.push(`step:${foldOpLabel(op)}`);
      const landed = apply(state, op);
      return landed.status === 'ok' ? { ...landed, fingerprint: fingerprintOf(held(landed.state)) } : landed;
    },

    returnTo(current, target, history) {
      held(current); history.forEach(held);
      const trail = [...held(target), 'return'];
      return { status: 'ok', state: land(trail), report: null, summary: summaryOf(trail), fingerprint: fingerprintOf(trail) };
    },

    summary(state) {
      log.push('summary');
      return summaryOf(held(state));
    },

    fingerprint(state) {
      log.push('fingerprint');
      return fingerprintOf(held(state));
    },

    release(handles) {
      let count = 0;
      for (const state of handles) if (states.delete(state)) count += 1;
      return count;
    },

    clear() {
      states.clear();
    },

    live: () => states.size,

    action: () => notFaked('action'),
    depthChoices: () => notFaked('depthChoices'),
    crossSection: () => notFaked('crossSection'),
    axiomCandidates: () => notFaked('axiomCandidates'),
    stepSummary: () => notFaked('stepSummary'),
    stepAction: () => notFaked('stepAction'),
    scene: () => notFaked('scene'),
    landmarks: () => notFaked('landmarks'),
    topVisibleAt: () => notFaked('topVisibleAt'),
    defaultPinchLength: () => notFaked('defaultPinchLength'),
  };
}

// ---------------------------------------------------------------------------
// An in-process runtime

export interface InProcessFoldRuntime extends FoldSessionRuntime {
  /** The engine answering now. */
  engine(): FoldEngineCalls;
  /**
   * Lose the engine, as `foldSequenceRuntime`'s `dropWorker` does: the
   * generation moves, the listeners hear why, the calls under way reject as
   * `fold_sequence_client_lost`, and a fresh engine answers from then on.
   * A crash says what crashed it, `worker_error` unless told.
   */
  lose(reason: FoldSequenceClientLossReason, cause?: FoldEngineCrashCause): void;
  /** Hold every call until {@link InProcessFoldRuntime.open}. */
  hold(): void;
  /** Let the held calls go, and what follows settle. */
  open(): Promise<void>;
  /** References held. */
  holders(): number;
}

/** The engine's calls as the worker exposes them, minus comlink. */
function workerOver(calls: FoldEngineCalls, version: number): FoldSessionWorker {
  const worker = {
    engineVersion: async () => version,
    sheet: async (paper) => calls.sheet(paper),
    // An axiom's root is a choice: dropped, the engine refuses the analysis (`root_missing`), as the worker never does.
    analyse: async (state, op, choices) => calls.analyse(state, op, choices),
    apply: async (state, op, choices) => calls.apply(state, op, choices),
    previewStep: async (state, op, choices, wants) => previewStep(calls, state, op, choices, wants),
    axiomRoots: async (state, line, hint) => axiomRootsWithSections(calls, state, line, hint),
    resolveOrders: async (state, op, choices, query, _search, wants) => {
      const { orderSelection } = calls as Partial<FoldEngineCompoundCalls>;
      return resolveOrdersWithPreview(
        calls,
        () => (orderSelection ? orderSelection(state, op, choices, query) : notFaked('orderSelection')),
        state,
        op,
        choices,
        wants
      );
    },
    step: async (state, op, choices) => calls.step(state, op, choices),
    returnTo: async (current, target, history) => calls.returnTo(current, target, history),
    summary: async (state) => calls.summary(state),
    fingerprint: async (state) => calls.fingerprint(state),
    release: async (states) => calls.release(states),
    clear: async () => calls.clear(),
    live: async () => calls.live(),
    // The queries a surface asks of a landed state.
    action: async (state, op, choices) => calls.action(state, op, choices),
    depthChoices: async (state, op, at, choices) => calls.depthChoices(state, op, at, choices),
    crossSection: async (state, line, side) => calls.crossSection(state, line, side),
    axiomCandidates: async (state, line) => calls.axiomCandidates(state, line),
    stepSummary: async (state) => calls.stepSummary(state),
    stepAction: async (state) => calls.stepAction(state),
    scene: async (state) => calls.scene(state),
    landmarks: async (state, marks) => calls.landmarks(state, marks),
    topVisibleAt: async (state, at) => calls.topVisibleAt(state, at),
    defaultPinchLength: async (state) => calls.defaultPinchLength(state),
  } satisfies Partial<FoldSessionWorker>;
  // Any other call the engine has — the queries, Import CP's and the
  // exports', when a test hands in an engine that has them — passes through
  // as the worker would expose it, asynchronously.
  const passed: Record<string, unknown> = {};
  for (const [name, call] of Object.entries(calls)) {
    if (typeof call !== 'function' || name in worker) continue;
    passed[name] = async (...args: unknown[]) => (call as (...given: unknown[]) => unknown)(...args);
  }
  return { ...passed, ...worker } as FoldSessionWorker;
}

export function inProcessFoldRuntime(makeEngine: () => FoldEngineCalls, version = 1): InProcessFoldRuntime {
  let generation = 0;
  let engine = makeEngine();
  let references = 0;
  let holding = false;
  let gates: (() => void)[] = [];
  const listeners = new Set<FoldSequenceClientLossListener>();
  const underWay = new Set<(error: unknown) => void>();

  const ask = <T>(call: (worker: FoldSessionWorker) => Promise<T>): Promise<T> => {
    if (references === 0) return Promise.reject(new Error('retain the fold engine client before using it'));
    const asked = { engine, generation };
    return new Promise<T>((resolve, reject) => {
      underWay.add(reject);
      const run = () => {
        // Lost while held: already rejected.
        if (asked.generation !== generation) return;
        call(workerOver(asked.engine, version))
          .then(resolve, reject)
          .finally(() => underWay.delete(reject));
      };
      if (holding) gates.push(run);
      else run();
    });
  };

  const lose = (reason: FoldSequenceClientLossReason, cause?: FoldEngineCrashCause) => {
    generation += 1;
    engine = makeEngine();
    gates = [];
    const crash = reason === 'crashed' ? (cause ?? 'worker_error') : undefined;
    // The runtime's order: its listeners first, then the calls it took with it.
    for (const listener of [...listeners]) listener(reason, crash);
    const lost = { code: 'fold_sequence_client_lost', message: `The fold engine was ${reason}.` };
    for (const reject of [...underWay]) reject(lost);
    underWay.clear();
  };

  const channel = (): FoldSessionChannel => {
    let latest = 0;
    return {
      request: (call, discard) => {
        const ticket = ++latest;
        return ask(call).then(
          (value) => {
            if (ticket === latest) return { status: 'answered', value };
            discard?.(value);
            return { status: 'superseded' };
          },
          (error: unknown) => {
            if (ticket === latest) throw error;
            return { status: 'superseded' };
          }
        );
      },
      cancel: () => {
        latest += 1;
      },
    };
  };

  return {
    retain: () => {
      references += 1;
    },
    release: () => {
      references = Math.max(0, references - 1);
      if (references === 0) lose('released');
    },
    generation: () => generation,
    onLost: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ask,
    createChannel: channel,
    source: {
      generation: () => generation,
      sheet: (paper) => ask((worker) => worker.sheet(paper)),
      step: (state, op, choices) => ask((worker) => worker.step(state, op, choices)),
      returnTo: (current, target, history) => ask((worker) => worker.returnTo(current, target, history)),
      release: (states) => ask((worker) => worker.release([...states])),
    },
    engine: () => engine,
    lose,
    hold: () => {
      holding = true;
    },
    open: async () => {
      holding = false;
      for (let round = 0; round < 20; round += 1) {
        for (const run of gates.splice(0)) run();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
    holders: () => references,
  };
}

// ---------------------------------------------------------------------------
// A document in memory

export interface MemoryFoldDocument extends FoldSessionDocumentSource {
  /** Replace what `read` returns, and tell the subscribers. */
  set(next: Partial<FoldSessionDocument>): void;
  /** Every draft committed, in order. */
  readonly commits: FoldStepDraft[];
}

/**
 * The shown sequence, held as the slice holds it. A commit appends under its
 * parent — creating the sequence for the first — and puts the cursor on the
 * new step, as `commitFoldStep` does.
 */
export function memoryFoldDocument(
  initial: Partial<FoldSessionDocument> = {},
  newId: FoldIdFactory = (prefix) => `${prefix}-${Math.random().toString(36).slice(2)}`
): MemoryFoldDocument {
  let value: FoldSessionDocument = { loadId: 1, held: null, reader: null, ...initial };
  const listeners = new Set<() => void>();
  const commits: FoldStepDraft[] = [];
  const set = (next: Partial<FoldSessionDocument>) => {
    value = { ...value, ...next };
    for (const listener of [...listeners]) listener();
  };
  return {
    read: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set,
    commits,
    commit: (draft, loadId) => {
      if (loadId !== value.loadId || value.held?.readOnlyRaw) return null;
      const document = value.held?.document ?? createFoldSequence(SQUARE_PAPER, '', newId);
      const appended = appendFoldStep(document, draft, newId);
      if (!appended) return null;
      commits.push(draft);
      const reader = value.reader?.sequenceId === document.id ? value.reader : initialFoldReaderState(document.id);
      set({
        held: { document: appended.document, readOnlyRaw: null },
        reader: withFoldCursor(reader, appended.document, appended.id),
      });
      return appended.id;
    },
  };
}
