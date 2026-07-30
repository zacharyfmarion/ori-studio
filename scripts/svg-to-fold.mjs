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

/** Vertices closer than this in SVG units are the same point. */
const WELD_EPSILON = 1e-6;

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
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > WELD_EPSILON) {
        segments.push({ a, b, assignment, fraction });
      }
    };

    if (/^<line\b/i.test(tag)) {
      const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((n) =>
        Number.parseFloat(attr(tag, n, classes) ?? '0')
      );
      push([x1, y1], [x2, y2]);
    } else if (/^<rect\b/i.test(tag)) {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((n) =>
        Number.parseFloat(attr(tag, n, classes) ?? '0')
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

export function svgToFold(svg, { title = 'Converted', flipY = false } = {}) {
  const { segments, skippedCurves, skippedStroke } = extractSegments(svg);
  if (segments.length === 0) throw new Error('no recognised creases');

  let maxY = -Infinity;
  for (const { a, b } of segments) maxY = Math.max(maxY, a[1], b[1]);
  const place = ([x, y]) => [x, flipY ? maxY - y : y];

  const key = ([x, y]) =>
    `${Math.round(x / WELD_EPSILON)},${Math.round(y / WELD_EPSILON)}`;
  const indexOf = new Map();
  const vertices = [];
  const vertexIndex = (point) => {
    const placed = place(point);
    const k = key(placed);
    let index = indexOf.get(k);
    if (index === undefined) {
      index = vertices.length;
      vertices.push(placed);
      indexOf.set(k, index);
    }
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
          stats.duplicates ? `${stats.duplicates} dup` : null,
          stats.skippedCurves ? `${stats.skippedCurves} curved SKIPPED` : null,
          stats.skippedStroke ? `${stats.skippedStroke} unknown stroke` : null,
        ].filter(Boolean);
        console.log(
          `  ${title.padEnd(34)} ${String(stats.vertices).padStart(6)}v ` +
            `${String(stats.edges).padStart(6)}e  ${String(stats.nonFlat).padStart(5)} non-flat` +
            (notes.length ? `   (${notes.join(', ')})` : '')
        );
      }
    } catch (error) {
      console.log(`  ${title.padEnd(34)} FAILED: ${error.message}`);
    }
  }
  if (!quiet) console.log(`\n${converted}/${files.length} converted into ${outDir}`);
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) main();
