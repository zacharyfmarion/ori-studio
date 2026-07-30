#!/usr/bin/env node
/**
 * Snap a crease pattern's edge *directions* onto the angle system it was drawn
 * on — 22.5 degrees and its subdivisions.
 *
 * ## Why this is not the lattice pass
 *
 * `snap-to-lattice.mjs` moves each vertex to the nearest point of a regular
 * grid, independently. That works because a 45- or 30-degree design *has* a
 * point lattice. A 22.5-degree design does not: tan(22.5 deg) is sqrt(2) - 1, so
 * the vertices land at irrational offsets with no common pitch, and there is
 * nothing to round to.
 *
 * What is exact in such a design is the **directions**. And directions are all
 * the checks look at — a sector angle is the difference of two edge directions,
 * Kawasaki is an alternating sum of sector angles, and the closure condition
 * takes the sector angles plus the fold angles. Where the vertices sit does not
 * enter into any of it.
 *
 * So this constrains directions instead of positions, and that makes it a
 * fundamentally harder operation than the lattice pass: the constraints are
 * **coupled**. Two edges sharing a vertex cannot have their angles fixed
 * independently, because moving that vertex changes both. It is a solve, not a
 * rounding.
 *
 * ## The solve
 *
 * Let `x` be the displacement of every vertex. Asking edge `(a, b)` to lie along
 * a unit direction `d` is asking it to have no component along the normal `n`:
 *
 *     (p_b + x_b - p_a - x_a) . n = 0
 *
 * which is *linear* in `x`. Over all constrained edges that is `A x = r`, and
 * the pattern we want is the one that moves least, so:
 *
 *     minimise |x|^2  subject to  A x = r
 *
 * whose solution is `x = A^T λ` with `A A^T λ = r`. That is solved by conjugate
 * gradient without ever forming `A A^T` — each iteration is two sparse passes
 * over the edges. Vertices with no constrained edge get `x = 0` and do not move
 * at all, which is the behaviour we want for the free parts of a design.
 *
 * ## Refusing
 *
 * Consistency is not guaranteed. If the design is not really on the system, the
 * constraints contradict each other, and a solver handed a contradiction returns
 * a compromise — a pattern that is neither the original nor exact. That is the
 * failure mode worth fearing, and it is caught by checking the *result* rather
 * than trusting the solve: every constrained edge must come out exact, or the
 * file is left alone.
 *
 * Usage:
 *   node scripts/snap-to-angles.mjs <dir|file...> [--out DIR] [--in-place] [--report]
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

/**
 * Angle systems to try, coarsest first.
 *
 * Coarsest first is the safety ordering, not a preference: every multiple of
 * 22.5 is also a multiple of 3.75, so a finer base accepts strictly more and
 * a random direction is six times likelier to land near one of its bins by
 * chance. Taking the coarsest base that fits is taking the strongest claim the
 * evidence supports.
 */
const BASES = [22.5, 11.25, 7.5, 3.75];

/**
 * Worst deviation still called rounding, and the smallest called design, in
 * degrees.
 *
 * Measured rather than picked. Across the corpus the deviations separate into
 * three groups: exact (below 1e-9, the axis-aligned edges, which survive
 * coordinate rounding intact), rounding (up to ~0.06), and design (0.7 and up).
 * `flat_crane` jumps 6.2e-2 -> 1.2 and `opacityExamples` 6.0e-3 -> 7.0e-1, two
 * unrelated files agreeing on the same empty band.
 *
 * An edge landing *inside* the band is the case this cannot call, so a file with
 * one is refused rather than guessed at.
 */
const ROUNDING_MAX_DEGREES = 0.1;
const DESIGN_MIN_DEGREES = 0.5;

/** Fraction of edges that must be on-system for the base to be believed. */
const MIN_ON_SYSTEM = 0.9;

/** A constrained edge must end up this close to exact, in degrees. */
const EXACT_BAR_DEGREES = 1e-9;

/** A free edge may not turn more than this, in degrees. */
const FREE_TURN_MAX_DEGREES = 0.5;

/** Worst vertex movement allowed, as a fraction of the pattern's span. */
const MAX_DISPLACEMENT_FRACTION = 0.002;

/**
 * Shortest edge, as a fraction of span, whose direction is worth believing.
 *
 * The SVG coordinates are quantised at about 1e-3 units, so an edge shorter than
 * that has a direction made entirely of rounding — `reschTriTessellation` has one
 * of length 5e-4 in a pattern spanning 824. Constraining it is worse than
 * useless: the row is noise, and because each row is divided by its edge length
 * it is *loud* noise, dominating the solve over the real geometry.
 *
 * These are slivers left by splitting two creases that nearly-but-not-quite
 * meet — the same defect the dangling-endpoint snap in `svg-to-fold.mjs`
 * handles, in the cases that fall under its radius. The proper fix is to weld
 * them there; excluding them here keeps this pass from being poisoned by them
 * meanwhile.
 *
 * 1e-4 sits in the gap the corpus shows: in `huffmanExtrudedBoxes` the slivers
 * are at 1.3e-6 and everything real is at 3.8e-2, four orders of magnitude
 * clear on either side.
 */
const MIN_CONSTRAINABLE_FRACTION = 1e-4;

const DEG = Math.PI / 180;

function direction(vertices, a, b) {
  const angle = (Math.atan2(vertices[b][1] - vertices[a][1], vertices[b][0] - vertices[a][0]) * 180) / Math.PI;
  return ((angle % 180) + 180) % 180;
}

function deviation(degrees, base) {
  const m = ((degrees % base) + base) % base;
  return Math.min(m, base - m);
}

/** Span of the pattern, used for every relative threshold here. */
function spanOf(vertices) {
  const xs = vertices.map(([x]) => x);
  const ys = vertices.map(([, y]) => y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
}

/** Indices of edges too short for their direction to mean anything. */
function sliverSet(vertices, edges) {
  const floor = spanOf(vertices) * MIN_CONSTRAINABLE_FRACTION;
  const slivers = new Set();
  edges.forEach(([a, b], index) => {
    if (Math.hypot(vertices[b][0] - vertices[a][0], vertices[b][1] - vertices[a][1]) < floor) {
      slivers.add(index);
    }
  });
  return slivers;
}

/**
 * The coarsest base that explains the pattern, or a reason it cannot.
 *
 * Slivers are excluded from the vote as well as from the constraints. Leaving
 * them in would let a file be refused for having 1,500 edges whose direction is
 * rounding noise, which says nothing about whether the design is on a system.
 */
export function classify(vertices, edges, slivers = sliverSet(vertices, edges)) {
  const directions = edges
    .filter((_, index) => !slivers.has(index))
    .map(([a, b]) => direction(vertices, a, b));
  if (directions.length === 0) return { skipped: 'every edge is a sliver' };
  let best = null;
  for (const base of BASES) {
    const deviations = directions.map((d) => deviation(d, base));
    const on = deviations.filter((d) => d <= ROUNDING_MAX_DEGREES).length;
    const ambiguous = deviations.filter(
      (d) => d > ROUNDING_MAX_DEGREES && d < DESIGN_MIN_DEGREES
    ).length;
    const fraction = on / deviations.length;
    if (!best || fraction > best.fraction) best = { base, on, ambiguous, fraction };
    if (fraction >= MIN_ON_SYSTEM && ambiguous === 0) {
      return { base, on, total: deviations.length, ambiguous: 0 };
    }
  }
  return {
    skipped:
      best.ambiguous > 0
        ? `${best.ambiguous} edges between rounding and design`
        : `only ${(best.fraction * 100).toFixed(0)}% on any angle system`,
  };
}

/**
 * Minimum-norm displacement satisfying every constraint, by conjugate gradient
 * on `A A^T λ = r`.
 *
 * `A A^T` is singular whenever the constraints are redundant, which they always
 * are here. That is fine: started from zero, CG stays in the range of `A` and
 * converges to the minimum-norm solution rather than diverging.
 *
 * Each row is divided by its edge length. That leaves the constraint *set*
 * untouched — both sides are scaled — so the minimum-norm answer is identical,
 * but it makes every residual an angle in radians rather than a distance. Two
 * things follow, and the first is not cosmetic: a pattern whose longest edge is
 * 1400 units and shortest is 0.5 otherwise hands CG a system conditioned on that
 * ratio, and the stopping test can be stated in the units the caller actually
 * cares about instead of an abstract norm.
 */
function solve(vertices, constraints, iterations = 20000) {
  const rows = constraints.length;
  const residual = constraints.map(({ a, b, normal, scale }) => {
    const dx = vertices[b][0] - vertices[a][0];
    const dy = vertices[b][1] - vertices[a][1];
    return -(dx * normal[0] + dy * normal[1]) * scale;
  });

  // x = A^T lambda
  const applyTranspose = (lambda) => {
    const x = vertices.map(() => [0, 0]);
    for (let e = 0; e < rows; e += 1) {
      const { a, b, normal, scale } = constraints[e];
      const w = lambda[e] * scale;
      x[a][0] -= w * normal[0];
      x[a][1] -= w * normal[1];
      x[b][0] += w * normal[0];
      x[b][1] += w * normal[1];
    }
    return x;
  };
  // y = A x
  const apply = (x) =>
    constraints.map(
      ({ a, b, normal, scale }) =>
        ((x[b][0] - x[a][0]) * normal[0] + (x[b][1] - x[a][1]) * normal[1]) * scale
    );

  const dot = (u, v) => u.reduce((sum, value, i) => sum + value * v[i], 0);
  const worst = (u) => u.reduce((m, value) => Math.max(m, Math.abs(value)), 0);

  // Stop on the quantity the gate below measures, with an order of magnitude in
  // hand. Iterating past this is not free -- it is where a residual already at
  // the floor gets divided by an underflowed `pAp` and the answer explodes.
  const tolerance = (EXACT_BAR_DEGREES * DEG) / 10;

  const lambda = new Array(rows).fill(0);
  const r = [...residual];
  let p = [...r];
  let rr = dot(r, r);
  for (let step = 0; step < iterations && worst(r) > tolerance; step += 1) {
    const ap = apply(applyTranspose(p));
    const pap = dot(p, ap);
    // `A A^T` is positive *semi*-definite, so a non-positive `pAp` means `p` has
    // reached its null space and there is no further progress to make.
    if (!Number.isFinite(pap) || pap <= 0) break;
    const alpha = rr / pap;
    for (let e = 0; e < rows; e += 1) {
      lambda[e] += alpha * p[e];
      r[e] -= alpha * ap[e];
    }
    const rrNext = dot(r, r);
    if (!Number.isFinite(rrNext)) break;
    const beta = rr === 0 ? 0 : rrNext / rr;
    for (let e = 0; e < rows; e += 1) p[e] = r[e] + beta * p[e];
    rr = rrNext;
  }
  return applyTranspose(lambda);
}

/**
 * Snap, or explain why not.
 *
 * Returns `{ fold, report }`. `fold` is null whenever anything was refused, and
 * the caller must then leave the original file untouched.
 */
export function snapToAngles(fold) {
  const vertices = fold.vertices_coords ?? [];
  const edges = fold.edges_vertices ?? [];
  if (vertices.length === 0 || edges.length === 0) {
    return { fold: null, report: { skipped: 'empty' } };
  }

  const span = spanOf(vertices);
  const slivers = sliverSet(vertices, edges);
  // Refused outright, not merely excluded from the constraints.
  //
  // A sliver has no direction worth constraining, but the checks read it anyway
  // -- each of its endpoints is a vertex whose fan it belongs to. Left free, the
  // solve swung slivers by up to 90 degrees and invented Kawasaki violations in
  // `huffmanExtrudedBoxes` (flat 73 -> 76) and `huffmanStarsTriangles`
  // (45 -> 48, closure 722 -> 729). Pinning them to their current direction
  // instead over-constrains the system: their endpoints would have to move in
  // lockstep while each is tied to a different real edge, and the solve then
  // satisfies nothing.
  //
  // Neither branch is salvageable from here, because the defect is upstream:
  // these are two vertices a fraction of the coordinate quantum apart that
  // `svg-to-fold.mjs` should have welded into one. Until it does, a file with
  // one is not a file this pass can reason about.
  if (slivers.size > 0) {
    return {
      fold: null,
      report: {
        skipped: `${slivers.size} edge${slivers.size === 1 ? '' : 's'} below the coordinate quantum`,
      },
    };
  }

  const classification = classify(vertices, edges, slivers);
  if (classification.skipped) return { fold: null, report: classification };
  const { base } = classification;

  const constraints = [];
  const free = [];
  edges.forEach(([a, b], index) => {
    const current = direction(vertices, a, b);
    if (deviation(current, base) > ROUNDING_MAX_DEGREES) {
      free.push(index);
      return;
    }
    const target = Math.round(current / base) * base * DEG;
    const length = Math.hypot(vertices[b][0] - vertices[a][0], vertices[b][1] - vertices[a][1]);
    // Normal to the target direction: the constraint is that the edge has no
    // component along it, which is exactly "parallel to the target".
    constraints.push({ a, b, normal: [-Math.sin(target), Math.cos(target)], scale: 1 / length });
  });

  const displacement = solve(vertices, constraints);
  const snapped = vertices.map(([x, y], i) => [x + displacement[i][0], y + displacement[i][1]]);

  // --- Gates. Any failure leaves the file alone. ---------------------------

  // The one that catches an inconsistent system. A solver handed contradictory
  // constraints returns a compromise rather than an error, so the only reliable
  // signal is whether the answer is actually exact.
  let worstConstrained = 0;
  for (const { a, b, normal } of constraints) {
    const dx = snapped[b][0] - snapped[a][0];
    const dy = snapped[b][1] - snapped[a][1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) {
      return { fold: null, report: { skipped: 'would collapse an edge', base } };
    }
    const off = Math.abs(Math.asin(Math.min(1, Math.abs((dx * normal[0] + dy * normal[1]) / length)))) / DEG;
    worstConstrained = Math.max(worstConstrained, off);
  }
  if (worstConstrained > EXACT_BAR_DEGREES) {
    return {
      fold: null,
      report: { skipped: 'constraints are inconsistent', worstConstrained, base },
    };
  }

  // A free edge has no constraint, so nothing stops the solve from swinging it.
  let worstFreeTurn = 0;
  for (const index of free) {
    const [a, b] = edges[index];
    const length = Math.hypot(snapped[b][0] - snapped[a][0], snapped[b][1] - snapped[a][1]);
    if (length < 1e-9) {
      return { fold: null, report: { skipped: 'would collapse a free edge', base } };
    }
    const turn = Math.abs(direction(snapped, a, b) - direction(vertices, a, b));
    worstFreeTurn = Math.max(worstFreeTurn, Math.min(turn, 180 - turn));
  }
  if (worstFreeTurn > FREE_TURN_MAX_DEGREES) {
    return { fold: null, report: { skipped: 'would turn a free edge', worstFreeTurn, base } };
  }

  // Two vertices landing on one point would silently merge, changing the
  // pattern rather than cleaning it.
  const distinct = new Set(snapped.map(([x, y]) => `${x.toFixed(9)},${y.toFixed(9)}`));
  if (distinct.size !== vertices.length) {
    return {
      fold: null,
      report: { skipped: 'would merge vertices', merged: vertices.length - distinct.size, base },
    };
  }

  const worstMove = Math.max(...displacement.map(([dx, dy]) => Math.hypot(dx, dy)));
  if (worstMove > span * MAX_DISPLACEMENT_FRACTION) {
    return {
      fold: null,
      report: { skipped: 'moves vertices too far', fraction: worstMove / span, base },
    };
  }

  return {
    fold: { ...fold, vertices_coords: snapped },
    report: {
      base,
      constrained: constraints.length,
      free: free.length,
      worstMove,
      fraction: worstMove / span,
      worstFreeTurn,
      vertices: vertices.length,
    },
  };
}

function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outDir = outIndex >= 0 ? args[outIndex + 1] : null;
  const inPlace = args.includes('--in-place');
  const report = args.includes('--report');
  const inputs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
  if (inputs.length === 0 || (!outDir && !inPlace && !report)) {
    console.error(
      'usage: node scripts/snap-to-angles.mjs <dir|file...> --out DIR | --in-place | --report'
    );
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
    const result = snapToAngles(original);
    if (!result.fold) {
      console.log(`  ${name.padEnd(30)} left alone — ${result.report.skipped}`);
      continue;
    }
    snapped += 1;
    const { base, constrained, free, worstMove, fraction } = result.report;
    console.log(
      `  ${name.padEnd(30)} ${String(base).padStart(5)}°  ` +
        `${constrained} constrained, ${free} free  moved <= ${worstMove.toExponential(1)} ` +
        `(${(fraction * 100).toFixed(4)}% of span)`
    );
    if (!report) {
      writeFileSync(outDir ? join(outDir, `${name}.fold`) : file, `${JSON.stringify(result.fold)}\n`);
    }
  }
  console.log(
    `\n${snapped} of ${files.length} ${report ? 'would snap' : 'snapped'}; the rest were left untouched.`
  );
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) main();
