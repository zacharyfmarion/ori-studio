#!/usr/bin/env node
/**
 * Snap a crease pattern's vertices onto the regular lattice it was drawn on.
 *
 * ## The problem this solves
 *
 * Origami Simulator's SVGs store coordinates to three decimals. A design whose
 * sector angles are exactly 60/120/150 degrees comes out as
 * 60.000131/119.999068/149.999670, and the checks — which ask exact geometric
 * questions against a 1e-6 degree bar — correctly report the rounding.
 *
 * Measured on `cross`: 122 Kawasaki violations and 27 vertices over the closure
 * bar, residuals 2.2e-3 to 1.4e-2 degrees. Every one of them an artefact of the
 * drawing rather than the design. Snapping cleared all 149.
 *
 * ## Only where the lattice is unambiguous
 *
 * Many patterns are genuinely free-form — `langCardinal` has 96 distinct edge
 * directions, `shell14` has 170 — and there is nothing to snap them to. Moving
 * points in those would invent geometry. So this **detects first and refuses
 * when it is not certain**, on three counts:
 *
 * 1. every edge direction is a multiple of 45 or 30 degrees, within tolerance;
 * 2. a pitch exists that every vertex sits close to, by a wide margin;
 * 3. the snap changes nothing structural — same vertex count, same edge count,
 *    no edge collapsed to zero length, no edge turned.
 *
 * The third is the one that matters most. Snapping moves every point in the
 * file, and the failure that would be easy to miss is two nearby vertices
 * landing on the same lattice point and quietly merging — which changes the
 * pattern rather than cleaning it. That is checked, not assumed, and a file that
 * trips any guard is left exactly as it was.
 *
 * Usage:
 *   node scripts/snap-to-lattice.mjs <dir|file...> [--out DIR] [--in-place]
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

/** How far an edge direction may sit from a lattice angle, in degrees. */
const DIRECTION_TOLERANCE = 1.0;

/**
 * Worst allowed vertex-to-lattice distance, as a fraction of the pitch.
 *
 * Real fits are nowhere near this: `cross` lands at 0.017% of its pitch and
 * `byu solar driven` at 0.004%. Two percent is loose enough to absorb a sloppier
 * export and still far from the point where "which lattice point did this mean"
 * becomes a guess.
 */
const FIT_TOLERANCE = 0.02;

const ROOT3 = Math.sqrt(3);

/** Distinct edge directions in degrees, folded to [0, 180). */
function edgeDirections(vertices, edges) {
  const directions = new Set();
  for (const [a, b] of edges) {
    const angle =
      (Math.atan2(vertices[b][1] - vertices[a][1], vertices[b][0] - vertices[a][0]) * 180) /
      Math.PI;
    directions.add(((angle % 180) + 180) % 180);
  }
  return [...directions];
}

/** `square`, `triangular`, or null when the pattern is free-form. */
function detectLattice(vertices, edges) {
  const directions = edgeDirections(vertices, edges);
  if (directions.length === 0) return null;
  const fits = (step) =>
    directions.every((d) => Math.min(d % step, step - (d % step)) <= DIRECTION_TOLERANCE);
  // 45 first: it is the stricter of the two, and a 45-degree pattern also
  // satisfies 90. A 30-degree pattern satisfies neither 45 nor 90.
  if (fits(45)) return 'square';
  if (fits(30)) return 'triangular';
  return null;
}

/** Lattice coordinates of a point, as reals. */
function toLattice(point, origin, pitch, kind) {
  const x = (point[0] - origin[0]) / pitch;
  const y = (point[1] - origin[1]) / pitch;
  if (kind === 'square') return [x, y];
  const b = (y * 2) / ROOT3;
  return [x - y / ROOT3, b];
}

/** The point at integer lattice coordinates. */
function fromLattice([a, b], origin, pitch, kind) {
  if (kind === 'square') return [origin[0] + a * pitch, origin[1] + b * pitch];
  return [origin[0] + pitch * (a + b / 2), origin[1] + pitch * ((b * ROOT3) / 2)];
}

/** Worst vertex-to-lattice distance for a candidate pitch and origin. */
function worstDistance(vertices, origin, pitch, kind, cutoff = Infinity) {
  let worst = 0;
  for (const vertex of vertices) {
    const [a, b] = toLattice(vertex, origin, pitch, kind);
    const snapped = fromLattice([Math.round(a), Math.round(b)], origin, pitch, kind);
    worst = Math.max(worst, Math.hypot(vertex[0] - snapped[0], vertex[1] - snapped[1]));
    if (worst > cutoff) return worst;
  }
  return worst;
}

/**
 * Shortest edge in the pattern, as the starting guess for the pitch.
 *
 * On a square lattice with diagonals the shortest edge is the pitch; on a
 * triangular one it is the pitch too. Both are then searched around.
 */
function shortestEdge(vertices, edges) {
  let shortest = Infinity;
  for (const [a, b] of edges) {
    const length = Math.hypot(vertices[b][0] - vertices[a][0], vertices[b][1] - vertices[a][1]);
    if (length > 1e-9) shortest = Math.min(shortest, length);
  }
  return shortest;
}

/** Fit pitch and origin, or null when nothing fits well enough. */
function fitLattice(vertices, edges, kind) {
  const base = shortestEdge(vertices, edges);
  if (!Number.isFinite(base) || base <= 0) return null;
  const anchor = vertices.reduce(
    (min, v) => [Math.min(min[0], v[0]), Math.min(min[1], v[1])],
    [Infinity, Infinity]
  );

  let best = null;
  // The shortest edge is usually the pitch, but a pattern may only contain
  // multiples of it, so halves and thirds are worth trying too.
  for (const divisor of [1, 2, 3]) {
    for (let step = -60; step <= 60; step += 1) {
      const pitch = (base / divisor) * (1 + step * 0.0002);
      if (pitch <= 0) continue;
      // Phase: shift the origin so the vertices sit on lattice points rather
      // than between them. Circular mean over the fractional parts.
      let origin = anchor;
      for (let pass = 0; pass < 2; pass += 1) {
        let sumX = 0;
        let sumY = 0;
        for (const vertex of vertices) {
          const [a, b] = toLattice(vertex, origin, pitch, kind);
          sumX += a - Math.round(a);
          sumY += b - Math.round(b);
        }
        const shift = fromLattice(
          [sumX / vertices.length, sumY / vertices.length],
          [0, 0],
          pitch,
          kind
        );
        origin = [origin[0] + shift[0], origin[1] + shift[1]];
      }
      const worst = worstDistance(vertices, origin, pitch, kind, best?.worst ?? Infinity);
      if (!best || worst < best.worst) best = { pitch, origin, worst, kind };
    }
  }
  if (!best || best.worst > best.pitch * FIT_TOLERANCE) return null;
  return best;
}

/**
 * Snap, or explain why not.
 *
 * Returns `{ fold, report }`. `fold` is null whenever anything was refused, and
 * the caller must then leave the original file untouched.
 */
export function snapToLattice(fold) {
  const vertices = fold.vertices_coords ?? [];
  const edges = fold.edges_vertices ?? [];
  if (vertices.length === 0 || edges.length === 0) {
    return { fold: null, report: { skipped: 'empty' } };
  }

  const kind = detectLattice(vertices, edges);
  if (!kind) {
    return {
      fold: null,
      report: { skipped: 'free-form', directions: edgeDirections(vertices, edges).length },
    };
  }

  const fit = fitLattice(vertices, edges, kind);
  if (!fit) return { fold: null, report: { skipped: 'no pitch fits', kind } };

  const snapped = vertices.map((vertex) => {
    const [a, b] = toLattice(vertex, fit.origin, fit.pitch, kind);
    return fromLattice([Math.round(a), Math.round(b)], fit.origin, fit.pitch, kind);
  });

  // --- Guards. Any failure leaves the file alone. ---------------------------

  // Two vertices landing on one lattice point would silently merge, changing
  // the pattern rather than cleaning it.
  const distinct = new Set(snapped.map(([x, y]) => `${x.toFixed(9)},${y.toFixed(9)}`));
  if (distinct.size !== vertices.length) {
    return {
      fold: null,
      report: { skipped: 'would merge vertices', merged: vertices.length - distinct.size, kind },
    };
  }

  // An edge collapsing to nothing, or turning, means the fit is wrong.
  let worstTurn = 0;
  for (const [a, b] of edges) {
    const before = [vertices[b][0] - vertices[a][0], vertices[b][1] - vertices[a][1]];
    const after = [snapped[b][0] - snapped[a][0], snapped[b][1] - snapped[a][1]];
    if (Math.hypot(after[0], after[1]) < 1e-9) {
      return { fold: null, report: { skipped: 'would collapse an edge', kind } };
    }
    const turn = Math.abs(
      ((Math.atan2(after[1], after[0]) - Math.atan2(before[1], before[0])) * 180) / Math.PI
    );
    worstTurn = Math.max(worstTurn, Math.min(turn, 360 - turn));
  }
  if (worstTurn > DIRECTION_TOLERANCE) {
    return { fold: null, report: { skipped: 'would turn an edge', worstTurn, kind } };
  }

  return {
    fold: { ...fold, vertices_coords: snapped },
    report: {
      kind,
      pitch: fit.pitch,
      worst: fit.worst,
      fraction: fit.worst / fit.pitch,
      worstTurn,
      vertices: vertices.length,
      edges: edges.length,
    },
  };
}

function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outDir = outIndex >= 0 ? args[outIndex + 1] : null;
  const inPlace = args.includes('--in-place');
  const inputs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
  if (inputs.length === 0 || (!outDir && !inPlace)) {
    console.error('usage: node scripts/snap-to-lattice.mjs <dir|file...> --out DIR | --in-place');
    process.exit(1);
  }
  if (outDir) mkdirSync(outDir, { recursive: true });

  const files = inputs.flatMap((input) =>
    statSync(input).isDirectory()
      ? readdirSync(input)
          .filter((f) => extname(f).toLowerCase() === '.fold')
          .sort()
          .map((f) => join(input, f))
      : [input]
  );

  let snapped = 0;
  for (const file of files) {
    const name = basename(file, extname(file));
    const original = JSON.parse(readFileSync(file, 'utf8'));
    const { fold, report } = snapToLattice(original);
    if (!fold) {
      console.log(`  ${name.padEnd(34)} left alone — ${report.skipped}`);
      continue;
    }
    snapped += 1;
    writeFileSync(outDir ? join(outDir, `${name}.fold`) : file, `${JSON.stringify(fold)}\n`);
    console.log(
      `  ${name.padEnd(34)} ${report.kind.padEnd(10)} pitch ${report.pitch.toFixed(4)}  ` +
        `worst ${report.worst.toExponential(1)} (${(report.fraction * 100).toFixed(3)}% of pitch)`
    );
  }
  console.log(`\n${snapped} of ${files.length} snapped; the rest were left untouched.`);
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) main();
