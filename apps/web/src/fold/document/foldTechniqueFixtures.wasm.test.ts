/**
 * The generated Fold fixtures: each built here from a few folds chosen for
 * the check that uses it, landed through the real engine, and written as the
 * app saves a project. By default this checks that every committed file is
 * exactly what it builds; `FOLD_FIXTURES_WRITE=1` writes them instead:
 *
 * ```sh
 * FOLD_FIXTURES_WRITE=1 npx vitest run src/fold/document/foldTechniqueFixtures.wasm.test.ts
 * ```
 *
 * Every point is a sheet point. A line or a seed the folded paper picks is
 * found by asking the engine what lies at a model point, as a click would.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyIsometry, invertIsometry } from '../canvas/foldCanvasGeometry';
import { createFoldEngineCalls, type FoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from '../engine/foldEngineCompoundCalls';
import { createFoldEngineIoCalls, type FoldEngineIoCalls } from '../engine/foldEngineIoCalls';
import type { FoldEngineOutcome } from '../engine/foldEngineWire';
import { foldStateFrame, sheetToScene } from '../sequence/foldStateFrame';
import { createNativeProjectFile, serializeNativeProjectFile } from '../../lib/nativeProjectFile';
import {
  FOLD_DEFAULT_PAPER_STYLE,
  FOLD_SEQUENCE_FORMAT_VERSION,
  SQUARE_PAPER,
  type FoldChoices,
  type FoldDirection,
  type FoldOp,
  type FoldPlainOp,
  type FoldPrecreaseOp,
  type FoldReverseOp,
  type FoldSeed,
  type FoldSequenceDocument,
  type FoldStep,
  type SheetPoint,
} from './foldSequenceDocument';
import { writeFoldSequences } from './foldSequenceFile';

const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const FIXTURES = resolve(ROOT, '../../tests/fixtures');
const WRITE = process.env.FOLD_FIXTURES_WRITE === '1';
const available = existsSync(WASM);

/** The app version and the time every generated file is stamped with, so a rebuild is the same bytes. */
const STAMP = { appVersion: '0.10.0', now: new Date('2026-11-27T00:00:00.000Z') };

type Point = readonly [number, number];
type Engine = { calls: FoldEngineCalls; compound: FoldEngineCompoundCalls; io: FoldEngineIoCalls };

async function engine(): Promise<Engine> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const raw = new wasm.FoldEngine();
  return { calls: createFoldEngineCalls(raw), compound: createFoldEngineCompoundCalls(raw), io: createFoldEngineIoCalls(raw) };
}

function landed<T>(outcome: FoldEngineOutcome<T>, what: string): T {
  if (outcome.status !== 'ok') throw new Error(`${what}: ${JSON.stringify(outcome)}`);
  return outcome;
}

const T22 = Math.SQRT2 - 1;
const ALL: FoldSeed = { scope: 'all' };

const free = (a: Point, b: Point) => ({ via: 'free' as const, through: [a, b] as const });
const plain = (kind: 'valley' | 'mountain', a: Point, b: Point, moving: Point, seed: FoldSeed = ALL): FoldPlainOp => ({
  kind,
  line: free(a, b),
  moving,
  seed,
  landing: { kind: 'outer' },
});
const precrease = (a: Point, b: Point, moving: Point, direction: FoldDirection = 'valley'): FoldPrecreaseOp => ({
  kind: 'precrease',
  line: free(a, b),
  moving,
  seed: ALL,
  direction,
});

/** One sequence being built: each step landed on its parent as it is added. */
class Sequence {
  readonly steps: FoldStep[] = [];
  private readonly states = new Map<string, number>();
  private readonly sheet: number;
  private last: string | null = null;

  constructor(
    readonly e: Engine,
    readonly slug: string
  ) {
    this.sheet = landed(e.calls.sheet(SQUARE_PAPER), 'sheet').state;
  }

  /** The state a step landed, or the sheet for null. */
  state(id: string | null = this.last): number {
    if (id === null) return this.sheet;
    const state = this.states.get(id);
    if (state === undefined) throw new Error(`no step ${id}`);
    return state;
  }

  /** Lands `op` on `parent` (the last step by default) and records it. */
  add(note: string, op: FoldOp, options: { choices?: FoldChoices; parent?: string | null } = {}): string {
    const parent = options.parent === undefined ? this.last : options.parent;
    const id = `fstep-${this.slug}-${this.steps.length + 1}`;
    const result = landed(this.e.calls.step(this.state(parent), op, options.choices), `${this.slug} ${id}`);
    this.states.set(id, result.state);
    this.steps.push({ id, parent, op, ...(options.choices ? { choices: options.choices } : {}), expect: result.fingerprint, note });
    this.last = id;
    return id;
  }

  /** The sheet point the viewer sees at a model point. */
  seen(at: Point, state = this.state()): SheetPoint {
    const top = this.e.calls.topVisibleAt(state, at);
    if (!top) throw new Error(`${this.slug}: nothing seen at ${at}`);
    return top.sheet;
  }

  /** Where a sheet point lies in the model (the scene, the view being the identity in every use here). */
  image(at: SheetPoint, state = this.state()): Point {
    const point = sheetToScene(foldStateFrame(this.e.calls.scene(state)), at);
    if (!point) throw new Error(`${this.slug}: ${at} is off the paper`);
    return point;
  }
}

interface Fixture {
  folder: 'fold-examples';
  slug: string;
  title: string;
  build(sequence: Sequence): void;
}

/** A reverse fold through the layers at the model point `tip`, along the line through two model points, at its even opening. */
function reverse(seq: Sequence, kind: FoldReverseOp['kind'], a: Point, b: Point, tip: Point): { op: FoldReverseOp; choices?: FoldChoices } {
  const at = seq.seen(tip);
  const op: FoldReverseOp = { kind, line: free(seq.seen(a), seq.seen(b)), moving: at, seed: { scope: 'depth', at, layers: 1 } };
  const answer = landed(seq.e.compound.compoundAnalysis(seq.state(), op), `${seq.slug} reverse analysis`);
  if (answer.family !== 'reverse') throw new Error('not a reverse');
  const openings = answer.analysis.flaps[0]?.openings ?? [];
  const even = openings.find((opening) => opening.upper.length === opening.lower.length);
  return even ? { op, choices: { opening: [even.stored] } } : { op };
}

/** The steps of the fish base: the diagonal and the four corner bisectors precreased, then the two rabbit ears they fold. */
function fishBase(seq: Sequence): void {
  const s = 2 - Math.SQRT2;
  seq.add('Precrease the diagonal from the bottom left corner to the top right.', precrease([0, 0], [1, 1], [0.9, 0.1]));
  seq.add('Precrease the bisector of the bottom left corner below the diagonal.', precrease([0, 0], [1, T22], [0.9, 0.05]));
  seq.add('Precrease the bisector of the top right corner below the diagonal.', precrease([1, 1], [s, 0], [0.95, 0.1]));
  seq.add('Precrease the bisector of the bottom left corner above the diagonal.', precrease([0, 0], [T22, 1], [0.05, 0.9]));
  seq.add('Precrease the bisector of the top right corner above the diagonal.', precrease([1, 1], [0, s], [0.1, 0.95]));
  // Each ear's ray a whole direction off every crease, so the nearest the engine offers is never a tie.
  seq.add('Rabbit-ear the triangle below the diagonal along its precreases, its ear toward the right edge.', {
    kind: 'rabbit-ear',
    corners: [[0, 0], [1, 0], [1, 1]],
    emergent: [1, 0],
    seed: { scope: 'depth', at: [0.8, 0.12], layers: 1 },
    stayer: [0.2, 0.8],
    direction: 'valley',
  });
  seq.add('Rabbit-ear the triangle above the diagonal the same way, its ear toward the top edge: the fish base.', {
    kind: 'rabbit-ear',
    corners: [[0, 0], [0, 1], [1, 1]],
    emergent: [0, 1],
    seed: { scope: 'depth', at: [0.12, 0.8], layers: 1 },
    stayer: [0.95, 0.5],
    direction: 'valley',
  });
}

/** The tuck: two bottom corners folded in on steep lines, then the top folded down under both. */
function tuckUnderTwoFlaps(seq: Sequence): void {
  seq.add('Valley fold the bottom left corner in, along the line from (0, 0.2) to (0.5, 0).', plain('valley', [0, 0.2], [0.5, 0], [0.02, 0.02]));
  seq.add('Valley fold the bottom right corner in, along the line from (1, 0.2) to (0.5, 0).', plain('valley', [1, 0.2], [0.5, 0], [0.98, 0.02]));
  seq.add('Valley fold the top down along y = 0.64 and tuck it under both corner flaps, above the sheet.', {
    kind: 'valley',
    line: free([0, 0.64], [1, 0.64]),
    seed: { scope: 'depth', at: [0.5, 0.95], layers: 1 },
    landing: { kind: 'against', targets: [[0.05, 0.05], [0.95, 0.05]] },
  });
}

/** A FOLD crease pattern of the unit square from its creases, sheet points, the border split at every end on it. */
function foldText(creases: readonly (readonly [Point, Point, 'M' | 'V'])[]): string {
  const vertices: Point[] = [];
  const id = (p: Point) => {
    let i = vertices.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9);
    if (i < 0) i = vertices.push(p) - 1;
    return i;
  };
  const edges: [number, number][] = [];
  const letters: string[] = [];
  const ends = creases.flatMap(([a, b]) => [a, b]);
  const sides: [Point, Point][] = [[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]]];
  for (const [p, q] of sides) {
    const along = (v: Point) => (v[0] - p[0]) * (q[0] - p[0]) + (v[1] - p[1]) * (q[1] - p[1]);
    const on = [p, q, ...ends.filter((v) => Math.abs((q[0] - p[0]) * (v[1] - p[1]) - (q[1] - p[1]) * (v[0] - p[0])) < 1e-9)];
    const sorted = [...new Map(on.map((v) => [along(v).toFixed(9), v])).values()].sort((u, v) => along(u) - along(v));
    for (let k = 0; k + 1 < sorted.length; k++) {
      edges.push([id(sorted[k]!), id(sorted[k + 1]!)]);
      letters.push('B');
    }
  }
  for (const [a, b, letter] of creases) {
    edges.push([id(a), id(b)]);
    letters.push(letter);
  }
  // FOLD's y runs up the sheet; the sheet's runs down.
  return JSON.stringify({ vertices_coords: vertices.map(([x, y]) => [x, 1 - y]), edges_vertices: edges, edges_assignment: letters });
}

/**
 * The Import CP of a crease pattern written by hand after the parent, as a
 * branch beside the step it checks: the layer order the one whose stack at
 * the model point `witness` holds the sheet regions `expected` names, top
 * first (`region` names a sheet point's).
 */
function control(
  seq: Sequence,
  parent: string,
  note: string,
  cp: string,
  witness: Point,
  region: (p: SheetPoint) => string,
  expected: readonly string[] | null
): void {
  const opened = landed(seq.e.io.importCp({ format: 'fold', text: cp }, { kind: 'after', state: seq.state(parent) }), `${seq.slug} import`);
  const sizes = opened.components.map((c) => c.orders);
  const choices = sizes.length === 0 ? [[]] : Array.from({ length: sizes[0]! }, (_, k) => [k, ...sizes.slice(1).map(() => 0)]);
  if (sizes.length > 1) throw new Error(`${seq.slug}: more than one component`);
  const matches = choices.filter((choice) => {
    const picked = landed(seq.e.io.importPick(opened.import, choice), `${seq.slug} pick`);
    if (!expected) return true;
    const scene = seq.e.calls.scene(picked.state);
    const cell = scene.subfaces.find((c) => inside(c.polygon.map((p) => [p.x, p.y] as const), witness));
    const stack = (cell?.faces_top_to_bottom ?? []).map((f) => {
      const p = applyIsometry(invertIsometry(scene.face_transforms[f]!), { x: witness[0], y: witness[1] });
      return region([p.x, p.y]);
    });
    return JSON.stringify(stack) === JSON.stringify(expected);
  });
  if (matches.length !== 1) throw new Error(`${seq.slug}: ${matches.length} orders hold the expected stack`);
  const picked = landed(seq.e.io.importPick(opened.import, matches[0]!), `${seq.slug} pick`);
  seq.add(note, picked.op, { parent });
}

function inside(ring: readonly Point[], [x, y]: Point): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}

const FIXTURES_BUILT: readonly Fixture[] = [
  {
    folder: 'fold-examples',
    slug: 'rabbit-ear-precreased',
    title: 'Rabbit ears along their precreases: the fish base',
    build: fishBase,
  },
  {
    folder: 'fold-examples',
    slug: 'squash-precreased-flap',
    title: 'A precreased flap squashed from either side of its precrease',
    build(seq) {
      seq.add('Valley fold the square in half along the diagonal from the top left corner to the bottom right.', plain('valley', [1, 0], [0, 1], [1, 1]));
      seq.add('Valley fold the triangle in half, its right corner onto its left: four layers.', plain('valley', [0, 0], [0.5, 0.5], [0.9, 0.1]));
      const prefix = seq.add(
        'Precrease every layer along the line from the top corner to the middle of the folded edge.',
        precrease([0.05, 0.85], [0.2, 0.4], [0.03, 0.5])
      );
      seq.add('Squash the top flap, picked left of the precrease.', { kind: 'squash', flap: seq.seen([0.1, 0.5]), direction: 'valley' });
      seq.add(
        'Squash the top flap again from the same parent, picked right of the precrease: the same squash.',
        { kind: 'squash', flap: seq.seen([0.3, 0.45], seq.state(prefix)), direction: 'valley' },
        { parent: prefix }
      );
    },
  },
  {
    folder: 'fold-examples',
    slug: 'kite-outside-reverse',
    title: 'A kite folded in half, its point outside-reversed twice',
    build(seq) {
      seq.add('Precrease the diagonal from the bottom left corner to the top right.', precrease([0, 0], [1, 1], [0.9, 0.1]));
      seq.add('Valley fold the bottom edge onto the diagonal.', plain('valley', [0, 0], [1, T22], [0.9, 0.05]));
      seq.add('Valley fold the left edge onto the diagonal: the kite.', plain('valley', [0, 0], [T22, 1], [0.05, 0.9]));
      seq.add('Mountain fold the kite in half along the diagonal, its flaps outside.', plain('mountain', [0, 0], [1, 1], [0.1, 0.9]));
      // A shallow line from the spine: only the outside reverse lands at the even opening.
      const d = [0.86, -0.51] as const;
      const n = Math.hypot(d[0], d[1]);
      const along = (s: number): Point => [0.3 + (d[0] / n) * s, 0.3 + (d[1] / n) * s];
      const first = reverse(seq, 'outside-reverse', along(0.02), along(0.17), [0.05, 0.03]);
      seq.add('Outside reverse fold the point at the even opening, along a shallow line from the spine.', first.op, { choices: first.choices });
      // Across the reversed point, near its tip.
      const tip = seq.image([0.001, 0.0005]);
      const root = seq.image([0.25, 0.2]);
      const length = Math.hypot(tip[0] - root[0], tip[1] - root[1]);
      const axis = [(tip[0] - root[0]) / length, (tip[1] - root[1]) / length] as const;
      const q: Point = [root[0] + axis[0] * 0.6 * length, root[1] + axis[1] * 0.6 * length];
      const turn = (-40 * Math.PI) / 180;
      const across = [-axis[1] * Math.cos(turn) + axis[0] * Math.sin(turn), -axis[1] * Math.sin(turn) - axis[0] * Math.cos(turn)] as const;
      const end = (s: number): Point => [q[0] + across[0] * s, q[1] + across[1] * s];
      const second = reverse(seq, 'outside-reverse', end(-0.012), end(0.012), seq.image([0.01, 0.006]));
      seq.add('Outside reverse fold the end of the point again, along a line across it near its tip.', second.op, { choices: second.choices });
    },
  },
  {
    folder: 'fold-examples',
    slug: 'tuck-under-two-flaps',
    title: 'A flap tucked under two separate flaps',
    build: tuckUnderTwoFlaps,
  },
  {
    folder: 'fold-examples',
    slug: 'inside-reverse-nested-pairs',
    title: 'An inside reverse of two nested pairs of layers',
    build(seq) {
      // The second fold a little right of the middle, so the pairs' layers do not all line up.
      const c = 0.55;
      seq.add('Valley fold the square in half, the top edge onto the bottom.', plain('valley', [0, 0.5], [1, 0.5], [0.5, 0.9]));
      const prefix = seq.add(
        'Valley fold the right part over along x = 0.55: two pairs of layers, one inside the other, joined along the right edge.',
        plain('valley', [c, 0], [c, 0.4], [0.9, 0.25])
      );
      const tip = seq.seen([c - 0.02, 0.02]);
      seq.add('Inside reverse fold the bottom right corner through both pairs, along the line from (0.55, 0.2) to (0.35, 0) as folded.', {
        kind: 'inside-reverse',
        line: free([c + 0.05, 0.15], [c + 0.15, 0.05]),
        moving: tip,
        seed: { scope: 'depth', at: tip, layers: 2 },
      });
      // Each layer's tip and body by its sheet region: L/R the part, b/t the half folded down or not.
      const region = ([x, y]: SheetPoint) => {
        const half = `${x < c ? 'L' : 'R'}${y < 0.5 ? 'b' : 't'}`;
        const v = y < 0.5 ? y : 1 - y;
        return `${half} ${v < 0.2 - Math.abs(x - c) ? 'tip' : 'body'}`;
      };
      control(
        seq,
        prefix,
        'Control, beside the reverse: Import CP of the crease pattern the reverse makes, written by hand. Each pair reversed inside its own walls, so the pairs nest the other way round at the tip.',
        foldText([
          [[0, 0.5], [c, 0.5], 'V'], [[c, 0.5], [1, 0.5], 'V'],
          [[c, 0], [c, 0.2], 'M'], [[c, 0.2], [c, 0.5], 'V'], [[c, 0.5], [c, 0.8], 'M'], [[c, 0.8], [c, 1], 'V'],
          [[c - 0.2, 0], [c, 0.2], 'V'], [[c + 0.2, 0], [c, 0.2], 'V'], [[c - 0.2, 1], [c, 0.8], 'M'], [[c + 0.2, 1], [c, 0.8], 'M'],
        ]),
        [c - 0.1333, 0.1333],
        region,
        ['Rb body', 'Rt body', 'Rt tip', 'Rb tip', 'Lb tip', 'Lt tip', 'Lt body', 'Lb body']
      );
    },
  },
  {
    folder: 'fold-examples',
    slug: 'crimp-lines-meet-on-fold',
    title: 'A crimp whose two lines meet on the folded edge',
    build(seq) {
      const prefix = seq.add('Valley fold the square in half, the top edge onto the bottom.', plain('valley', [0, 0.5], [1, 0.5], [0.5, 0.9]));
      seq.add('Crimp inside along two lines that meet on the folded edge at x = 0.6: from it to (0.5, 0) and to (0.7, 0) as folded.', {
        kind: 'crimp',
        line: free([0.58, 0.6], [0.52, 0.9]),
        second: free([0.62, 0.6], [0.68, 0.9]),
        crimp: 'inside',
        moving: [0.9, 0.75],
        seed: ALL,
      });
      control(
        seq,
        prefix,
        'Control, beside the crimp: Import CP of the crease pattern the crimp makes, written by hand. Its letters allow one order.',
        foldText([
          [[0, 0.5], [0.6, 0.5], 'V'], [[0.6, 0.5], [1, 0.5], 'V'],
          [[0.6, 0.5], [0.5, 0], 'V'], [[0.6, 0.5], [0.7, 0], 'M'],
          [[0.6, 0.5], [0.5, 1], 'V'], [[0.6, 0.5], [0.7, 1], 'M'],
        ]),
        [0.5, 0.25],
        () => '',
        null
      );
    },
  },
  {
    folder: 'fold-examples',
    slug: 'chain-fish-base-outside-reverse',
    title: 'Chained: the fish base, folded in half, a point outside-reversed',
    build(seq) {
      fishBase(seq);
      seq.add('Mountain fold the fish base in half along the diagonal, the half below it going behind.', plain('mountain', [0, 0], [1, 1], [0.9, 0.3]));
      const r = reverse(seq, 'outside-reverse', [0.21, 0.23], [0.16, 0.36], [0.025, 0.03]);
      seq.add('Outside reverse fold the bottom left point at the even opening.', r.op, { choices: r.choices });
    },
  },
  {
    folder: 'fold-examples',
    slug: 'chain-tuck-turn-fold',
    title: 'Chained: a tuck under two flaps, turned over and folded in half',
    build(seq) {
      tuckUnderTwoFlaps(seq);
      seq.add('Turn the model over side to side.', { kind: 'turn', axis: 'vertical' });
      seq.add('Valley fold it in half along the vertical centre line, every layer, the left half moving.', {
        kind: 'valley',
        line: free([0.5, 0.3], [0.5, 0.5]),
        moving: [0.25, 0.4],
        seed: ALL,
        landing: { kind: 'outer' },
      });
    },
  },
];

async function built(fixture: Fixture): Promise<string> {
  const seq = new Sequence(await engine(), fixture.slug);
  fixture.build(seq);
  const document: FoldSequenceDocument = {
    formatVersion: FOLD_SEQUENCE_FORMAT_VERSION,
    id: `fold-${fixture.slug}`,
    title: fixture.title,
    paper: SQUARE_PAPER,
    style: FOLD_DEFAULT_PAPER_STYLE,
    steps: seq.steps,
  };
  const file = createNativeProjectFile({
    ...STAMP,
    workspaceTitle: fixture.title,
    filename: `${fixture.slug}.osf`,
    path: null,
    designs: [],
    creasePattern: null,
    foldSequences: writeFoldSequences([{ document, readOnlyRaw: null }]),
    workspaceViewState: { fold: { v: 1, sequenceId: document.id, cursor: seq.steps.at(-1)?.id ?? null } },
  });
  return serializeNativeProjectFile(file);
}

describe.skipIf(!available)('the generated Fold fixtures', () => {
  it.each(FIXTURES_BUILT.map((fixture) => [`${fixture.folder}/${fixture.slug}.osf`, fixture] as const))(
    '%s is what this file builds',
    async (path, fixture) => {
      const text = await built(fixture);
      const file = resolve(FIXTURES, path);
      if (WRITE) writeFileSync(file, text);
      expect(readFileSync(file, 'utf8')).toBe(text);
    }
  );
});
