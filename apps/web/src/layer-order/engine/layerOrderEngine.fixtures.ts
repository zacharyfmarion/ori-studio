/**
 * A Layer order engine with no wasm, for tests: a backend that answers the
 * contract over a toy figure, and a worker that runs the real worker shell
 * (`workers/layerOrderWorkerApi.ts`) through comlink over any backend, this
 * one or the real one over the bridge, so a runtime test exercises
 * everything but the `Worker` itself.
 *
 * **The toy figure** stacks every face on one spot. Its creases force some
 * pairs; the rest are open. An order is the one stack, and the fitting order
 * closest to the one on screen keeps each face where it was unless a face
 * that must be above it is not, which then moves just above it. That is
 * enough to give every verdict E5 gives, by the same rules: a pair asked both
 * ways is `opposed`, a pair against the creases is `forced`, a cycle is a
 * `conflict`; with no nodes, an answer that needs a search (one that would
 * move the order) times out, while one that deduction settles does not; a
 * constraint that is no question throws, as the bridge does. A fit keeps its
 * preview for Add by token, as E5 does. It has a paper scene (each face a
 * square on the crease pattern, all folded onto one).
 *
 * **Its solutions** are counted by brute force over every order of the one
 * stack, in lexicographic order, a slice at a time: each slice reads
 * `maxNodes` orders (at least one), so a test sets how many slices a count
 * takes. The cursor, its epoch and its staleness follow E6's and the bridge
 * backend's rules: started by the first slice, step or position, started
 * again by a commit that committed, a restore or an open; kept by a step.
 *
 * **Control.** Calls are answered one at a time, in the order they arrive,
 * as a worker's synchronous bridge calls are. Every call is logged
 * ({@link FakeLayerOrderBackend.calls}) when its turn comes;
 * {@link FakeLayerOrderBackend.hold} keeps the next answer of a call back
 * until the test releases it, and every call behind it waits too;
 * {@link FakeLayerOrderBackend.trapNext} makes
 * the next one fail as a trapped wasm call does. {@link InProcessLayerOrderWorker}
 * delivers messages a task later, as a worker does, and can die
 * ({@link InProcessLayerOrderWorker.crash}).
 */
import { expose, type Endpoint } from 'comlink';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import {
  encodeLayerOrderRecord,
  type LayerOrderFace,
  type LayerOrderPair,
  type LayerOrderRecord,
} from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import {
  createLayerOrderWorkerApi,
  type LayerOrderBackend,
  type LayerOrderBackendLoader,
} from '../../workers/layerOrderWorkerApi';
import type { LayerFace } from './faceIndex';
import {
  LAYER_ORDER_CALL_FAILURES,
  SAVED_FACE_GONE,
  SAVED_FACE_INTACT,
  SAVED_PAIR_KEPT,
  type LayerCantFit,
  type LayerCarriedRow,
  type LayerChangedSpots,
  type LayerCommitted,
  type LayerConstraint,
  type LayerExplained,
  type LayerOpenedOn,
  type LayerOrderEngine,
  type LayerOrderLimits,
  type LayerOrderOpened,
  type LayerPosition,
  type LayerPreviewed,
  type LayerSavedConstraintStatus,
  type LayerSide,
  type LayerSolutionCount,
  type LayerStacks,
  type LayerStepBy,
  type LayerTimedOut,
} from './layerOrderEngine';

// ---------------------------------------------------------------------------
// The toy figure

export interface FakeLayerOrderFigure {
  /** Where each face lies on the crease pattern: the centre of its square. */
  readonly facePoints: readonly (readonly [number, number])[];
  /** Per face, whether it shows its front from the front side. */
  readonly frontUp: readonly boolean[];
  /** The first order, top first from the front: every face, on one spot. */
  readonly order: readonly LayerFace[];
  /** What the creases force, `[upper, lower]`. */
  readonly forced: readonly (readonly [LayerFace, LayerFace])[];
}

/**
 * Four faces in a 2 × 2 grid on the crease pattern, two face up and two face
 * down: the creases force 0 above 1, and leave 0–2, 0–3, 1–2, 1–3 and 2–3
 * open. Of its 24 orders, 12 fit.
 */
export const FAKE_LAYER_ORDER_FIGURE: FakeLayerOrderFigure = {
  facePoints: [
    [10, 10],
    [30, 10],
    [10, 30],
    [30, 30],
  ],
  frontUp: [true, false, true, false],
  order: [0, 1, 2, 3],
  forced: [[0, 1]],
};

/** A source for the toy figure: the fake reads none of it. */
export const FAKE_LAYER_ORDER_SOURCE: LayerOrderSource = {
  segments: [],
  startingFaceId: 0,
  auxSegments: [],
  model: DEFAULT_FOLDED_MODEL,
  digest: 'fake-figure',
};

/** Enough for anything the toy figure asks. */
export const FAKE_LIMITS: LayerOrderLimits = { maxNodes: 1_000, fastNodes: 128, deadlineMs: 1_000 };
/** No nodes at all: a search times out. */
export const FAKE_NO_NODES: LayerOrderLimits = { maxNodes: 0, fastNodes: 0, deadlineMs: 1_000 };
/** A count slice that reads one order of the toy figure's 24: a count of 24 slices. */
export const FAKE_ONE_ORDER_SLICE: LayerOrderLimits = { maxNodes: 1, fastNodes: 0, deadlineMs: 1_000 };

type Upper = readonly [upper: LayerFace, lower: LayerFace];

/** Which of the two faces lies above, by FOLD's sign rule (`constraintVerb`). */
function aboveOf([subject, object, sign]: LayerConstraint, frontUp: readonly boolean[]): Upper {
  const subjectAbove = (sign === 1) === frontUp[object];
  return subjectAbove ? [subject, object] : [object, subject];
}

/**
 * The order closest to `shown` that keeps every `edge`'s upper above its
 * lower, or null for a cycle: faces in the order shown, each preceded by
 * whichever of the faces that must be above it are not placed yet. An order
 * that already fits comes back unchanged.
 */
function closestOrder(shown: readonly LayerFace[], edges: readonly Upper[]): LayerFace[] | null {
  const rank = new Map(shown.map((face, i) => [face, i]));
  const uppers = new Map<LayerFace, LayerFace[]>();
  for (const [upper, lower] of edges) uppers.set(lower, [...(uppers.get(lower) ?? []), upper]);
  const order: LayerFace[] = [];
  const placed = new Set<LayerFace>();
  const placing = new Set<LayerFace>();
  const place = (face: LayerFace): boolean => {
    if (placed.has(face)) return true;
    if (placing.has(face)) return false;
    placing.add(face);
    const above = [...(uppers.get(face) ?? [])].sort((a, b) => rank.get(a)! - rank.get(b)!);
    if (!above.every(place)) return false;
    placing.delete(face);
    placed.add(face);
    order.push(face);
    return true;
  };
  return shown.every(place) ? order : null;
}

function fitsEdges(order: readonly LayerFace[], edges: readonly Upper[]): boolean {
  return edges.every(([upper, lower]) => order.indexOf(upper) < order.indexOf(lower));
}

function stacksOf(order: readonly LayerFace[]): { front: LayerStacks; back: LayerStacks } {
  const offsets = Uint32Array.of(0, order.length);
  return {
    front: { offsets, faces: Uint32Array.from(order) },
    back: { offsets: offsets.slice(), faces: Uint32Array.from([...order].reverse()) },
  };
}

function changedBetween(before: readonly LayerFace[], after: readonly LayerFace[]): LayerChangedSpots {
  return {
    front: before[0] === after[0] ? new Uint32Array() : Uint32Array.of(0),
    back: before.at(-1) === after.at(-1) ? new Uint32Array() : Uint32Array.of(0),
  };
}

/** Every order of `faces`, in lexicographic order of positions. */
function permutations(faces: readonly LayerFace[]): LayerFace[][] {
  if (faces.length <= 1) return [[...faces]];
  return faces.flatMap((face, i) =>
    permutations([...faces.slice(0, i), ...faces.slice(i + 1)]).map((rest) => [face, ...rest])
  );
}

const sameConstraint = (a: readonly number[], b: readonly number[]) => a.every((value, i) => value === b[i]);

const sameList = (a: readonly LayerConstraint[], b: readonly LayerConstraint[]) =>
  a.length === b.length && a.every((constraint, i) => sameConstraint(constraint, b[i]!));

/**
 * The toy figure's paper scene from `side`, for an order: each face a 10 × 10
 * square about its point on the crease pattern, all folded onto the one spot.
 */
export function fakeLayerOrderScene(
  figure: FakeLayerOrderFigure,
  order: readonly LayerFace[],
  side: LayerSide
): OristudioCpFoldedPaperScene {
  const square = ([x, y]: readonly [number, number]): Point[] => [
    { x: x - 5, y: y - 5 },
    { x: x + 5, y: y - 5 },
    { x: x + 5, y: y + 5 },
    { x: x - 5, y: y + 5 },
  ];
  const spot = square([5, 5]);
  const edges = spot.map((from, i) => ({ from, to: spot[(i + 1) % spot.length]!, kind: 'border' as const }));
  return {
    schema_version: 3,
    flipped: side === 'back',
    sheet: 40,
    faces: figure.facePoints.map((_, k) => ({
      outline: spot,
      points: [0, 1, 2, 3].map((corner) => k * 4 + corner),
      front_up: figure.frontUp[k] === (side === 'front'),
      edges,
    })),
    subfaces: [{ polygon: spot, faces_top_to_bottom: side === 'front' ? [...order] : [...order].reverse() }],
    aux_lines: [],
    sheet_points: figure.facePoints.flatMap(square),
  };
}

// ---------------------------------------------------------------------------
// The backend

/** The backend, with the test's handles on it. */
export interface FakeLayerOrderBackend extends LayerOrderBackend {
  /** Every call answered or held, by name, in the order their turns came. */
  readonly calls: (keyof LayerOrderEngine)[];
  /** Keep the next answer of `call` back until `release` (a stand-in for a call that runs long). */
  hold(call: keyof LayerOrderEngine): { release(): void };
  /** Fail the next `call` as a trapped wasm call does. */
  trapNext(call: keyof LayerOrderEngine): void;
}

/** A count in progress: the orders read so far, and the fitting ones among them. */
interface Cursor {
  readonly epoch: number;
  readonly constraints: readonly LayerConstraint[];
  read: number;
  readonly fits: LayerFace[][];
}

interface Session {
  constraints: LayerConstraint[];
  order: LayerFace[];
  openedOn: LayerOpenedOn;
  /** The last preview that fit, until the next preview, commit, restore or step. */
  preview: { token: number; list: LayerConstraint[]; order: LayerFace[] } | null;
  carried: LayerCarriedRow[];
  cursor: Cursor | null;
}

export function createFakeLayerOrderBackend(figure: FakeLayerOrderFigure = FAKE_LAYER_ORDER_FIGURE): FakeLayerOrderBackend {
  const faceCount = figure.order.length;
  const everyOrder = permutations([...figure.order].sort((a, b) => a - b));
  const calls: (keyof LayerOrderEngine)[] = [];
  const holds = new Map<keyof LayerOrderEngine, Promise<void>[]>();
  const traps = new Set<keyof LayerOrderEngine>();
  let session: Session | null = null;
  let tokens = 0;
  let epochs = 0;

  /** Log the call, wait out a hold on it, and fail it if it is to trap. */
  const answering = async (call: keyof LayerOrderEngine): Promise<void> => {
    calls.push(call);
    const held = holds.get(call)?.shift();
    if (held) await held;
    if (traps.delete(call)) throw new WebAssembly.RuntimeError('unreachable');
  };

  const current = (): Session => {
    if (!session) {
      throw { code: LAYER_ORDER_CALL_FAILURES.sessionNotOpen, message: 'No layer order session is open.' };
    }
    return session;
  };

  const edgesOf = (constraints: readonly LayerConstraint[]): Upper[] => [
    ...figure.forced,
    ...constraints.map((constraint) => aboveOf(constraint, figure.frontUp)),
  ];

  /** The pairs neither the creases nor the constraints decide, by reachability. */
  const openPairsOf = (constraints: readonly LayerConstraint[]): Uint32Array => {
    const edges = edgesOf(constraints);
    const reaches = (from: LayerFace, to: LayerFace): boolean => {
      const seen = new Set([from]);
      const stack = [from];
      while (stack.length > 0) {
        const face = stack.pop()!;
        for (const [upper, lower] of edges) {
          if (upper !== face || seen.has(lower)) continue;
          if (lower === to) return true;
          seen.add(lower);
          stack.push(lower);
        }
      }
      return false;
    };
    const pairs: number[] = [];
    for (let a = 0; a < faceCount; a += 1) {
      for (let b = a + 1; b < faceCount; b += 1) if (!reaches(a, b) && !reaches(b, a)) pairs.push(a, b);
    }
    return Uint32Array.from(pairs);
  };

  const openedOf = (now: Session): LayerOrderOpened => ({
    status: 'ok',
    faces: faceCount,
    front_up: Uint8Array.from(figure.frontUp, (up) => (up ? 1 : 0)),
    open_pairs: openPairsOf(now.constraints),
    spots: 1,
    opened_on: now.openedOn,
  });

  const fresh = (order: LayerFace[], openedOn: LayerOpenedOn): Session => ({
    constraints: [],
    order,
    openedOn,
    preview: null,
    carried: [],
    cursor: null,
  });

  /** A constraint that is no question throws, as the bridge's `session_bad_constraint` does. */
  const question = (list: readonly LayerConstraint[]): void => {
    const index = list.findIndex(([s, o]) => !(s < faceCount && o < faceCount && s !== o));
    if (index >= 0) throw { code: 'session_bad_constraint', message: `constraint ${index} is no question` };
  };

  /** Check `list` against the creases: the closest order, a proof, or a timeout. */
  const check = (
    now: Session,
    list: readonly LayerConstraint[],
    limits: LayerOrderLimits
  ): { order: LayerFace[] } | LayerCantFit | LayerTimedOut => {
    const asked = list.map((constraint) => aboveOf(constraint, figure.frontUp));
    for (let i = 0; i < asked.length; i += 1) {
      const [upper, lower] = asked[i]!;
      const faces = Uint32Array.of(upper, lower).sort();
      if (figure.forced.some(([u, l]) => u === lower && l === upper)) {
        return { verdict: 'cant_fit', proof: { kind: 'forced' }, faces, constraints: Uint32Array.of(i) };
      }
      const opposite = asked.findIndex(([u, l]) => u === lower && l === upper);
      if (opposite >= 0) {
        return { verdict: 'cant_fit', proof: { kind: 'opposed' }, faces, constraints: Uint32Array.of(opposite, i).sort() };
      }
    }
    const order = closestOrder(now.order, edgesOf(list));
    if (!order) {
      return {
        verdict: 'cant_fit',
        proof: { kind: 'conflict', family: 'transitivity' },
        faces: Uint32Array.from(new Set(asked.flat())).sort(),
        constraints: Uint32Array.from(list, (_, i) => i),
      };
    }
    const moved = order.some((face, i) => face !== now.order[i]);
    if (moved && limits.maxNodes === 0) return { verdict: 'timed_out', limit: 'nodes', nodes: 0 };
    return { order };
  };

  const previewed = (now: Session, list: readonly LayerConstraint[], limits: LayerOrderLimits): LayerPreviewed => {
    question(list);
    now.preview = null;
    const checked = check(now, list, limits);
    if (!('order' in checked)) return checked;
    tokens += 1;
    now.preview = { token: tokens, list: [...list], order: checked.order };
    return {
      verdict: 'fits',
      token: tokens,
      changed: changedBetween(now.order, checked.order),
      stacks: stacksOf(checked.order),
      stage: 'seeds_first',
      nodes: 1,
    };
  };

  /** Commit `list` on `order`: the session's constraints change, and so does what the count counts. */
  const committedOn = (now: Session, list: readonly LayerConstraint[], order: LayerFace[], adopted: boolean): LayerCommitted => {
    const changed = changedBetween(now.order, order);
    now.constraints = [...list];
    now.order = order;
    now.preview = null;
    now.cursor = null;
    // A carried row the list now holds is applied, and leaves the carried rows.
    now.carried = now.carried.filter(({ constraint }) => !constraint || !list.some((c) => sameConstraint(c, constraint)));
    return {
      verdict: 'committed',
      changed,
      stacks: stacksOf(now.order),
      open_pairs: openPairsOf(now.constraints),
      stage: 'seeds_first',
      nodes: adopted ? 0 : 1,
      adopted,
    };
  };

  const committed = (now: Session, list: readonly LayerConstraint[], limits: LayerOrderLimits): LayerCommitted => {
    question(list);
    const checked = check(now, list, limits);
    if (!('order' in checked)) return checked;
    return committedOn(now, list, checked.order, false);
  };

  /** Where a record's saved face is now, by its point. */
  const foundFace = ({ at }: LayerOrderFace) => figure.facePoints.findIndex(([x, y]) => x === at[0] && y === at[1]);

  /** A record restored onto `now`: E5's rules, over faces found by point. */
  const restoredOnto = (now: Session, record: LayerOrderRecord, limits: LayerOrderLimits) => {
    const found = record.faces.map(foundFace);
    const intact: { index: number; constraint: LayerConstraint }[] = [];
    const saved_constraints = record.constraints.map(([f, g, sign], index): LayerSavedConstraintStatus => {
      const subject = found[f] ?? -1;
      const object = found[g] ?? -1;
      if (subject < 0 || object < 0) return { status: 'gone', cause: 'face_gone' };
      if (subject === object) return { status: 'gone', cause: 'same_face' };
      intact.push({ index, constraint: [subject, object, sign] });
      return { status: 'intact' };
    });
    now.preview = null;
    now.cursor = null;
    const checked = check(now, intact.map((row) => row.constraint), limits);
    const outcome =
      'order' in checked
        ? ({ kind: 'applied' } as const)
        : checked.verdict === 'timed_out'
          ? ({ kind: 'timed_out', limit: checked.limit, nodes: checked.nodes } as const)
          : ({ kind: 'clash', constraints: Array.from(checked.constraints, (i) => intact[i]!.index) } as const);
    if (outcome.kind === 'clash') for (const index of outcome.constraints) saved_constraints[index] = { status: 'clashing' };
    const applied = 'order' in checked ? new Set(intact.map((row) => row.index)) : new Set<number>();
    now.carried = record.constraints.flatMap(([f, g, sign], index): LayerCarriedRow[] => {
      if (applied.has(index)) return [];
      const face = (k: number) => ({ at: [record.faces[k]!.at[0], record.faces[k]!.at[1]] as [number, number], area: record.faces[k]!.area });
      const constraint = intact.find((row) => row.index === index)?.constraint ?? null;
      return [
        {
          ...saved_constraints[index]!,
          index,
          subject: face(f),
          object: face(g),
          sign,
          constraint: constraint ? [constraint[0], constraint[1], constraint[2]] : null,
        },
      ];
    });
    if ('order' in checked) {
      now.constraints = intact.map((row) => row.constraint);
      now.order = checked.order;
    } else {
      now.constraints = [];
    }
    return {
      ...openedOf(now),
      constraints: [...now.constraints],
      outcome,
      saved_faces: {
        status: Uint8Array.from(found, (face) => (face < 0 ? SAVED_FACE_GONE : SAVED_FACE_INTACT)),
        face: Int32Array.from(found),
        area: new Float64Array(found.length).fill(Number.NaN),
      },
      saved_constraints,
      saved_order: new Uint8Array(record.order.length).fill(SAVED_PAIR_KEPT),
      carried: now.carried.map((row) => ({ ...row })),
    };
  };

  /** The smallest clashing subset of `list`, by deletion: E6's filter, by brute force. */
  const explained = (now: Session, list: readonly LayerConstraint[], limits: LayerOrderLimits): LayerExplained => {
    question(list);
    const first = check(now, list, limits);
    if ('order' in first) return { verdict: 'fits' };
    if (first.verdict === 'timed_out') return first;
    let kept = Array.from(list.keys());
    for (const index of [...kept]) {
      const without = kept.filter((i) => i !== index);
      const checked = check(now, without.map((i) => list[i]!), FAKE_LIMITS);
      if (!('order' in checked) && checked.verdict === 'cant_fit') kept = without;
    }
    const last = check(now, kept.map((i) => list[i]!), FAKE_LIMITS) as LayerCantFit;
    const faces = new Set(kept.flatMap((i) => [list[i]![0], list[i]![1]]));
    return {
      verdict: 'clash',
      constraints: Uint32Array.from(kept),
      minimal: true,
      faces: Uint32Array.from([...faces].sort((a, b) => a - b)),
      proof: last.proof,
      traced: last.faces,
    };
  };

  /** The session's cursor, started if there is none. */
  const cursorOf = (now: Session): Cursor => {
    if (!now.cursor) {
      epochs += 1;
      now.cursor = { epoch: epochs, constraints: [...now.constraints], read: 0, fits: [] };
    }
    return now.cursor;
  };

  /** Read on `orders` more orders, at least one, unless every order is read. */
  const advance = (cursor: Cursor, orders: number) => {
    const edges = edgesOf(cursor.constraints);
    const until = Math.min(everyOrder.length, cursor.read + Math.max(1, orders));
    for (; cursor.read < until; cursor.read += 1) {
      const order = everyOrder[cursor.read]!;
      if (fitsEdges(order, edges)) cursor.fits.push(order);
    }
  };

  const keyOf = (order: readonly LayerFace[], by: LayerStepBy): string =>
    by === 'layer_order' ? order.join(',') : String(by.picture === 'front' ? order[0] : order.at(-1));

  /** The distinct keys counted so far, in the stepper's order, with a fitting order for each. */
  const keysOf = (cursor: Cursor, by: LayerStepBy): { key: string; order: LayerFace[] }[] => {
    const seen = new Map<string, LayerFace[]>();
    for (const order of cursor.fits) if (!seen.has(keyOf(order, by))) seen.set(keyOf(order, by), order);
    return [...seen].map(([key, order]) => ({ key, order })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  };

  const countOf = (cursor: Cursor): LayerSolutionCount => {
    const done = cursor.read === everyOrder.length;
    return {
      front: { n: keysOf(cursor, { picture: 'front' }).length, exact: done },
      back: { n: keysOf(cursor, { picture: 'back' }).length, exact: done },
      orders: { n: cursor.fits.length, exact: done },
      done,
    };
  };

  const positionOf = (now: Session, cursor: Cursor, by: LayerStepBy): LayerPosition => {
    const keys = keysOf(cursor, by);
    const count = countOf(cursor);
    const total = by === 'layer_order' ? count.orders : count[by.picture];
    const at = keys.findIndex(({ key }) => key === keyOf(now.order, by));
    return at < 0 ? { index: Number.MAX_SAFE_INTEGER, total: { ...total, exact: false } } : { index: at + 1, total };
  };

  const methods: LayerOrderBackend = {
    async open(_source, limits) {
      await answering('open');
      session = null;
      if (limits.maxNodes === 0) return { status: 'refused', refusal: { code: 'session_timed_out', limit: 'nodes', nodes: 0 } };
      session = fresh([...figure.order], { kind: 'first', timed_out: null });
      return openedOf(session);
    },

    async openShowing(_source, relations, limits) {
      await answering('openShowing');
      session = null;
      if (limits.maxNodes === 0) return { status: 'refused', refusal: { code: 'session_timed_out', limit: 'nodes', nodes: 0 } };
      // The one stack the relations describe: each face below every face related above it.
      const above = (face: LayerFace) => {
        let n = 0;
        for (let i = 1; i < relations.length; i += 2) if (relations[i] === face) n += 1;
        return n;
      };
      const shown = [...figure.order].sort((a, b) => above(a) - above(b) || a - b);
      const order = closestOrder(shown, figure.forced) ?? [...figure.order];
      const moved = order.some((face, i) => face !== shown[i]);
      session = fresh(order, moved ? { kind: 'closest', moved: 1, ignored: 0 } : { kind: 'held', ignored: 0 });
      return openedOf(session);
    },

    async restore(_source, record, limits) {
      await answering('restore');
      session = null;
      // The open's first order needs no search here, so only no time at all stops it. With no nodes, the
      // restore opens and its check times out, as a real one that runs out with the session open does.
      if (limits.deadlineMs === 0) {
        return { status: 'refused', refusal: { code: 'session_timed_out', limit: 'deadline', nodes: 0 } };
      }
      session = fresh([...figure.order], { kind: 'first', timed_out: null });
      return restoredOnto(session, record, limits);
    },

    async restoreRecord(record, limits) {
      await answering('restoreRecord');
      return restoredOnto(current(), record, limits);
    },

    async openedOn() {
      await answering('openedOn');
      return current().openedOn;
    },

    async openPairs() {
      await answering('openPairs');
      return openPairsOf(current().constraints);
    },

    async constraints() {
      await answering('constraints');
      return [...current().constraints];
    },

    async preview(candidate, limits) {
      await answering('preview');
      const now = current();
      return previewed(now, [...now.constraints, candidate], limits);
    },

    async previewList(constraints, limits) {
      await answering('previewList');
      return previewed(current(), constraints, limits);
    },

    async commit(constraints, limits) {
      await answering('commit');
      return committed(current(), constraints, limits);
    },

    async order() {
      await answering('order');
      // The fake's order is one stack of every face, top first: its bytes are the faces.
      return Uint8Array.from(current().order);
    },

    async show(constraints, order, limits) {
      await answering('show');
      const now = current();
      question(constraints);
      const faces = Array.from(order);
      const whole = faces.length === faceCount && new Set(faces).size === faceCount && faces.every((f) => f < faceCount);
      if (!whole || !fitsEdges(faces, edgesOf(constraints))) return { verdict: 'refused' };
      if (limits.maxNodes === 0 && limits.deadlineMs === 0) return { verdict: 'timed_out', limit: 'deadline', nodes: 0 };
      // A cursor counting the same constraints stays good, as the bridge's does.
      const cursor = now.cursor && sameList(now.cursor.constraints, constraints) ? now.cursor : null;
      const { verdict: _verdict, ...done } = committedOn(now, constraints, faces, false) as Extract<
        LayerCommitted,
        { verdict: 'committed' }
      >;
      now.cursor = cursor;
      return { ...done, verdict: 'shown', stage: 'unchanged', nodes: 0 };
    },

    async commitPreview(token, constraints, limits) {
      await answering('commitPreview');
      const now = current();
      const kept = now.preview;
      if (kept && kept.token === token && sameList(kept.list, constraints)) {
        return committedOn(now, constraints, kept.order, true);
      }
      return committed(now, constraints, limits);
    },

    async carried() {
      await answering('carried');
      return current().carried.map((row) => ({ ...row }));
    },

    async removeCarried(index) {
      await answering('removeCarried');
      const now = current();
      const before = now.carried.length;
      now.carried = now.carried.filter((row) => row.index !== index);
      return now.carried.length < before;
    },

    async clearCarried() {
      await answering('clearCarried');
      current().carried = [];
    },

    async stacks(side) {
      await answering('stacks');
      return stacksOf(current().order)[side];
    },

    async scene(side) {
      await answering('scene');
      return fakeLayerOrderScene(figure, current().order, side);
    },

    async save(keepCarried) {
      await answering('save');
      const now = current();
      const keep = keepCarried ? new Set(keepCarried) : null;
      // The committed constraints' faces and the order's, then each carried row's two, as saved.
      const named = [...new Set([...now.constraints.flatMap(([s, o]) => [s, o]), ...now.order])].sort((a, b) => a - b);
      const faces: LayerOrderFace[] = named.map((face) => ({ at: figure.facePoints[face]!, area: 100 }));
      const indexOf = (face: LayerFace) => named.indexOf(face);
      const pair = (upper: LayerFace, lower: LayerFace): LayerOrderPair => [
        indexOf(upper),
        indexOf(lower),
        figure.frontUp[lower] ? 1 : -1,
      ];
      const free: LayerOrderPair[] = [];
      now.order.forEach((upper, i) => {
        for (const lower of now.order.slice(i + 1)) {
          if (!figure.forced.some(([u, l]) => u === upper && l === lower)) free.push(pair(upper, lower));
        }
      });
      // As the engine's: the carried rows `keepCarried` names by record index, else every one; the session keeps them all.
      const written = keep ? now.carried.filter((row) => keep.has(row.index)) : now.carried;
      const carried: LayerOrderPair[] = written.map((row) => {
        faces.push(row.subject, row.object);
        return [faces.length - 2, faces.length - 1, row.sign];
      });
      const record: LayerOrderRecord = {
        faces,
        constraints: [...now.constraints.map(([s, o, sign]): LayerOrderPair => [indexOf(s), indexOf(o), sign]), ...carried],
        order: free,
      };
      const encoded = encodeLayerOrderRecord(record);
      if (!encoded.ok) throw { code: 'session_internal', message: 'the fake record would not encode' };
      return { status: 'ok', record, json: encoded.json };
    },

    async relations() {
      await answering('relations');
      const { order } = current();
      const pairs: [LayerFace, LayerFace][] = [];
      order.forEach((upper, i) => {
        for (const lower of order.slice(i + 1)) pairs.push([upper, lower]);
      });
      pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
      return Uint32Array.from(pairs.flat());
    },

    async close() {
      await answering('close');
      session = null;
    },

    async explain(candidate, limits) {
      await answering('explain');
      const now = current();
      return explained(now, candidate ? [...now.constraints, candidate] : now.constraints, limits);
    },

    async explainList(constraints, limits) {
      await answering('explainList');
      return explained(current(), constraints, limits);
    },

    async countSlice(limits) {
      await answering('countSlice');
      const now = current();
      const cursor = cursorOf(now);
      advance(cursor, limits.maxNodes);
      return { epoch: cursor.epoch, count: countOf(cursor) };
    },

    async position(by) {
      await answering('position');
      const now = current();
      return positionOf(now, cursorOf(now), by);
    },

    async step(by, direction, limits) {
      await answering('step');
      const now = current();
      const cursor = cursorOf(now);
      // Unless the count is done, count on within half the step's limits first, as E6 does.
      advance(cursor, Math.floor(limits.maxNodes / 2));
      const keys = keysOf(cursor, by);
      const at = keys.findIndex(({ key }) => key === keyOf(now.order, by));
      const to = at < 0 ? (direction === 'next' ? 0 : -1) : at + (direction === 'next' ? 1 : -1);
      const target = keys[to];
      if (!target) return { verdict: 'end' };
      const changed = changedBetween(now.order, target.order);
      now.order = [...target.order];
      now.preview = null;
      return { verdict: 'moved', changed, position: positionOf(now, cursor, by), stacks: stacksOf(now.order) };
    },
  };

  return {
    calls,
    hold(call) {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      holds.set(call, [...(holds.get(call) ?? []), held]);
      return { release };
    },
    trapNext(call) {
      traps.add(call);
    },
    ...oneAtATime(methods),
  };
}

/**
 * The calls answered one at a time, in the order they arrive, as a real
 * worker answers them: each bridge call is synchronous, so a call that runs
 * long (here, one held) keeps every call behind it waiting.
 */
function oneAtATime(methods: LayerOrderBackend): LayerOrderBackend {
  let queue: Promise<unknown> = Promise.resolve();
  const queued = {} as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const [name, method] of Object.entries(methods) as [string, (...args: unknown[]) => unknown][]) {
    queued[name] = (...args) => {
      const turn = queue.then(() => method(...args));
      queue = turn.then(
        () => {},
        () => {}
      );
      return turn;
    };
  }
  return queued as unknown as LayerOrderBackend;
}

// ---------------------------------------------------------------------------
// The worker

/**
 * One end of a message channel that delivers a task later, as a worker's
 * does, and a structured clone, as a worker's does: what can't cross a real
 * worker can't cross this one. (Under jsdom the clone's typed arrays are of
 * another realm than the test's, so a test checks their tag, not `instanceof`.)
 */
class FakePort extends EventTarget {
  other: FakePort | null = null;
  closed = false;

  postMessage(message: unknown): void {
    if (this.closed) return;
    const data: unknown = structuredClone(message);
    const to = this.other;
    setTimeout(() => {
      if (this.closed || !to || to.closed) return;
      to.dispatchEvent(new MessageEvent('message', { data }));
    }, 0);
  }
}

/**
 * A worker running the real worker shell over `load`'s backend, through
 * comlink, in this thread: what the runtime spawns in a test. `terminate()`
 * cuts both ends, so a call in flight is orphaned exactly as a real one is.
 */
export class InProcessLayerOrderWorker extends FakePort {
  terminated = false;
  private readonly inside = new FakePort();

  constructor(load: LayerOrderBackendLoader) {
    super();
    this.other = this.inside;
    this.inside.other = this;
    expose(createLayerOrderWorkerApi(load), this.inside as unknown as Endpoint);
  }

  terminate(): void {
    this.terminated = true;
    this.closed = true;
    this.inside.closed = true;
  }

  /** Die as a worker does: its `error` event. */
  crash(message = 'The worker stopped unexpectedly.'): void {
    this.dispatchEvent(new ErrorEvent('error', { message }));
  }

  /** Never run, as a worker whose script did not load (offline): a plain `error` event, not an `ErrorEvent`. */
  failToLoad(): void {
    this.dispatchEvent(new Event('error'));
  }
}

/** A worker over the fake backend, with the test's handle on it. */
export class FakeLayerOrderWorker extends InProcessLayerOrderWorker {
  constructor(readonly backend: FakeLayerOrderBackend) {
    super(() => backend);
  }
}

/** A spawner for `createLayerOrderRuntime`, keeping every worker it made and the backend of each. */
export function fakeLayerOrderWorkers(makeBackend: () => FakeLayerOrderBackend = () => createFakeLayerOrderBackend()) {
  const workers: FakeLayerOrderWorker[] = [];
  return {
    workers,
    spawn: (): Worker => {
      const worker = new FakeLayerOrderWorker(makeBackend());
      workers.push(worker);
      return worker as unknown as Worker;
    },
  };
}

/** A spawner over any backend: a fresh one per worker, as each real worker loads its own. */
export function inProcessLayerOrderWorkers(makeBackend: LayerOrderBackendLoader) {
  const workers: InProcessLayerOrderWorker[] = [];
  return {
    workers,
    spawn: (): Worker => {
      const worker = new InProcessLayerOrderWorker(makeBackend);
      workers.push(worker);
      return worker as unknown as Worker;
    },
  };
}
