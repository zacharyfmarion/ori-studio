import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Point } from '../../lib/geometry';
import { applyIsometry, insideConvex, toPoint } from '../canvas/foldCanvasGeometry';
import { foldPickIndex, resolveFoldPick, type FoldPaneId, type FoldPick, type FoldPickIndex } from '../canvas/foldPicking';
import { createFoldEngineCalls, type FoldEngineCalls } from '../engine/foldEngineCalls';
import type { FoldAxiomLine, FoldEngineOutcome } from '../engine/foldEngineWire';
import { sequenceOf, step } from '../document/foldSequence.fixtures';
import { isLockedStep, type FoldChoices, type FoldOp, type SheetPoint } from '../document/foldSequenceDocument';
import { readFoldSequence, writeFoldSequence } from '../document/foldSequenceFile';
import {
  axiomLineOfPicks,
  besideBend,
  buildFoldStep,
  freeLineThrough,
  movingPoint,
  type FoldStepIntent,
} from './foldStepBuilder';
import type { FoldLineModeId } from './foldToolCatalog';
import { lineModeInput, nextStep } from './foldToolRegistry';

/**
 * The step builder over the real bridge, in-process: the picks a folder makes
 * on the folded pane — resolved by the canvas's own picking, against the
 * engine's own scene and landmarks — built into the document's ops, which the
 * engine then folds. What the canvas previews and commits is exactly this.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

async function engine(): Promise<FoldEngineCalls> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  return createFoldEngineCalls(new wasm.FoldEngine());
}

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

/** A state as the canvas reads it: its scene and landmarks, indexed. */
function indexOf(calls: FoldEngineCalls, state: number): FoldPickIndex {
  return foldPickIndex(calls.scene(state), calls.landmarks(state, []), []);
}

const RADII = { point: 0.02, line: 0.02 };

/** The clicks a line mode takes, at these scene points of the folded pane, as the canvas resolves them. */
function clicks(index: FoldPickIndex, mode: FoldLineModeId, at: readonly Point[], pane: FoldPaneId = 'folded'): FoldPick[] {
  const model = lineModeInput(mode);
  return at.map((point, k) => {
    const step = nextStep(model, k);
    if (!step) throw new Error('too many clicks');
    const pick = resolveFoldPick(index, pane, point, RADII, { snap: step.snap, edges: step.edges, free: false });
    if (!pick) throw new Error(`nothing to pick at ${point.x}, ${point.y}`);
    return pick;
  });
}

function intent(partial: Partial<FoldStepIntent> & Pick<FoldStepIntent, 'lineMode' | 'picks'>): FoldStepIntent {
  return {
    kind: 'valley',
    candidate: null,
    swapped: false,
    seed: { scope: 'all' },
    precreaseDirection: 'valley',
    ...partial,
  };
}

/** An axiom's root as the canvas takes it at first: the first the engine names. */
function rootOf(calls: FoldEngineCalls, state: number, line: FoldAxiomLine) {
  const { candidates } = landed(calls.axiomCandidates(state, line));
  const [first] = candidates;
  if (!first) throw new Error('no root');
  return first;
}

/** Ask the engine for an axiom's root when it is one, as the canvas does, then build and fold. */
function fold(calls: FoldEngineCalls, state: number, wanted: FoldStepIntent): { state: number; op: FoldOp; choices?: FoldChoices } {
  const index = indexOf(calls, state);
  const axiom = axiomLineOfPicks(wanted.lineMode, wanted.picks);
  const built = buildFoldStep(axiom ? { ...wanted, candidate: rootOf(calls, state, axiom) } : wanted, index);
  if (built.status !== 'built') throw new Error(`not built: ${JSON.stringify(built)}`);
  const { op, choices } = built;
  return { state: landed(calls.step(state, op, choices)).state, op, ...(choices ? { choices } : {}) };
}

const p = (x: number, y: number): Point => ({ x, y });

describe.skipIf(!available)('the Fold step builder over the real bridge', () => {
  it('makes a kite base with the axioms, every input a sheet anchor in slot order', async () => {
    const calls = await engine();
    const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;

    // Precrease the diagonal through two corners (O1).
    let index = indexOf(calls, sheet);
    const diagonal = fold(
      calls,
      sheet,
      intent({ kind: 'precrease', lineMode: 'axiom-1', picks: clicks(index, 'axiom-1', [p(0, 0), p(1, 1)]) })
    );
    expect(diagonal.op).toMatchObject({
      kind: 'precrease',
      line: { via: 'axiom', axiom: 1, inputs: [{ kind: 'point', at: [0, 0] }, { kind: 'point', at: [1, 1] }] },
    });
    expect(diagonal.choices?.root).toBeDefined();
    expect(calls.summary(diagonal.state).creases.flat).toBe(1);

    // Each lower edge onto the diagonal (O3): the moving side is the axiom's.
    index = indexOf(calls, diagonal.state);
    const first = fold(
      calls,
      diagonal.state,
      intent({ lineMode: 'axiom-3', picks: clicks(index, 'axiom-3', [p(0.5, 0), p(0.62, 0.62)]) })
    );
    expect(first.op).toMatchObject({
      kind: 'valley',
      line: { via: 'axiom', axiom: 3, inputs: [{ kind: 'edge', a: [0, 0], b: [1, 0] }, { kind: 'edge' }] },
      seed: { scope: 'all' },
    });
    // The axiom carries the edge, so it says the side: nothing else is stored.
    expect(first.op).not.toHaveProperty('moving');
    index = indexOf(calls, first.state);
    const kite = fold(
      calls,
      first.state,
      intent({ lineMode: 'axiom-3', picks: clicks(index, 'axiom-3', [p(0, 0.5), p(0.62, 0.62)]) })
    );
    const summary = calls.summary(kite.state);
    expect(summary.faces).toBe(4);
    expect(summary.creases).toMatchObject({ valley: 2, flat: 1 });

    // Saved and opened again, the kite is the steps the tools made: none
    // locked, and the axiom folds still store no moving point.
    const made = [diagonal, first, kite].map((folded, k) =>
      step(`fstep-${k + 1}`, k === 0 ? null : `fstep-${k}`, folded.op, folded.choices ? { choices: folded.choices } : {})
    );
    const saved = JSON.stringify(writeFoldSequence({ document: sequenceOf(made), readOnlyRaw: null }));
    const reopened = readFoldSequence(JSON.parse(saved))?.document.steps ?? [];
    expect(reopened.map(isLockedStep)).toEqual([false, false, false]);
    // As saved: JSON has no -0, so a root's d = -0 comes back 0.
    expect(JSON.parse(JSON.stringify(reopened))).toEqual(JSON.parse(JSON.stringify(made)));

    // Unfold the first flap by its bend: the seed is the face hinged on that
    // bend, just beside its middle — not a cell picked by area, where the
    // kite's two flaps tie and one browser's rounding took the other.
    index = indexOf(calls, kite.state);
    const bend = clicks(index, 'crease', [p(0.5, 0.2071)])[0];
    if (bend?.kind !== 'segment') throw new Error('no bend picked');
    const built = buildFoldStep(intent({ lineMode: 'crease', picks: [bend] }), index);
    if (built.status !== 'built' || built.op.kind !== 'valley' || built.op.seed.scope !== 'depth') {
      throw new Error(`not an unfold by depth: ${JSON.stringify(built)}`);
    }
    const [sx, sy] = built.op.seed.at;
    // Below the bend y = x tan 22.5° on the sheet: the flap folded from the bottom edge.
    expect(sy).toBeLessThan(sx * Math.tan(Math.PI / 8));
    const beside = besideBend(index, bend, built.sceneLine, built.movingSign);
    expect(beside?.sheet).toEqual(built.op.seed.at);
    const middle = { x: (bend.scene[0].x + bend.scene[1].x) / 2, y: (bend.scene[0].y + bend.scene[1].y) / 2 };
    expect(Math.hypot((beside?.scene.x ?? 9) - middle.x, (beside?.scene.y ?? 9) - middle.y)).toBeLessThan(1e-3);
    const unfolded = landed(calls.step(kite.state, built.op, built.choices));
    expect(calls.summary(unfolded.state).creases).toMatchObject({ valley: 1, flat: 2 });
  });

  it('folds a book along a free line and unfolds its top half along the bend', async () => {
    const calls = await engine();
    const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    let index = indexOf(calls, sheet);
    // Clicked off the paper at both ends: the stored points are on it.
    const book = fold(calls, sheet, intent({ lineMode: 'free', picks: clicks(index, 'free', [p(0.5, -0.2), p(0.5, 1.2)]) }));
    if (book.op.kind !== 'valley' || book.op.line.via !== 'free') throw new Error('not a free fold');
    for (const [x, y] of book.op.line.through) {
      expect(x).toBeCloseTo(0.5, 9);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    // An even split: the side to the right of the line as drawn (bottom to top) moves.
    expect(book.op.moving?.[0]).toBeGreaterThan(0.5);
    expect(calls.summary(book.state).faces).toBe(2);

    // The existing crease: the bend, as a sheet point inside it; the top flap only.
    index = indexOf(calls, book.state);
    const unfold = fold(
      calls,
      book.state,
      intent({ lineMode: 'crease', picks: clicks(index, 'crease', [p(0.5, 0.5)]) })
    );
    expect(unfold.op).toMatchObject({ kind: 'valley', line: { via: 'crease' }, landing: { kind: 'outer' }, seed: { scope: 'depth', layers: 1 } });
    const after = calls.summary(unfold.state);
    expect(after.creases).toMatchObject({ valley: 0, flat: 1 });
  });

  it('precreases through four layers, then refolds the precrease', async () => {
    const calls = await engine();
    const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    let index = indexOf(calls, sheet);
    const book = fold(calls, sheet, intent({ lineMode: 'free', picks: clicks(index, 'free', [p(0.5, -0.2), p(0.5, 1.2)]) }));
    index = indexOf(calls, book.state);
    const quarter = fold(
      calls,
      book.state,
      intent({ lineMode: 'free', picks: clicks(index, 'free', [p(-0.2, 0.5), p(0.7, 0.5)]) })
    );
    expect(Math.max(...calls.scene(quarter.state).subfaces.map((cell) => cell.faces_top_to_bottom.length))).toBe(4);

    // The quarter's diagonal, by its corners: through all four layers.
    index = indexOf(calls, quarter.state);
    const corners = index.folded.points.filter((point) => point.provenance === 'vertex').map((point) => point.at);
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const precrease = fold(
      calls,
      quarter.state,
      intent({ kind: 'precrease', lineMode: 'axiom-1', picks: clicks(index, 'axiom-1', [p(x0, y0), p(x1, y1)]) })
    );
    expect(calls.summary(precrease.state).creases.flat).toBe(4);

    // Refold it, as an existing crease: a flat crease is refolded, never unfolded.
    index = indexOf(calls, precrease.state);
    const refold = fold(
      calls,
      precrease.state,
      intent({ lineMode: 'crease', picks: clicks(index, 'crease', [p((x0 + x1) / 2, (y0 + y1) / 2)]) })
    );
    expect(refold.op).toMatchObject({ kind: 'valley', line: { via: 'crease' }, landing: { kind: 'outer' } });
    expect(calls.summary(refold.state).creases.flat).toBe(0);
  });

  it('refuses a free line that misses the paper, and finds a moving point on the side with paper', async () => {
    const calls = await engine();
    const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    const index = indexOf(calls, sheet);
    const off = buildFoldStep(intent({ lineMode: 'free', picks: clicks(index, 'free', [p(1.5, -1), p(1.5, 2)]) }), index);
    expect(off).toMatchObject({ status: 'refused', refused: { refusal: { code: 'no_moving_side' } } });

    // A line beside the paper: no point on the side without it, one on the other.
    const line = { n: [1, 0] as const, d: 0.25 };
    expect(movingPoint(index, line, 1)?.sheet[0]).toBeGreaterThan(0.25);
    expect(movingPoint(index, { n: [1, 0], d: 1.5 }, 1)).toBeNull();
    expect(freeLineThrough(index, { n: [1, 0], d: 1.5 })).toBeNull();
  });

  it('answers a pointer move within the tier-1 budget on a many-layered state (D14: 4 ms)', async () => {
    const calls = await engine();
    let state = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    // Fold in half six times, alternating the axis: 64 layers, every face over
    // the last — the deepest stack a pointer move reads through.
    for (let k = 0; k < 6; k += 1) {
      const scene = calls.scene(state);
      const xs = scene.subfaces.flatMap((cell) => cell.polygon.map((point) => point.x));
      const ys = scene.subfaces.flatMap((cell) => cell.polygon.map((point) => point.y));
      const vertical = k % 2 === 0;
      const middle = vertical ? (Math.min(...xs) + Math.max(...xs)) / 2 : (Math.min(...ys) + Math.max(...ys)) / 2;
      state = landed(
        calls.step(state, {
          kind: 'valley',
          line: { via: 'model', line: { n: vertical ? [1, 0] : [0, 1], d: middle } },
          side: 'positive',
          seed: { scope: 'all' },
        })
      ).state;
    }
    const index = indexOf(calls, state);
    expect(Math.max(...index.subfaces.map((cell) => cell.stack.length))).toBe(64);
    const box = index.subfaces.flatMap((cell) => cell.polygon);
    const [x0, x1] = [Math.min(...box.map((q) => q.x)), Math.max(...box.map((q) => q.x))];
    const [y0, y1] = [Math.min(...box.map((q) => q.y)), Math.max(...box.map((q) => q.y))];
    // A pointer sweeping the form: every snap a step can ask for, the free point among them.
    const moves = 3000;
    const started = performance.now();
    for (let k = 0; k < moves; k += 1) {
      const at = { x: x0 + ((k * 0.618) % 1) * (x1 - x0), y: y0 + ((k * 0.382) % 1) * (y1 - y0) };
      resolveFoldPick(index, 'folded', at, RADII, { snap: 'point', edges: true, free: false });
      resolveFoldPick(index, 'folded', at, RADII, { snap: 'crease-required', edges: true, free: false });
      resolveFoldPick(index, 'folded', at, RADII, { snap: 'point', edges: true, free: true });
      resolveFoldPick(index, 'crease-pattern', at, RADII, { snap: 'crease-required', edges: false, free: false });
    }
    const perMove = (performance.now() - started) / moves;
    expect(perMove).toBeLessThan(4);
  });

  it('turns a swap into a moving point on the other side, which the engine folds', async () => {
    const calls = await engine();
    const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    const index = indexOf(calls, sheet);
    const picks = clicks(index, 'free', [p(0.3, -0.2), p(0.3, 1.2)]);
    const plain = buildFoldStep(intent({ lineMode: 'free', picks }), index);
    const swapped = buildFoldStep(intent({ lineMode: 'free', picks, swapped: true }), index);
    if (plain.status !== 'built' || swapped.status !== 'built') throw new Error('not built');
    if (plain.op.kind !== 'valley' || swapped.op.kind !== 'valley') throw new Error('not valleys');
    // Less paper moves by default: the strip left of x = 0.3.
    expect(plain.op.moving?.[0]).toBeLessThan(0.3);
    expect(swapped.op.moving?.[0]).toBeGreaterThan(0.3);
    expect(swapped.movingSign).toBe(-plain.movingSign);
    landed(calls.apply(sheet, swapped.op));
  });

  it('turns an axiom’s own side round on a swap — the owner’s point onto point — whatever the fold or the seed', async () => {
    const calls = await engine();
    const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    const index = indexOf(calls, sheet);
    // Axiom 2: the top-left corner, then the bottom-right one. The axiom
    // moves the first onto the second; Swap, the second onto the first.
    const picks = clicks(index, 'axiom-2', [p(0, 1), p(1, 0)]);
    const line = axiomLineOfPicks('axiom-2', picks);
    if (!line) throw new Error('not located');
    const candidate = rootOf(calls, sheet, line);
    expect(candidate.side).not.toBeNull();
    // Where the paper just inside each corner lies once folded.
    const imageOf = (state: number, at: SheetPoint): Point => {
      const scene = calls.scene(state);
      const face = scene.faces.findIndex(({ points }) =>
        insideConvex(
          points.map((v) => scene.sheet_points[v]!),
          toPoint(at)
        )
      );
      return applyIsometry(scene.face_transforms[face]!, toPoint(at));
    };
    const [topLeft, bottomRight]: SheetPoint[] = [
      [0.02, 0.98],
      [0.98, 0.02],
    ];
    const near = (a: Point, b: Point) => expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-9);
    const built = (kind: FoldStepIntent['kind'], swapped: boolean, seed: FoldStepIntent['seed'] = { scope: 'all' }) => {
      const step = buildFoldStep(intent({ kind, lineMode: 'axiom-2', picks, candidate, swapped, seed }), index);
      if (step.status !== 'built') throw new Error(`not built: ${JSON.stringify(step)}`);
      return { step, folded: landed(calls.step(sheet, step.op, step.choices)) };
    };
    for (const kind of ['valley', 'mountain', 'precrease'] as const) {
      const [plain, swapped] = [built(kind, false), built(kind, true)];
      // The axiom says the side: nothing is stored for it, until a swap names the other.
      expect(plain.step.op).not.toHaveProperty('moving');
      expect(swapped.step.op).toHaveProperty('moving');
      expect(swapped.step.movingSign).toBe(-plain.step.movingSign);
      expect(swapped.folded.report?.side, kind).not.toBe(plain.folded.report?.side);
      if (kind === 'precrease') continue;
      near(imageOf(plain.folded.state, topLeft), imageOf(sheet, bottomRight));
      near(imageOf(swapped.folded.state, topLeft), imageOf(sheet, topLeft));
      near(imageOf(swapped.folded.state, bottomRight), imageOf(sheet, topLeft));
      // Saved and opened again, the swapped step replays to the same state.
      const made = [step('fstep-1', null, swapped.step.op, swapped.step.choices ? { choices: swapped.step.choices } : {})];
      const saved = JSON.stringify(writeFoldSequence({ document: sequenceOf(made), readOnlyRaw: null }));
      const [reopened] = readFoldSequence(JSON.parse(saved))?.document.steps ?? [];
      if (!reopened || isLockedStep(reopened)) throw new Error(`not reopened: ${JSON.stringify(reopened)}`);
      expect(reopened.op).toEqual(swapped.step.op);
      expect(landed(calls.step(sheet, reopened.op, reopened.choices)).fingerprint).toBe(swapped.folded.fingerprint);
    }
    // The flap picked after a swap is the swapped side's: the swap still
    // names its side, which the flap's own point alone would lose to the axiom's.
    const flap = { faces: [0], witness: bottomRight };
    const picked = built('valley', true, { scope: 'flaps', flaps: [flap] });
    expect(picked.step.op).toMatchObject({ seed: { scope: 'flaps', at: [bottomRight] } });
    expect(picked.step.op).toHaveProperty('moving');
    near(imageOf(picked.folded.state, bottomRight), imageOf(sheet, topLeft));
  });
});
