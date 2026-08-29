/**
 * Where `importAddOristudioCpDocumentFromText` puts an import.
 *
 * Oriedita's `import_add` places by `max_x(existing) + 100 - min_x(added)`, and
 * on a document with no geometry those extents are `0.0` — so an import into a
 * blank canvas lands in the lower-right quadrant instead of on the paper. The
 * web side corrects that for a canvas the user has not drawn on, and must leave
 * every other target exactly where the kernel put it.
 *
 * The kernel is faked here, deliberately reproducing `arrangement.rs`'s shift
 * verbatim: the subject is the web-side placement decision layered on top of it,
 * and the kernel's own behaviour is covered by
 * `import_add_shifts_import_right_of_existing_pattern` and
 * `import_add_into_empty_pattern_gaps_by_one_hundred`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';

const documents = new Map<number, OristudioCpDocumentSnapshot>();
let nextHandle = 1;

function put(document: OristudioCpDocumentSnapshot): number {
  const handle = nextHandle++;
  documents.set(handle, structuredClone(document));
  return handle;
}

function segment(ax: number, ay: number, bx: number, by: number): OristudioCpLineSegment {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    active: 'Inactive0',
    color: 'Red1',
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
  };
}

function emptyDocument(segments: OristudioCpLineSegment[]): OristudioCpDocumentSnapshot {
  return {
    title: 'Fixture',
    crease_pattern: {
      line_segments: segments,
      circles: [],
      points: [],
      aux_line_segments: [],
      texts: [],
      grid: createStarterOristudioCpDocument().crease_pattern.grid,
    },
    metadata: {},
  };
}

function extents(segments: readonly OristudioCpLineSegment[]) {
  if (segments.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const xs = segments.flatMap((s) => [s.a.x, s.b.x]);
  const ys = segments.flatMap((s) => [s.a.y, s.b.y]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

const api = {
  loadDocument: vi.fn(async (document: OristudioCpDocumentSnapshot) => put(document)),
  loadFoldFile: vi.fn(async (text: string) =>
    put(emptyDocument((JSON.parse(text) as { segments: OristudioCpLineSegment[] }).segments))
  ),
  loadCp: vi.fn(async () => put(emptyDocument([]))),
  loadOri: vi.fn(async () => put(emptyDocument([]))),
  loadOrh: vi.fn(async () => put(emptyDocument([]))),
  placeCircles: vi.fn(async () => undefined),
  freeDocument: vi.fn(async (handle: number) => {
    documents.delete(handle);
  }),
  restoreDocument: vi.fn(async (handle: number, document: OristudioCpDocumentSnapshot) => {
    documents.set(handle, structuredClone(document));
  }),
  // `arrangement.rs:290` verbatim, minus the division — the 100-unit gap
  // guarantees no added/existing pair intersects, so the merge is append-only.
  importAdd: vi.fn(async (target: number, imported: number) => {
    const into = documents.get(target);
    const from = documents.get(imported);
    if (!into || !from) throw new Error('missing handle');
    const existing = extents(into.crease_pattern.line_segments);
    const added = extents(from.crease_pattern.line_segments);
    const dx = existing.maxX + 100 - added.minX;
    const dy = existing.maxY - added.maxY;
    into.crease_pattern.line_segments.push(
      ...from.crease_pattern.line_segments.map((s) => ({
        ...s,
        a: { x: s.a.x + dx, y: s.a.y + dy },
        b: { x: s.b.x + dx, y: s.b.y + dy },
      }))
    );
  }),
  summary: vi.fn(async (handle: number) => {
    const model = documents.get(handle)?.crease_pattern;
    return {
      title: 'Fixture',
      line_segments: model?.line_segments.length ?? 0,
      circles: model?.circles.length ?? 0,
      points: model?.points.length ?? 0,
      aux_line_segments: model?.aux_line_segments.length ?? 0,
      texts: model?.texts.length ?? 0,
      can_save_as_cp: true,
      is_empty: (model?.line_segments.length ?? 0) === 0,
    };
  }),
  documentGeometry: vi.fn(async (handle: number) => ({ snapshot: documents.get(handle) })),
  operationDescriptors: vi.fn(async () => []),
};

vi.mock('../../engines/engineHost', () => ({
  connectEngine: async () => api,
  isEngineConnected: () => true,
}));

vi.mock('../../engine/oristudioCpGeometry', () => ({
  decodeCpGeometryToSnapshot: (geometry: { snapshot: OristudioCpDocumentSnapshot }) =>
    structuredClone(geometry.snapshot),
}));

import {
  createBlankOristudioCpDocument,
  importAddOristudioCpDocumentFromText,
  lastOristudioCpImportAddPlacement,
  releaseOristudioCpDocument,
  restoreOristudioCpDocumentInPlace,
} from './oristudioCpRuntime';

/** A unit square 400 across, which is what a normalized FOLD import arrives as. */
const IMPORT_TEXT = JSON.stringify({
  segments: [
    segment(-200, -200, 200, -200),
    segment(200, -200, 200, 200),
    segment(200, 200, -200, 200),
    segment(-200, 200, -200, -200),
    segment(-200, -200, 200, 200),
  ],
});

async function importAdd() {
  return importAddOristudioCpDocumentFromText(IMPORT_TEXT, {
    format: 'fold',
    filename: 'detected.fold',
  });
}

beforeEach(async () => {
  await releaseOristudioCpDocument();
  documents.clear();
  nextHandle = 1;
  vi.clearAllMocks();
});

describe('import (add) placement', () => {
  it('centres the import on a canvas the user has not drawn on', async () => {
    await createBlankOristudioCpDocument();
    const merged = await importAdd();

    // The starter border went, so the import's own paper edge is the paper edge
    // — five segments in, five segments out, no second empty square beside it.
    expect(merged.document.crease_pattern.line_segments).toHaveLength(5);
    expect(lastOristudioCpImportAddPlacement()).toEqual({
      bounds: { minX: -200, minY: -200, maxX: 200, maxY: 200 },
      centered: true,
    });
  });

  it('leaves Oriedita placement alone once the document holds anything of its own', async () => {
    await createBlankOristudioCpDocument();
    // One crease on the starter sheet is enough: this is the user's work now.
    const starter = createStarterOristudioCpDocument();
    await restoreOristudioCpDocumentInPlace({
      ...starter,
      crease_pattern: {
        ...starter.crease_pattern,
        line_segments: [...starter.crease_pattern.line_segments, segment(-100, -100, 100, 100)],
      },
    });

    const merged = await importAdd();

    // Nothing removed, and the import sits 100 clear of the existing max X.
    expect(merged.document.crease_pattern.line_segments).toHaveLength(10);
    expect(lastOristudioCpImportAddPlacement()).toEqual({
      bounds: { minX: 300, minY: -200, maxX: 700, maxY: 200 },
      centered: false,
    });
  });

  it('does not treat a resized sheet as untouched', async () => {
    await createBlankOristudioCpDocument();
    const starter = createStarterOristudioCpDocument();
    await restoreOristudioCpDocumentInPlace({
      ...starter,
      crease_pattern: {
        ...starter.crease_pattern,
        line_segments: starter.crease_pattern.line_segments.map((s) => ({
          ...s,
          a: { x: s.a.x * 2, y: s.a.y * 2 },
          b: { x: s.b.x * 2, y: s.b.y * 2 },
        })),
      },
    });

    await importAdd();

    expect(lastOristudioCpImportAddPlacement()?.centered).toBe(false);
  });

  it('centres an import into a document with no line segments at all', async () => {
    await createBlankOristudioCpDocument();
    await restoreOristudioCpDocumentInPlace(emptyDocument([]));

    await importAdd();

    expect(lastOristudioCpImportAddPlacement()).toEqual({
      bounds: { minX: -200, minY: -200, maxX: 200, maxY: 200 },
      centered: true,
    });
  });

  it('puts the sheet back when the merge itself fails', async () => {
    await createBlankOristudioCpDocument();
    api.importAdd.mockRejectedValueOnce(new Error('kernel refused the merge'));

    await expect(importAdd()).rejects.toThrow('kernel refused the merge');

    // The starter border was cleared in anticipation of a merge that never
    // landed; without the restore the user is left with no paper at all.
    const restored = await api.summary(1);
    expect(restored.line_segments).toBe(4);
  });

  it('reads the document only when the summary says it could still be blank', async () => {
    await createBlankOristudioCpDocument();
    const starter = createStarterOristudioCpDocument();
    await restoreOristudioCpDocumentInPlace({
      ...starter,
      crease_pattern: {
        ...starter.crease_pattern,
        line_segments: [
          ...starter.crease_pattern.line_segments,
          segment(-100, -100, 100, 100),
          segment(-100, 100, 100, -100),
        ],
      },
    });
    api.documentGeometry.mockClear();

    await importAdd();

    // Six segments is already more than a starter border, so the merge answers
    // from the summary and never decodes the document to find out.
    const geometryReads = api.documentGeometry.mock.calls.length;
    expect(geometryReads).toBe(1); // the post-merge refresh, and nothing before it
  });
});
