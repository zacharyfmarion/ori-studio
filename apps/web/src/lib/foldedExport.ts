import type { FoldDocument } from '../engine/types';
import { dropPerEdgeArrays } from './foldEdgeArrays';

/**
 * Serializers for the simulator's folded 3D result.
 *
 * The simulator is the only part of the app that produces folded geometry, and
 * until now it could not hand it anywhere. These take the settled mesh (the
 * solver's triangles plus its current vertex positions) and write the formats
 * upstream Origami Simulator exports: a folded-form FOLD frame, OBJ, and STL.
 *
 * Pure string/byte builders with no DOM or store dependency, so they are
 * testable and reusable by the desktop shell.
 */

export interface FoldedMesh {
  /** xyz per vertex. */
  positions: Float32Array;
  /** 3 vertex indices per triangle. */
  triangles: Uint32Array;
  /** Fold percent the snapshot was taken at, recorded in FOLD metadata. */
  foldPercent: number;
}

/** Decimals kept in text formats: plenty for print, and keeps files small. */
const PRECISION = 6;

function round(value: number): number {
  return Number(value.toFixed(PRECISION));
}

/**
 * A FOLD document of the folded form. `frame_classes: ['foldedForm']` is what
 * marks it as folded rather than a crease pattern, per the FOLD spec, and the
 * source pattern's edge assignments are carried over so the file still says which
 * creases are mountains and valleys.
 */
export function foldedFoldDocument(source: FoldDocument, mesh: FoldedMesh): FoldDocument {
  const vertexCount = Math.floor(mesh.positions.length / 3);
  const vertices: number[][] = [];
  for (let i = 0; i < vertexCount; i += 1) {
    vertices.push([
      round(mesh.positions[i * 3] ?? 0),
      round(mesh.positions[i * 3 + 1] ?? 0),
      round(mesh.positions[i * 3 + 2] ?? 0),
    ]);
  }

  const faces: number[][] = [];
  for (let i = 0; i + 2 < mesh.triangles.length; i += 3) {
    faces.push([mesh.triangles[i]!, mesh.triangles[i + 1]!, mesh.triangles[i + 2]!]);
  }

  const folded: FoldDocument = {
    ...source,
    frame_classes: ['foldedForm'],
    frame_title: `${source.frame_title ?? 'Folded form'} (${Math.round(mesh.foldPercent)}%)`,
    vertices_coords: vertices,
    faces_vertices: faces,
  };

  // The simulator triangulates, so the source's edge lists no longer index the
  // same vertices; keep assignments only when the vertex set still lines up.
  // Otherwise emit no edges rather than edges pointing at the wrong vertices --
  // the faces still carry the full geometry. Every per-edge array goes with
  // them, including the namespaced colour extensions the spread carried in:
  // keeping those would assert colours for edges this document no longer has.
  const sourceVertexCount = source.vertices_coords?.length ?? 0;
  if (sourceVertexCount !== vertexCount) {
    dropPerEdgeArrays(folded);
    folded.edges_vertices = [];
  }
  // Rebuilt by consumers from the new faces; stale copies would contradict them.
  delete folded.faces_edges;
  delete folded.edges_faces;
  delete folded.face_orders;
  return folded;
}

/** Wavefront OBJ. Indices are 1-based, which is the classic off-by-one here. */
export function foldedObj(mesh: FoldedMesh, name = 'folded'): string {
  const lines: string[] = [
    `# Ori Studio folded form (${Math.round(mesh.foldPercent)}%)`,
    `o ${name}`,
  ];
  const vertexCount = Math.floor(mesh.positions.length / 3);
  for (let i = 0; i < vertexCount; i += 1) {
    lines.push(
      `v ${round(mesh.positions[i * 3] ?? 0)} ${round(mesh.positions[i * 3 + 1] ?? 0)} ${round(
        mesh.positions[i * 3 + 2] ?? 0,
      )}`,
    );
  }
  for (let i = 0; i + 2 < mesh.triangles.length; i += 3) {
    lines.push(
      `f ${mesh.triangles[i]! + 1} ${mesh.triangles[i + 1]! + 1} ${mesh.triangles[i + 2]! + 1}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Binary STL. Chosen over ASCII because a folded model is tens of thousands of
 * triangles and the text form is several times larger for no benefit. Facet
 * normals are computed from the winding; STL has no vertex sharing, so each
 * triangle repeats its vertices.
 */
export function foldedStl(mesh: FoldedMesh): Uint8Array {
  const triangleCount = Math.floor(mesh.triangles.length / 3);
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  const header = new TextEncoder().encode('Ori Studio folded form');
  new Uint8Array(buffer, 0, Math.min(80, header.length)).set(header.subarray(0, 80));
  view.setUint32(80, triangleCount, true);

  const point = (index: number): [number, number, number] => [
    mesh.positions[index * 3] ?? 0,
    mesh.positions[index * 3 + 1] ?? 0,
    mesh.positions[index * 3 + 2] ?? 0,
  ];

  let offset = 84;
  for (let i = 0; i < triangleCount; i += 1) {
    const a = point(mesh.triangles[i * 3]!);
    const b = point(mesh.triangles[i * 3 + 1]!);
    const c = point(mesh.triangles[i * 3 + 2]!);
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    // A degenerate triangle has no normal; zero is the conventional STL filler.
    if (length > 0) {
      nx /= length;
      ny /= length;
      nz /= length;
    } else {
      nx = 0;
      ny = 0;
      nz = 0;
    }
    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);
    for (const [j, vertex] of [a, b, c].entries()) {
      view.setFloat32(offset + 12 + j * 12, vertex[0], true);
      view.setFloat32(offset + 16 + j * 12, vertex[1], true);
      view.setFloat32(offset + 20 + j * 12, vertex[2], true);
    }
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }
  return new Uint8Array(buffer);
}
