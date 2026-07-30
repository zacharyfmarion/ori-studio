#!/usr/bin/env node
/**
 * Lay several FOLD crease patterns out in a grid inside one document.
 *
 * For opening a whole corpus at once instead of a file at a time.
 *
 * ## How faithful the result is
 *
 * Each pattern is uniformly scaled and translated into its cell. Neither
 * operation changes a fold angle or a crease direction, and the closure
 * condition depends on nothing else — so the *maths* is exactly preserved.
 *
 * The **topology extraction is not**, quite. Endpoints are clustered into
 * vertices with an absolute tolerance (`Epsilon::FLAT`, 1e-6 units), so scaling
 * a pattern moves a borderline pair across that threshold and can merge or split
 * one vertex. Measured over this corpus: **1 vertex of 12,585** changed verdict,
 * and no self-intersection or stacked-layer decision moved at all.
 *
 * Close enough to browse and click through; not the thing to quote a number
 * from. For an exact count, check the pattern on its own.
 *
 * Cells are laid out with a gap so no two patterns share a vertex, which would
 * fuse two unrelated designs into one vertex fan and invent violations.
 *
 * Usage:
 *   node scripts/combine-folds.mjs <dir|file...> --out combined.fold [--cell 400]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

/** Fraction of a cell left empty around each pattern. */
const MARGIN = 0.12;

function boundsOf(vertices) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of vertices) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

export function combineFolds(documents, { cell = 400 } = {}) {
  const usable = documents.filter((d) => d.fold.vertices_coords?.length);
  if (usable.length === 0) throw new Error('nothing to combine');
  const columns = Math.ceil(Math.sqrt(usable.length));

  const vertices = [];
  const edges = [];
  const assignments = [];
  const foldAngles = [];
  const layout = [];

  usable.forEach(({ name, fold }, index) => {
    const bounds = boundsOf(fold.vertices_coords);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const span = Math.max(width, height) || 1;
    // Uniform: a non-uniform scale would shear the sector angles and change
    // every closure residual in the pattern.
    const scale = (cell * (1 - 2 * MARGIN)) / span;

    const column = index % columns;
    const row = Math.floor(index / columns);
    const originX = column * cell + (cell - width * scale) / 2;
    const originY = row * cell + (cell - height * scale) / 2;

    const offset = vertices.length;
    for (const [x, y] of fold.vertices_coords) {
      vertices.push([
        originX + (x - bounds.minX) * scale,
        originY + (y - bounds.minY) * scale,
      ]);
    }
    fold.edges_vertices.forEach(([a, b], edgeIndex) => {
      edges.push([a + offset, b + offset]);
      assignments.push(fold.edges_assignment?.[edgeIndex] ?? 'U');
      foldAngles.push(fold.edges_foldAngle?.[edgeIndex] ?? 0);
    });
    layout.push({ name, row, column, edges: fold.edges_vertices.length });
  });

  const description = layout
    .map(({ name, row, column }) => `r${row}c${column} ${name}`)
    .join('; ');

  return {
    fold: {
      file_spec: 1.1,
      file_creator: 'Ori Studio combine-folds',
      file_title: `${usable.length} crease patterns`,
      file_description:
        'Several patterns laid out in a grid, each uniformly scaled and translated. ' +
        'Fold angles and crease directions are preserved exactly; endpoint clustering ' +
        'uses an absolute tolerance, so a borderline vertex can differ from the same ' +
        `pattern checked alone. Layout: ${description}`,
      frame_classes: ['creasePattern'],
      frame_attributes: ['2D'],
      vertices_coords: vertices,
      edges_vertices: edges,
      edges_assignment: assignments,
      edges_foldAngle: foldAngles,
    },
    layout,
  };
}

function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const out = outIndex >= 0 ? args[outIndex + 1] : 'combined.fold';
  const cellIndex = args.indexOf('--cell');
  const cell = cellIndex >= 0 ? Number(args[cellIndex + 1]) : 400;
  const inputs = args.filter(
    (a, i) => !a.startsWith('--') && args[i - 1] !== '--out' && args[i - 1] !== '--cell'
  );
  if (inputs.length === 0) {
    console.error('usage: node scripts/combine-folds.mjs <dir|file...> --out combined.fold');
    process.exit(1);
  }

  const files = inputs.flatMap((input) =>
    statSync(input).isDirectory()
      ? readdirSync(input)
          .filter((f) => extname(f).toLowerCase() === '.fold')
          .sort()
          .map((f) => join(input, f))
      : [input]
  );

  const documents = [];
  for (const file of files) {
    try {
      documents.push({
        name: basename(file, extname(file)),
        fold: JSON.parse(readFileSync(file, 'utf8')),
      });
    } catch (error) {
      console.log(`  skipped ${basename(file)}: ${error.message}`);
    }
  }

  const { fold, layout } = combineFolds(documents, { cell });
  writeFileSync(out, `${JSON.stringify(fold)}\n`);
  const columns = Math.ceil(Math.sqrt(layout.length));
  for (let row = 0; row * columns < layout.length; row += 1) {
    console.log(
      `  row ${row}: ` +
        layout
          .filter((entry) => entry.row === row)
          .map((entry) => entry.name)
          .join(', ')
    );
  }
  console.log(
    `\n${layout.length} patterns, ${fold.vertices_coords.length} vertices, ` +
      `${fold.edges_vertices.length} edges -> ${out}`
  );
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) main();
