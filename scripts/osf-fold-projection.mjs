#!/usr/bin/env node
/**
 * Extract the FOLD crease pattern out of an Ori Studio `.osf` project.
 *
 * The 3D-fold work needs crease patterns that carry real fold angles, and the
 * only files that carry them are ones somebody authored in Ori Studio. Those
 * are `.osf` projects — a workspace wrapper around, among much else, a FOLD
 * document at `workspace.documents[N].creasePattern.foldProjection`. This pulls
 * that document out so it can be committed as a `.fold` fixture, scanned by
 * `fold_corpus_scan`, or opened in any other tool.
 *
 * Every `.fold` fixture under `tests/fixtures/fold-angle-3d/` is a **derived
 * artefact** produced by this script, and its README records the exact command.
 * Re-running that command must reproduce the committed bytes; a test asserts it
 * (`crates/oristudio-cp/tests/non_flat_corpus.rs`).
 *
 * ## Usage
 *
 * ```sh
 * node scripts/osf-fold-projection.mjs input.osf > out.fold
 * node scripts/osf-fold-projection.mjs input.osf --component 0 > out.fold
 * node scripts/osf-fold-projection.mjs input.fold --precision 6 > out.fold
 * ```
 *
 * A `.fold` input is passed through the same minifier, which is what makes an
 * adopted export and an extracted projection comparable byte for byte.
 *
 * ## Options
 *
 * - `--precision N|full` — round `vertices_coords` and `edges_foldAngle` to N
 *   decimal places, or `full` to emit them unchanged (the default). Rounding is
 *   a size optimisation and it is **not** free: measured on this corpus, 6
 *   decimal places turns `penguin_freeform` from 0 flat-foldability violations
 *   into 12, and even 8 — which does preserve every foldability verdict — moves
 *   one parallel-plane separation down into the 1e-12..1e-9 band that the 3D
 *   admission gate's spectrum test reads. Round only where a fixture's README
 *   row records that the verdict *and* the separation spectrum are unchanged.
 * - `--component N` — keep only the Nth connected component of the vertex
 *   graph, ordered by descending vertex count. A canvas can hold two unrelated
 *   designs; `penguin_freeform` is one component of a two-design file.
 * - `--document N` — which `workspace.documents` entry to read (default 0).
 * - `--pretty` — indent the output instead of minifying it.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const USAGE =
  'usage: osf-fold-projection.mjs <input.osf|input.fold> ' +
  '[--component N] [--document N] [--precision N|full] [--pretty]';

/** Round, then drop a trailing `.0` so integers stay integers in the JSON. */
function round(value, precision) {
  if (precision === null) return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const scaled = Number(value.toFixed(precision));
  return Object.is(scaled, -0) ? 0 : scaled;
}

/**
 * Connected components of the vertex graph, largest first.
 *
 * Union-find rather than a traversal because the input is a flat edge list and
 * nothing here needs adjacency for anything else.
 */
function vertexComponents(vertexCount, edges) {
  const parent = Array.from({ length: vertexCount }, (_, i) => i);
  const find = (x) => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };
  for (const [a, b] of edges) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  const groups = new Map();
  for (let v = 0; v < vertexCount; v += 1) {
    const root = find(v);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(v);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

/** Per-edge and per-face arrays that must be filtered alongside the geometry. */
const EDGE_ARRAYS = [
  'edges_assignment',
  'edges_foldAngle',
  'edges_length',
  'oriedita:edges_colors',
  'oristudio:edges_line_colors',
];
const FACE_ARRAYS = ['faces_edges', 'faces_faces'];

/** Keep one connected component, renumbering vertices, edges and faces. */
export function selectComponent(fold, index) {
  const vertices = fold.vertices_coords ?? [];
  const edges = fold.edges_vertices ?? [];
  const faces = fold.faces_vertices ?? [];
  const components = vertexComponents(vertices.length, edges);
  const chosen = components[index];
  if (!chosen) {
    throw new Error(
      `--component ${index}: file has ${components.length} component(s)`
    );
  }
  const vertexMap = new Map(chosen.map((v, i) => [v, i]));
  const keptEdges = [];
  edges.forEach(([a, b], i) => {
    if (vertexMap.has(a) && vertexMap.has(b)) keptEdges.push(i);
  });
  const edgeMap = new Map(keptEdges.map((e, i) => [e, i]));
  const keptFaces = [];
  faces.forEach((face, i) => {
    if (face.every((v) => vertexMap.has(v))) keptFaces.push(i);
  });

  const out = { ...fold };
  out.vertices_coords = chosen.map((v) => vertices[v]);
  out.edges_vertices = keptEdges.map((e) => edges[e].map((v) => vertexMap.get(v)));
  for (const key of EDGE_ARRAYS) {
    if (Array.isArray(fold[key])) out[key] = keptEdges.map((e) => fold[key][e]);
  }
  out.faces_vertices = keptFaces.map((f) =>
    faces[f].map((v) => vertexMap.get(v))
  );
  for (const key of FACE_ARRAYS) {
    if (!Array.isArray(fold[key])) continue;
    out[key] = keptFaces.map((f) =>
      fold[key][f].map((e) => (key === 'faces_edges' ? edgeMap.get(e) : e))
    );
  }
  return out;
}

function main(argv) {
  const positional = [];
  const options = { component: null, document: 0, precision: null, pretty: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pretty') options.pretty = true;
    else if (arg === '--component') options.component = Number(argv[(i += 1)]);
    else if (arg === '--document') options.document = Number(argv[(i += 1)]);
    else if (arg === '--precision') {
      const value = argv[(i += 1)];
      options.precision = value === 'full' ? null : Number(value);
    } else if (arg.startsWith('--')) throw new Error(`${USAGE}\nunknown flag ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) throw new Error(USAGE);

  const raw = readFileSync(positional[0], 'utf8');
  const parsed = JSON.parse(raw);

  let fold;
  if (parsed.format === 'oristudio-project' || parsed.workspace) {
    const document = parsed.workspace?.documents?.[options.document];
    if (!document) {
      throw new Error(`no workspace.documents[${options.document}] in this .osf`);
    }
    fold = document.creasePattern?.foldProjection;
    if (!fold) {
      // A project saved before its pattern was ever folded has no projection.
      // Saying so beats emitting an empty FOLD document.
      throw new Error(
        'this .osf carries no creasePattern.foldProjection — open it in Ori ' +
          'Studio, fold it, and save before extracting'
      );
    }
  } else if (parsed.vertices_coords || parsed.edges_vertices) {
    fold = parsed;
  } else {
    throw new Error('input is neither an .osf project nor a FOLD document');
  }

  if (options.component !== null) fold = selectComponent(fold, options.component);

  const out = { ...fold };
  if (Array.isArray(fold.vertices_coords)) {
    out.vertices_coords = fold.vertices_coords.map((v) =>
      v.map((c) => round(c, options.precision))
    );
  }
  if (Array.isArray(fold.edges_foldAngle)) {
    out.edges_foldAngle = fold.edges_foldAngle.map((a) =>
      round(a, options.precision)
    );
  }

  process.stdout.write(
    options.pretty
      ? `${JSON.stringify(out, null, 2)}\n`
      : JSON.stringify(out)
  );
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
