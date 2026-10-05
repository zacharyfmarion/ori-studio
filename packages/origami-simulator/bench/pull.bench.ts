// How a pull behaves on real models.
//
//   npm run bench:pull
//
// Folds a model, pins part of it, and drags the triangle farthest from the pins
// across the screen the way the Pull tool does: a grip on the cursor's ray, moved
// 40 frames of 80 steps (the worker's GPU tick), held 20, let go and settled.
// It reports how closely the paper followed the cursor, how much of the drag the
// pose kept, and how far it moved after being let go — the numbers behind
// implementation-plans/simulator-pull-tool.md — and fails if anything springs
// back or a pinned node moves.
//
// CPU only: `bench:gpu-parity` holds the GPU to the reference through a pull.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import { OrigamiModel } from '../src/model.js';
import { ReferenceSolver } from '../src/referenceSolver.js';
import { SimulationClock } from '../src/simulationClock.js';
import { sourceFaceGroups } from '../src/coplanarRuns.js';
import { meshTopologyFor } from '../src/webgl/meshRenderer.js';
import type { FoldDocument } from '../src/types.js';

type Vec3 = [number, number, number];

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures');
const FRAMES_MOVING = 40;
const FRAMES_HELD = 20;
const STEPS_PER_FRAME = 80;
const DRAG = 0.25;
/** After release the grabbed point may not move more than this (model radius 1). */
const SPRINGBACK_LIMIT = 0.005;

interface Scenario {
  name: string;
  file: string;
  percent: number;
  stepsPerPercent: number;
  pins: (model: OrigamiModel, groups: Int32Array) => Set<number>;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.max(1e-12, length(a)));
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const at = (positions: Float32Array, node: number): Vec3 => [positions[node * 3]!, positions[node * 3 + 1]!, positions[node * 3 + 2]!];

/** The app scales a document into the solver's unit range before preparing it. */
function scaledForSolver(fold: FoldDocument): FoldDocument {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const coord of fold.vertices_coords) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, coord[axis] ?? 0);
      max[axis] = Math.max(max[axis]!, coord[axis] ?? 0);
    }
  }
  const span = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
  if (!(span > 0) || (span > 0.5 && span <= 2)) return fold;
  return {
    ...fold,
    vertices_coords: fold.vertices_coords.map((c) => [
      ((c[0] ?? 0) - min[0]!) / span,
      ((c[1] ?? 0) - min[1]!) / span,
      ((c[2] ?? 0) - min[2]!) / span,
    ]),
  };
}

function largestFaces(count: number) {
  return (model: OrigamiModel, groups: Int32Array) => {
    const area = new Map<number, number>();
    const { indices } = model.prepared;
    for (let t = 0; t < groups.length; t += 1) {
      const a = at(model.originalPositions, indices[t * 3]!);
      const b = at(model.originalPositions, indices[t * 3 + 1]!);
      const c = at(model.originalPositions, indices[t * 3 + 2]!);
      area.set(groups[t]!, (area.get(groups[t]!) ?? 0) + length(cross(sub(b, a), sub(c, a))) / 2);
    }
    return new Set([...area].sort((x, y) => y[1] - x[1]).slice(0, count).map(([group]) => group));
  };
}

/** Faces whose flat centre lies within `radius` of the sheet's leftmost vertex. */
function cornerFaces(radius: number) {
  return (model: OrigamiModel, groups: Int32Array) => {
    const rest = model.originalPositions;
    let corner = 0;
    for (let v = 0; v < model.prepared.vertexCount; v += 1) if (rest[v * 3]! < rest[corner * 3]!) corner = v;
    const { indices } = model.prepared;
    const faces = new Set<number>();
    for (let t = 0; t < groups.length; t += 1) {
      const centre = scale(add(add(at(rest, indices[t * 3]!), at(rest, indices[t * 3 + 1]!)), at(rest, indices[t * 3 + 2]!)), 1 / 3);
      if (length(sub(centre, at(rest, corner))) < radius) faces.add(groups[t]!);
    }
    return faces;
  };
}

const SCENARIOS: Scenario[] = [
  { name: 'kabuto 100%', file: 'kabuto-simulation.fold', percent: 100, stepsPerPercent: 300, pins: largestFaces(2) },
  { name: 'kabuto 60%', file: 'kabuto-simulation.fold', percent: 60, stepsPerPercent: 300, pins: largestFaces(2) },
  { name: 'iguana 90%', file: 'iguana-split-crease.fold', percent: 90, stepsPerPercent: 200, pins: cornerFaces(0.35) },
];

interface Row {
  scenario: string;
  view: string;
  drag: string;
  /** How far the grabbed point is from the cursor's ray at release, as a share of the drag. */
  miss: number;
  /** How much of the drag the settled pose kept, along the drag. */
  kept: number;
  springback: number;
  pinnedMoved: number;
  peakStrain: number;
  settleSteps: number;
  movedCreases: number;
}

function settle(solver: ReferenceSolver): number {
  return new SimulationClock({ chunkSteps: 100 }).runToConvergence(solver, 60_000).steps;
}

/** The scenario's model folded, settled and pinned: where every drag starts. */
function foldAndPin(scenario: Scenario) {
  const fold = JSON.parse(readFileSync(resolve(FIXTURES, scenario.file), 'utf8')) as FoldDocument;
  const prepared = prepareFoldModel(scaledForSolver(fold), { triangulate: true });
  const model = new OrigamiModel(prepared);
  const solver = new ReferenceSolver(model, { timeStepScale: 0.35, foldPercent: 0 });
  for (let percent = 0; percent <= scenario.percent; percent += 1) {
    solver.setFoldPercent(percent);
    solver.step(scenario.stepsPerPercent);
  }
  settle(solver);
  const groups = sourceFaceGroups(meshTopologyFor(prepared));
  const pinnedFaces = scenario.pins(model, groups);
  const mask = new Uint8Array(prepared.vertexCount);
  for (let t = 0; t < groups.length; t += 1) {
    if (pinnedFaces.has(groups[t]!)) for (let k = 0; k < 3; k += 1) mask[prepared.indices[t * 3 + k]!] = 1;
  }
  solver.setFixedNodes(mask);
  settle(solver);
  return { prepared, model, solver, mask };
}

function runScenario(scenario: Scenario): Row[] {
  const { prepared, model, mask } = foldAndPin(scenario);

  // The triangle farthest from the pins, gripped at its centre.
  const start = model.positions.slice();
  let pinCentre: Vec3 = [0, 0, 0];
  let pinCount = 0;
  for (let v = 0; v < prepared.vertexCount; v += 1) {
    if (!mask[v]) continue;
    pinCentre = add(pinCentre, at(start, v));
    pinCount += 1;
  }
  pinCentre = scale(pinCentre, 1 / pinCount);
  let grabbed = -1;
  let farthest = -1;
  for (let t = 0; t < prepared.faceCount; t += 1) {
    const nodes = [prepared.indices[t * 3]!, prepared.indices[t * 3 + 1]!, prepared.indices[t * 3 + 2]!];
    if (nodes.some((node) => mask[node])) continue;
    const centre = scale(add(add(at(start, nodes[0]!), at(start, nodes[1]!)), at(start, nodes[2]!)), 1 / 3);
    const distance = length(sub(centre, pinCentre));
    if (distance > farthest) {
      farthest = distance;
      grabbed = t;
    }
  }
  const nodes: [number, number, number] = [
    prepared.indices[grabbed * 3]!,
    prepared.indices[grabbed * 3 + 1]!,
    prepared.indices[grabbed * 3 + 2]!,
  ];
  const gripPoint = (positions: Float32Array): Vec3 =>
    scale(add(add(at(positions, nodes[0]), at(positions, nodes[1])), at(positions, nodes[2])), 1 / 3);
  const origin = gripPoint(start);
  const normal = unit(cross(sub(at(start, nodes[1]), at(start, nodes[0])), sub(at(start, nodes[2]), at(start, nodes[0]))));
  const outward0 = sub(origin, pinCentre);
  const outward = unit(sub(outward0, scale(normal, dot(outward0, normal))));
  const side = unit(cross(outward, normal));
  const tilt = (toward: Vec3) => unit(add(scale(normal, Math.cos(Math.PI / 3)), scale(toward, Math.sin(Math.PI / 3))));
  // Toward the eye: straight down on the face, tilted 60° to its side, and end-on.
  const views: Array<[string, Vec3]> = [
    ['top', normal],
    ['oblique', tilt(side)],
    ['end-on', tilt(outward)],
  ];

  const rows: Row[] = [];
  for (const [view, eye] of views) {
    const across = unit(sub(outward, scale(eye, dot(outward, eye))));
    const drags: Array<[string, Vec3]> = [
      ['outward', across],
      ['inward', scale(across, -1)],
      ['sideways', unit(cross(eye, across))],
    ];
    for (const [drag, direction] of drags) {
      const { model, solver } = foldAndPin(scenario);
      const rayThrough = (target: Vec3) => ({ origin: add(target, scale(eye, 5)), direction: scale(eye, -1) });
      solver.beginPull({ nodes, weights: [1 / 3, 1 / 3, 1 / 3], ray: rayThrough(origin) });
      let peakStrain = 0;
      let target = origin;
      for (let frame = 1; frame <= FRAMES_MOVING + FRAMES_HELD; frame += 1) {
        target = add(origin, scale(direction, DRAG * Math.min(1, frame / FRAMES_MOVING)));
        solver.movePull(rayThrough(target));
        solver.step(STEPS_PER_FRAME);
        peakStrain = Math.max(peakStrain, solver.readDiagnostics().maxNodalStrain ?? 0);
      }
      const released = gripPoint(model.positions);
      const offRay = sub(released, target);
      const miss = length(sub(offRay, scale(eye, dot(offRay, eye)))) / DRAG;
      const { movedCreases } = solver.endPull('keep');
      const settleSteps = settle(solver);
      const settled = gripPoint(model.positions);
      let pinnedMoved = 0;
      for (let v = 0; v < prepared.vertexCount; v += 1) {
        if (mask[v]) pinnedMoved = Math.max(pinnedMoved, length(sub(at(model.positions, v), at(start, v))));
      }
      rows.push({
        scenario: scenario.name,
        view,
        drag,
        miss,
        kept: dot(sub(settled, origin), direction) / DRAG,
        springback: length(sub(settled, released)),
        pinnedMoved,
        peakStrain,
        settleSteps,
        movedCreases,
      });
    }
  }
  return rows;
}

describe('pulling real models', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name}: nothing springs back and the pins hold`, () => {
      const rows = runScenario(scenario);
      const lines = rows.map(
        (row) =>
          `${row.scenario.padEnd(12)} ${row.view.padEnd(8)} ${row.drag.padEnd(9)} ` +
          `under cursor ${(100 * (1 - row.miss)).toFixed(0).padStart(4)}%  kept ${(100 * row.kept).toFixed(0).padStart(4)}%  ` +
          `springback ${row.springback.toFixed(4)}  peak strain ${(100 * row.peakStrain).toFixed(1).padStart(4)}%  ` +
          `creases moved ${String(row.movedCreases).padStart(3)}  settled in ${row.settleSteps}`
      );
      process.stdout.write(`\n${lines.join('\n')}\n`);
      for (const row of rows) {
        const label = `${row.scenario} ${row.view} ${row.drag}`;
        expect(row.springback, `${label} sprang back`).toBeLessThan(SPRINGBACK_LIMIT);
        expect(row.pinnedMoved, `${label} moved a pin`).toBe(0);
      }
    });
  }
});
