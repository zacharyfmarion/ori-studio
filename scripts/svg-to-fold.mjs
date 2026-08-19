#!/usr/bin/env node
/**
 * Convert an Origami Simulator SVG crease pattern to FOLD.
 *
 * Ori Studio needs non-flat test material and there is almost none in the wild:
 * every `.fold` file in the largest public collection carries only ±180 and 0,
 * because the simulator computes a 3D form from a *flat-foldable* pattern. The
 * partial fold angles live in Ghassaei's SVGs instead, encoded as **stroke
 * opacity** — which is what this reads.
 *
 * ## The encoding (origamisimulator.org)
 *
 * | stroke    | meaning              | FOLD |
 * | --------- | -------------------- | ---- |
 * | `#ff0000` | mountain             | `M`  |
 * | `#0000ff` | valley               | `V`  |
 * | `#000000` | boundary             | `B`  |
 * | `#00ff00` | cut                  | `B`  |
 * | `#ff00ff` | undriven crease      | `U`  |
 * | `#ffff00` | facet (triangulation)| `F`  |
 *
 * > "The final fold angle of a mountain or valley fold is set by its opacity.
 * > 1.0 = 180°, 0.5 = 90°, 0 = 0°."
 *
 * So `edges_foldAngle = opacity × 180`, negated for mountains to match FOLD's
 * sign convention (negative mountain, positive valley).
 *
 * ## What these files are, and are not
 *
 * They are **known-good designs**. They are *not* solved rigid-folded states:
 * the opacity is a target the simulator relaxes toward, so a vertex's angles
 * need not satisfy the closure condition exactly. Expect closure diagnostics,
 * and read them as a fact about the input rather than a bug in the checker.
 *
 * ## Scope
 *
 * `line`, `rect`, `polygon`, `polyline`, and `path` restricted to the straight
 * commands (`M L H V` and their relative forms) — which is everything these
 * files use. A curve command is skipped and counted, never silently flattened.
 *
 * Usage:
 *   node scripts/svg-to-fold.mjs <in.svg|dir> [--out DIR] [--flip-y] [--quiet]
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const STROKE_TO_ASSIGNMENT = new Map([
  ['#ff0000', 'M'],
  ['#0000ff', 'V'],
  ['#000000', 'B'],
  ['#00ff00', 'B'], // a cut becomes a boundary once the sheet is separated
  ['#ff00ff', 'U'],
  ['#ffff00', 'F'],
]);

/**
 * Geometric tolerance, as a fraction of the drawing's longer side.
 *
 * Relative rather than absolute because these files span anything from 10 units
 * to 3456, and Illustrator rounds coordinates -- a crease meant to land on a
 * boundary can miss it by a thousandth. An absolute epsilon either misses those
 * on a large drawing or welds distinct creases on a small one.
 */
const TOLERANCE_FRACTION = 1e-6;

/**
 * Declarations from `<style>` blocks, keyed by class name.
 *
 * Illustrator emits either inline attributes or a stylesheet with `class="st0"`,
 * and which one you get is a per-export accident. Reading only the inline form
 * silently dropped an entire file — the one with the widest range of angles.
 */
function stylesheetClasses(svg) {
  const classes = new Map();
  for (const [, css] of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const [, names, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = new Map();
      for (const part of body.split(';')) {
        const [property, value] = part.split(':');
        if (property && value) declarations.set(property.trim().toLowerCase(), value.trim());
      }
      for (const name of names.split(',')) {
        const match = name.trim().match(/^\.([\w-]+)$/);
        if (match) classes.set(match[1], declarations);
      }
    }
  }
  return classes;
}

/** Inline attribute, then inline `style`, then any class the element carries. */
function attr(tag, name, classes) {
  const direct = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  if (direct) return direct[1];
  const style = tag.match(/\bstyle\s*=\s*"([^"]*)"/i);
  if (style) {
    const inStyle = style[1].match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]*)`, 'i'));
    if (inStyle) return inStyle[1].trim();
  }
  if (!classes) return null;
  const classAttr = tag.match(/\bclass\s*=\s*"([^"]*)"/i);
  if (!classAttr) return null;
  for (const token of classAttr[1].split(/\s+/)) {
    const value = classes.get(token)?.get(name.toLowerCase());
    if (value != null) return value;
  }
  return null;
}

function strokeOf(tag, classes) {
  const raw = (attr(tag, 'stroke', classes) ?? '').trim().toLowerCase();
  if (!raw) return null;
  const named = { red: '#ff0000', blue: '#0000ff', black: '#000000', lime: '#00ff00' };
  if (named[raw]) return named[raw];
  // #RGB shorthand
  const short = raw.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return raw;
}

/**
 * Fold-angle fraction: `opacity`, else `stroke-opacity`, else fully folded.
 *
 * `parseFloat` is what makes the scientific notation Illustrator emits work —
 * `5.5645e-02` is 0.056, roughly a 10 degree fold, not 5.56.
 */
function opacityOf(tag, classes) {
  for (const name of ['opacity', 'stroke-opacity']) {
    const raw = attr(tag, name, classes);
    if (raw == null) continue;
    const value = Number.parseFloat(raw);
    if (Number.isFinite(value)) return Math.min(1, Math.max(0, value));
  }
  return 1;
}

const numbers = (text) =>
  (text.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number).filter(Number.isFinite);

/** Straight-line path data to a list of subpaths. Returns null on a curve. */
function pathToPolylines(d) {
  const tokens = d.match(/[MmLlHhVvZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  if (/[CcSsQqTtAa]/.test(d)) return null;
  const subpaths = [];
  let current = null;
  let start = null;
  let cursor = [0, 0];
  let command = null;
  let index = 0;
  const next = () => Number(tokens[index++]);
  while (index < tokens.length) {
    const token = tokens[index];
    if (/^[MmLlHhVvZz]$/.test(token)) {
      command = token;
      index += 1;
      if (/[Zz]/.test(command)) {
        if (current && start) current.push([...start]);
        continue;
      }
      if (/[Mm]/.test(command)) {
        const x = next();
        const y = next();
        cursor = command === 'M' ? [x, y] : [cursor[0] + x, cursor[1] + y];
        start = [...cursor];
        current = [[...cursor]];
        subpaths.push(current);
        // Implicit L for further coordinate pairs after an M.
        command = command === 'M' ? 'L' : 'l';
      }
      continue;
    }
    if (!current) return null;
    switch (command) {
      case 'L':
        cursor = [next(), next()];
        break;
      case 'l':
        cursor = [cursor[0] + next(), cursor[1] + next()];
        break;
      case 'H':
        cursor = [next(), cursor[1]];
        break;
      case 'h':
        cursor = [cursor[0] + next(), cursor[1]];
        break;
      case 'V':
        cursor = [cursor[0], next()];
        break;
      case 'v':
        cursor = [cursor[0], cursor[1] + next()];
        break;
      default:
        return null;
    }
    current.push([...cursor]);
  }
  return subpaths;
}

/** Every straight segment in the file, with its assignment and fold angle. */
function extractSegments(svg) {
  const classes = stylesheetClasses(svg);
  const segments = [];
  let skippedCurves = 0;
  let skippedStroke = 0;

  for (const [tag] of svg.matchAll(/<(?:line|rect|polygon|polyline|path)\b[^>]*>/gi)) {
    const stroke = strokeOf(tag, classes);
    const assignment = stroke ? STROKE_TO_ASSIGNMENT.get(stroke) : undefined;
    if (!assignment) {
      if (stroke && stroke !== 'none') skippedStroke += 1;
      continue;
    }
    const fraction = opacityOf(tag, classes);
    const push = (a, b) => {
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0) {
        segments.push({ a, b, assignment, fraction });
      }
    };

    if (/^<line\b/i.test(tag)) {
      const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((n) =>
        Number.parseFloat(attr(tag, n, classes) ?? '0'),
      );
      push([x1, y1], [x2, y2]);
    } else if (/^<rect\b/i.test(tag)) {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((n) =>
        Number.parseFloat(attr(tag, n, classes) ?? '0'),
      );
      const corners = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ];
      for (let i = 0; i < 4; i += 1) push(corners[i], corners[(i + 1) % 4]);
    } else if (/^<(polygon|polyline)\b/i.test(tag)) {
      const values = numbers(attr(tag, 'points', classes) ?? '');
      const points = [];
      for (let i = 0; i + 1 < values.length; i += 2) points.push([values[i], values[i + 1]]);
      const closed = /^<polygon\b/i.test(tag);
      for (let i = 0; i + 1 < points.length; i += 1) push(points[i], points[i + 1]);
      if (closed && points.length > 2) push(points[points.length - 1], points[0]);
    } else {
      const polylines = pathToPolylines(attr(tag, 'd', classes) ?? '');
      if (!polylines) {
        skippedCurves += 1;
        continue;
      }
      for (const points of polylines) {
        for (let i = 0; i + 1 < points.length; i += 1) push(points[i], points[i + 1]);
      }
    }
  }
  return { segments, skippedCurves, skippedStroke };
}

/**
 * Radius for pulling a dangling endpoint onto the line it was drawn to meet, as
 * a fraction of the drawing's longer side.
 *
 * **A dangling endpoint is meaningless in a crease pattern.** Every crease has to
 * terminate on another crease or on the paper edge, so a degree-one vertex is
 * always a drawing error rather than a design feature — which is what makes it
 * safe to move, and why this is aimed only at those.
 *
 * The number comes from the data. Endpoint-to-segment distances across the whole
 * corpus form a smooth continuum with no natural threshold, so no global snapping
 * tolerance is defensible. Restricted to *dangling* endpoints the picture is
 * different and bimodal: 1,114 of them sit within 1e-3 of a segment and 141 sit
 * beyond 1e-2, with **nothing in between**. This is the middle of that gap.
 */
const SNAP_FRACTION = 3e-3;

/**
 * Pull dangling endpoints onto the segment they were drawn to meet.
 *
 * Illustrator output routinely stops a crease a fraction short of the paper edge
 * or overshoots it. Left alone, splitting cannot help: there is no intersection
 * to split at, and the vertex stays a degree-one interior vertex that the flat
 * checker correctly reports as an odd fold count.
 */
function snapDanglingEndpoints(segments, radius) {
  const key = ([x, y]) => `${Math.round(x / radius)},${Math.round(y / radius)}`;
  const degree = new Map();
  for (const { a, b } of segments) {
    for (const point of [a, b]) degree.set(key(point), (degree.get(key(point)) ?? 0) + 1);
  }

  let moved = 0;
  const nearest = (point, own) => {
    let best = null;
    let bestDistance = radius;
    segments.forEach((segment, index) => {
      if (index === own) return;
      const [dx, dy] = [segment.b[0] - segment.a[0], segment.b[1] - segment.a[1]];
      const length = Math.hypot(dx, dy);
      if (length < 1e-12) return;
      let t = ((point[0] - segment.a[0]) * dx + (point[1] - segment.a[1]) * dy) / (length * length);
      t = Math.max(0, Math.min(1, t));
      const candidate = [segment.a[0] + t * dx, segment.a[1] + t * dy];
      const distance = Math.hypot(point[0] - candidate[0], point[1] - candidate[1]);
      if (distance > 0 && distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    });
    return best;
  };

  const snapped = segments.map((segment, index) => {
    const next = { ...segment };
    for (const end of ['a', 'b']) {
      if ((degree.get(key(segment[end])) ?? 0) !== 1) continue;
      const target = nearest(segment[end], index);
      if (target) {
        next[end] = target;
        moved += 1;
      }
    }
    return next;
  });
  return { segments: snapped, moved };
}

/**
 * Split every segment where another one meets it, so the result is a planar
 * graph rather than a drawing.
 *
 * **This is the difference between an SVG and a crease pattern.** An SVG is a
 * picture: two lines that cross, or a crease that stops part-way along the paper
 * edge, merely *look* connected. A crease pattern is a graph, where meeting
 * means sharing a vertex.
 *
 * Converting verbatim produced files where a crease ended in the middle of an
 * unsplit boundary edge. The checker then saw a vertex with one crease and no
 * border -- an interior vertex of degree one -- and correctly reported an odd
 * fold count, on what is visibly the edge of the paper. Oriedita does the same
 * with the same input; the input was the problem.
 *
 * Two things to split at, and both matter:
 *
 * - **crossings**, where two segments pass through each other;
 * - **touches**, where one segment's endpoint lies inside another. That is the
 *   case that produced the boundary reports, and the one a crossing test alone
 *   would miss.
 *
 * Each piece inherits its parent's assignment and fold angle, which is what
 * keeps the conversion faithful.
 */
function splitAtIntersections(segments, tolerance) {
  // Bucket by bounding box so this does not compare every pair: the corpus has
  // files with 5,000 segments, and 12 million pair tests in JS is not free.
  const cell = Math.max(tolerance, spanOf(segments) / 64);
  const buckets = new Map();
  const keysFor = (segment) => {
    const keys = [];
    const [minX, maxX] = [
      Math.min(segment.a[0], segment.b[0]),
      Math.max(segment.a[0], segment.b[0]),
    ];
    const [minY, maxY] = [
      Math.min(segment.a[1], segment.b[1]),
      Math.max(segment.a[1], segment.b[1]),
    ];
    for (let x = Math.floor(minX / cell); x <= Math.floor(maxX / cell); x += 1) {
      for (let y = Math.floor(minY / cell); y <= Math.floor(maxY / cell); y += 1) {
        keys.push(`${x},${y}`);
      }
    }
    return keys;
  };
  segments.forEach((segment, index) => {
    for (const key of keysFor(segment)) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(index);
    }
  });

  const cuts = segments.map(() => new Set());
  const addCut = (index, t) => {
    if (t > 1e-12 && t < 1 - 1e-12) cuts[index].add(t);
  };

  const considered = new Set();
  segments.forEach((first, i) => {
    const neighbours = new Set();
    for (const key of keysFor(first)) for (const j of buckets.get(key) ?? []) neighbours.add(j);
    for (const j of neighbours) {
      if (j <= i) continue;
      const pair = i * segments.length + j;
      if (considered.has(pair)) continue;
      considered.add(pair);
      const second = segments[j];

      const r = [first.b[0] - first.a[0], first.b[1] - first.a[1]];
      const sVec = [second.b[0] - second.a[0], second.b[1] - second.a[1]];
      const denominator = r[0] * sVec[1] - r[1] * sVec[0];
      const delta = [second.a[0] - first.a[0], second.a[1] - first.a[1]];

      if (Math.abs(denominator) > 1e-12) {
        const t = (delta[0] * sVec[1] - delta[1] * sVec[0]) / denominator;
        const u = (delta[0] * r[1] - delta[1] * r[0]) / denominator;
        if (t > 0 && t < 1 && u > 0 && u < 1) {
          addCut(i, t);
          addCut(j, u);
          continue;
        }
      }
      // Parallel, or meeting outside the spans. Either way an endpoint of one
      // may still lie on the other -- the touch case.
      addCut(i, parameterOnSegment(second.a, first, tolerance));
      addCut(i, parameterOnSegment(second.b, first, tolerance));
      addCut(j, parameterOnSegment(first.a, second, tolerance));
      addCut(j, parameterOnSegment(first.b, second, tolerance));
    }
  });

  const out = [];
  segments.forEach((segment, index) => {
    const ts = [...cuts[index]].sort((a, b) => a - b);
    let previous = segment.a;
    for (const t of [...ts, 1]) {
      const point =
        t === 1
          ? segment.b
          : [
              segment.a[0] + t * (segment.b[0] - segment.a[0]),
              segment.a[1] + t * (segment.b[1] - segment.a[1]),
            ];
      if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) > tolerance) {
        out.push({ ...segment, a: previous, b: point });
      }
      previous = point;
    }
  });
  return out;
}

/** Parameter of `point` along `segment`, or NaN when it is not on it. */
function parameterOnSegment(point, segment, tolerance) {
  const [dx, dy] = [segment.b[0] - segment.a[0], segment.b[1] - segment.a[1]];
  const length = Math.hypot(dx, dy);
  if (length < tolerance) return Number.NaN;
  const t = ((point[0] - segment.a[0]) * dx + (point[1] - segment.a[1]) * dy) / (length * length);
  if (!(t > 0 && t < 1)) return Number.NaN;
  const perpendicular =
    Math.abs((point[0] - segment.a[0]) * dy - (point[1] - segment.a[1]) * dx) / length;
  return perpendicular <= tolerance ? t : Number.NaN;
}

function spanOf(segments) {
  let min = Infinity;
  let max = -Infinity;
  for (const { a, b } of segments) {
    for (const [x, y] of [a, b]) {
      min = Math.min(min, x, y);
      max = Math.max(max, x, y);
    }
  }
  const span = max - min;
  return Number.isFinite(span) && span > 0 ? span : 1;
}

export function svgToFold(svg, { title = 'Converted', flipY = false, planar = true } = {}) {
  const { segments: raw, skippedCurves, skippedStroke } = extractSegments(svg);
  if (raw.length === 0) throw new Error('no recognised creases');
  const span = spanOf(raw);
  const tolerance = span * TOLERANCE_FRACTION;
  // Snap first: a crease drawn a hair short of the paper edge has no
  // intersection to split at until its endpoint is actually on the edge.
  const { segments: joined, moved } = planar
    ? snapDanglingEndpoints(raw, span * SNAP_FRACTION)
    : { segments: raw, moved: 0 };
  const segments = planar ? splitAtIntersections(joined, tolerance) : joined;

  let maxY = -Infinity;
  for (const { a, b } of segments) maxY = Math.max(maxY, a[1], b[1]);
  const place = ([x, y]) => [x, flipY ? maxY - y : y];

  // Welding endpoints into shared vertices.
  //
  // The obvious implementation -- quantise to a grid of side `tolerance` and
  // treat a shared cell as a match -- is wrong in a way that is easy to miss,
  // because it mostly works. Two points either side of a cell boundary never
  // match however close they are, so whether a pair welds depends on where the
  // grid happens to fall rather than on how far apart they are. `frogBase` came
  // out with eleven duplicate vertex pairs 3.5e-7 to 2.8e-6 of its span apart,
  // and seven creases dead-ending in mid-paper at degree one, which the checker
  // then correctly reported as an odd fold count.
  //
  // So the cell is a lookup structure, not the test. Any point within
  // `tolerance` of another is in that point's cell or one of the eight around
  // it, so searching the 3x3 neighbourhood and comparing real distances finds
  // every match. Nearest wins, so a cluster collapses to one vertex rather than
  // chaining outward.
  const buckets = new Map();
  const vertices = [];
  const vertexIndex = (point) => {
    const placed = place(point);
    const bx = Math.floor(placed[0] / tolerance);
    const by = Math.floor(placed[1] / tolerance);
    let best = -1;
    let bestDistance = Infinity;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const i of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
          const d = Math.hypot(vertices[i][0] - placed[0], vertices[i][1] - placed[1]);
          if (d <= tolerance && d < bestDistance) {
            bestDistance = d;
            best = i;
          }
        }
      }
    }
    if (best >= 0) return best;
    const index = vertices.length;
    vertices.push(placed);
    const k = `${bx},${by}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(index);
    return index;
  };

  const edges = [];
  const assignments = [];
  const foldAngles = [];
  const seen = new Set();
  let duplicates = 0;
  for (const { a, b, assignment, fraction } of segments) {
    const [ia, ib] = [vertexIndex(a), vertexIndex(b)];
    if (ia === ib) continue;
    const edgeKey = ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`;
    if (seen.has(edgeKey)) {
      duplicates += 1;
      continue;
    }
    seen.add(edgeKey);
    edges.push([ia, ib]);
    assignments.push(assignment);
    // Sign per the FOLD spec: negative mountain, positive valley. Anything that
    // is not a driven crease is flat by definition.
    const magnitude = fraction * 180;
    foldAngles.push(assignment === 'M' ? -magnitude : assignment === 'V' ? magnitude : 0);
  }

  return {
    fold: {
      file_spec: 1.1,
      file_creator: 'Ori Studio svg-to-fold',
      file_title: title,
      file_description:
        'Converted from an Origami Simulator SVG; fold angles come from stroke opacity ' +
        '(1.0 = 180 degrees). Target angles, not a solved rigid-folded state.',
      frame_classes: ['creasePattern'],
      frame_attributes: ['2D'],
      vertices_coords: vertices,
      edges_vertices: edges,
      edges_assignment: assignments,
      edges_foldAngle: foldAngles,
    },
    stats: {
      vertices: vertices.length,
      edges: edges.length,
      splitFrom: raw.length,
      snapped: moved,
      duplicates,
      skippedCurves,
      skippedStroke,
      nonFlat: foldAngles.filter((v) => v !== 0 && Math.abs(v) !== 180).length,
    },
  };
}

function main() {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith('--'));
  if (!input) {
    console.error('usage: node scripts/svg-to-fold.mjs <in.svg|dir> [--out DIR] [--flip-y]');
    process.exit(1);
  }
  const outIndex = args.indexOf('--out');
  const outDir = outIndex >= 0 ? args[outIndex + 1] : '.';
  const flipY = args.includes('--flip-y');
  const quiet = args.includes('--quiet');

  const files = statSync(input).isDirectory()
    ? readdirSync(input)
        .filter((f) => extname(f).toLowerCase() === '.svg')
        .map((f) => join(input, f))
    : [input];

  mkdirSync(outDir, { recursive: true });
  let converted = 0;
  for (const file of files) {
    const title = basename(file, extname(file));
    try {
      const { fold, stats } = svgToFold(readFileSync(file, 'utf8'), { title, flipY });
      writeFileSync(join(outDir, `${title}.fold`), `${JSON.stringify(fold)}\n`);
      converted += 1;
      if (!quiet) {
        const notes = [
          stats.snapped ? `${stats.snapped} snapped` : null,
          stats.duplicates ? `${stats.duplicates} dup` : null,
          stats.skippedCurves ? `${stats.skippedCurves} curved SKIPPED` : null,
          stats.skippedStroke ? `${stats.skippedStroke} unknown stroke` : null,
        ].filter(Boolean);
        console.log(
          `  ${title.padEnd(34)} ${String(stats.vertices).padStart(6)}v ` +
            `${String(stats.edges).padStart(6)}e  ${String(stats.nonFlat).padStart(5)} non-flat` +
            (notes.length ? `   (${notes.join(', ')})` : ''),
        );
      }
    } catch (error) {
      console.log(`  ${title.padEnd(34)} FAILED: ${error.message}`);
    }
  }
  if (!quiet) console.log(`\n${converted}/${files.length} converted into ${outDir}`);
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) main();
