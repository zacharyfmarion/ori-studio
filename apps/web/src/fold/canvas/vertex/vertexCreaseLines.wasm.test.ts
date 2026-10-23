import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Point } from '../../../lib/geometry';
import { parseNativeProjectFile } from '../../../lib/nativeProjectFile';
import {
  isLockedStep,
  vertexDirectionOf,
  type FoldSequenceDocument,
  type FoldStep,
  type FoldVertexOp,
} from '../../document/foldSequenceDocument';
import { readFoldSequences } from '../../document/foldSequenceFile';
import { createFoldEngineCalls, type FoldEngineCalls } from '../../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from '../../engine/foldEngineCompoundCalls';
import type { FoldVertexAnalysis } from '../../engine/foldEngineSquashWire';
import type { FoldEngineOutcome, FoldLetter } from '../../engine/foldEngineWire';
import { applyIsometry, insideConvex, nearestOnSegment, polygonCentroid } from '../foldCanvasGeometry';
import type { FoldPaneCreaseLine } from '../foldPaneScenes';
import { foldPickIndex } from '../foldPicking';
import { vertexCreaseLines } from './vertexOverlay';

/**
 * The letters the folded pane draws a vertex fold's creases in
 * (`vertexCreaseLines`) against what the fold, landed, shows the viewer: each
 * crease the step made or refolded, placed on the state it folds from by the
 * layer it lies in, read on the paper on top there — its front-relative
 * letter, the other one where that layer shows its back. Steps from the
 * example projects (`tests/fixtures/fold-examples`), replayed through the
 * real bridge: a swivel's two branches, by its edge, one per ridge; the petal
 * folds front and back, by H's ends; the squashes. The engine's rules are in `compound/fan.rs`, `petal.rs` and
 * `squash.rs`.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const EXAMPLES = resolve(ROOT, '../../tests/fixtures/fold-examples');
const available = existsSync(WASM) && existsSync(EXAMPLES);

interface Engine {
  calls: FoldEngineCalls;
  compound: FoldEngineCompoundCalls;
}

async function engine(): Promise<Engine> {
  const wasm = await import('../../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const fold = new wasm.FoldEngine();
  return { calls: createFoldEngineCalls(fold), compound: createFoldEngineCompoundCalls(fold) };
}

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

function opened(name: string): FoldSequenceDocument {
  const project = parseNativeProjectFile(readFileSync(resolve(EXAMPLES, name), 'utf8'));
  const [held] = readFoldSequences(project.workspace.foldSequences);
  if (!held) throw new Error(`${name}: no sequence`);
  return held.document;
}

/** The state the `n`th step of the file (1 for its first) folds from, replayed from the sheet along its parents, and the step. */
function parentOf({ calls }: Engine, document: FoldSequenceDocument, n: number): { state: number; step: FoldStep } {
  const steps = new Map(
    document.steps.map((node) => {
      if (isLockedStep(node)) throw new Error(`${node.id} is locked`);
      return [node.id, node] as const;
    })
  );
  const step = [...steps.values()][n - 1];
  if (!step) throw new Error(`no step ${n}`);
  const path: FoldStep[] = [];
  for (let at = step.parent ? steps.get(step.parent) : undefined; at; at = at.parent ? steps.get(at.parent) : undefined) {
    path.unshift(at);
  }
  let state = landed(calls.sheet(document.paper)).state;
  for (const each of path) state = landed(calls.step(state, each.op, each.choices)).state;
  return { state, step };
}

const other = (letter: FoldLetter): FoldLetter => (letter === 'valley' ? 'mountain' : 'valley');

interface Seen {
  /** On the folded pane of the state the step folds from. */
  at: Point;
  /** As the viewer sees it on its layer. */
  letter: FoldLetter;
  /** Its layer's place in the stack there: 0 on top. */
  depth: number;
}

/** Each crease the step that landed `child` made or refolded, as the viewer sees it on `parent` (see the module docs). */
function seenCreases({ calls }: Engine, parent: number, child: number): Seen[] {
  const scene = calls.scene(parent);
  const diff = landed(calls.stepSummary(child)).summary?.diff;
  if (!diff) throw new Error('no step summary');
  const made = new Set([...diff.added, ...diff.reversed, ...diff.refolded.map((refold) => refold.edge)]);
  const seen: Seen[] = [];
  for (const crease of calls.scene(child).creases) {
    if (!made.has(crease.id) || !crease.letter) continue;
    const middle = { x: (crease.from.x + crease.to.x) / 2, y: (crease.from.y + crease.to.y) / 2 };
    scene.faces.forEach((face, k) => {
      const ring = face.points.map((vertex) => scene.sheet_points[vertex]!);
      const transform = scene.face_transforms[k];
      if (!transform || !insideConvex(ring, middle, 1e-9)) return;
      const [a, b, , d, e] = transform;
      const back = a * e - b * d < 0;
      // The layer's place where it lies, a little inside the face from the crease.
      const centre = polygonCentroid(ring);
      const probe = applyIsometry(transform, {
        x: middle.x + (centre.x - middle.x) * 0.05,
        y: middle.y + (centre.y - middle.y) * 0.05,
      });
      const stack = scene.subfaces.find(
        (cell) => insideConvex(cell.polygon, probe, 1e-9) && cell.faces_top_to_bottom.includes(k)
      )?.faces_top_to_bottom;
      seen.push({
        at: applyIsometry(transform, middle),
        letter: back ? other(crease.letter!) : crease.letter!,
        depth: stack ? stack.indexOf(k) : -1,
      });
    });
  }
  return seen;
}

/** The letter of the drawn crease that runs through `at`, or null for none. */
function drawnAt(drawn: readonly FoldPaneCreaseLine[], at: Point): FoldLetter | null {
  const through = drawn.find(({ line: [a, b] }) => {
    const near = nearestOnSegment(at, a, b);
    return Math.hypot(near.x - at.x, near.y - at.y) < 1e-6;
  });
  return through?.letter ?? null;
}

/** What the tool draws for `op` on `state`: the engine's description, its fourth ray the op's. */
function drawn({ calls, compound }: Engine, state: number, op: FoldVertexOp): FoldPaneCreaseLine[] {
  const answer = landed(compound.compoundAnalysis(state, op));
  if (answer.family !== 'vertex') throw new Error(`answered for ${answer.family}`);
  const analysis: FoldVertexAnalysis = answer.analysis;
  const emergent = analysis.kind === 'rabbit-ear' || analysis.kind === 'swivel' ? analysis.emergent : null;
  return vertexCreaseLines(foldPickIndex(calls.scene(state), calls.landmarks(state, []), []), { analysis, emergent }, vertexDirectionOf(op));
}

/** The step as the file stores it, landed on its parent: what it shows the viewer, and what the pane draws. */
function compare(engined: Engine, name: string, n: number, op?: (stored: FoldVertexOp) => FoldVertexOp) {
  const { state, step } = parentOf(engined, opened(name), n);
  const stored = step.op as FoldVertexOp;
  const folded = op ? op(stored) : stored;
  const child = landed(engined.calls.step(state, folded, op ? undefined : step.choices)).state;
  return { state, op: folded, seen: seenCreases(engined, state, child), drawn: drawn(engined, state, folded) };
}

describe.skipIf(!available)('a vertex fold’s creases on the folded pane, against what the fold shows the viewer', () => {
  // Step 1 is the diagonal precrease; each branch from it swivels the bottom edge onto it.
  it.each([2, 3])('letters swivel step %i, by its edge, as its landed creases show: three the direction’s way, the ridge the other', async (n) => {
    const { seen, drawn: lines } = compare(await engine(), 'swivel-fold.osf', n);
    expect(seen).toHaveLength(4);
    for (const crease of seen) expect(drawnAt(lines, crease.at)).toBe(crease.letter);
    expect(lines.map((line) => line.letter).sort()).toEqual(['mountain', 'valley', 'valley', 'valley']);
  });

  it.each([8, 12])('letters petal fold %i as the top layer shows it: H the direction’s way, the kites the other', async (n) => {
    const { seen, drawn: lines } = compare(await engine(), 'petal-fold.osf', n);
    const top = seen.filter((crease) => crease.depth === 0);
    expect(top.length).toBeGreaterThan(0);
    for (const crease of top) expect(drawnAt(lines, crease.at)).toBe(crease.letter);
    // H and both kites, as the top layer shows them.
    expect(new Set(top.map((crease) => drawnAt(lines, crease.at)))).toEqual(new Set(['valley', 'mountain']));
  });

  it('letters a squash landing off its hinge as its layers show: the upper crease on top, the lower beneath', async () => {
    const engined = await engine();
    const aimed = compare(engined, 'petal-fold.osf', 3, (stored) => {
      const answer = landed(engined.compound.compoundAnalysis(parentOf(engined, opened('petal-fold.osf'), 3).state, stored));
      if (answer.family !== 'vertex' || answer.analysis.kind !== 'squash') throw new Error('not a squash');
      const [hx, hy] = answer.analysis.hinge_direction;
      const [sx, sy] = answer.analysis.spine_direction;
      return { ...stored, kind: 'squash', target: [hx + 0.3 * sx, hy + 0.3 * sy] } as FoldVertexOp;
    });
    const way = vertexDirectionOf(aimed.op);
    expect(aimed.drawn.map((line) => line.letter)).toEqual([way, other(way)]);
    expect(aimed.seen.some((crease) => crease.depth === 0)).toBe(true);
    expect(aimed.seen.some((crease) => crease.depth === 1)).toBe(true);
    for (const crease of aimed.seen) {
      if (crease.depth <= 1) expect(drawnAt(aimed.drawn, crease.at), `depth ${crease.depth}`).toBe(crease.letter);
    }
  });

  it('draws a squash landing on its hinge once, the direction’s way, as the step’s own picture draws it', async () => {
    const engined = await engine();
    const { state, op, seen, drawn: lines } = compare(engined, 'petal-fold.osf', 3);
    expect(lines).toHaveLength(1);
    // The two layers crease on one line: the lower one the direction's way, the upper — on top — the other.
    expect(seen.find((crease) => crease.depth === 1)?.letter).toBe(vertexDirectionOf(op));
    expect(seen.find((crease) => crease.depth === 0)?.letter).toBe(other(vertexDirectionOf(op)));
    // The pane draws the line as the step's picture (the Diagram's too) does: the lower crease.
    expect(lines[0]!.letter).toBe(landed(engined.calls.action(state, op)).action.direction);
  });
});
