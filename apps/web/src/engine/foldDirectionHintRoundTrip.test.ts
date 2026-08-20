/**
 * Fold-direction hints must survive the paths that leave and re-enter the
 * kernel: a `.osf` save/load, and an undo.
 *
 * These are end-to-end on purpose. The hint was carried correctly by the kernel,
 * by serde, by the compact transport and by the `.osf` reader — every layer
 * tested in isolation passed — and it was still lost on save, because the *TS*
 * transport decoder never read `seg_attr`'s fifth slot. A test of any single hop
 * would have stayed green. So these drive the real wasm kernel and the real
 * `.osf` writer/reader, in the order the app runs them.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
  document_geometry,
  document_snapshot,
  free_document,
  load_document,
  restore_from_compact,
} from '../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import { decodeCpGeometryToSnapshot, type CpGeometryTransport } from './oristudioCpGeometry';
import { batterySnapshot, initCpWasm } from './oristudioCpTestSupport';
import type { OristudioCpDocumentSnapshot } from './oristudioCpTypes';
import {
  createNativeCreasePatternProjectFile,
  parseNativeProjectFile,
  serializeNativeProjectFile,
} from '../lib/nativeProjectFile';
import { DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS, emptyOristudioCpSelection } from '../lib/creasePatternViewport';
import { importedCpLineage } from '../lib/oristudioCpLineage';

beforeAll(initCpWasm);

/** Every `[color, hint]` pair in a document's creases, in order. */
function hintPairs(snapshot: OristudioCpDocumentSnapshot): [string, string | undefined][] {
  return snapshot.crease_pattern.line_segments.map((segment) => [
    segment.color,
    segment.fold_direction_hint,
  ]);
}

/**
 * What the app actually holds in its store after any edit: the compact
 * transport, decoded. Saving, undo and copy/paste all read from here — which is
 * why a hint lost at this hop is lost to all three.
 */
function decodedStoreDocument(handle: number): OristudioCpDocumentSnapshot {
  return decodeCpGeometryToSnapshot(document_geometry(handle) as CpGeometryTransport);
}

function writeAndReadOsf(document: OristudioCpDocumentSnapshot): OristudioCpDocumentSnapshot {
  const file = createNativeCreasePatternProjectFile({
    title: 'Hinted CP',
    filename: 'hinted.osf',
    path: null,
    document,
    source: null,
    foldProjection: null,
    foldArtifacts: null,
    creaseColorMode: 'mvf',
    selection: emptyOristudioCpSelection(),
    viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
    foldedFigures: [],
    activeFoldedFigureId: null,
    lineage: importedCpLineage(),
    appVersion: '0.1.1',
    now: new Date('2026-08-19T12:00:00.000Z'),
  });
  const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));
  const creasePattern = parsed.workspace.creasePattern;
  if (!creasePattern) throw new Error('parsed .osf has no crease pattern');
  return creasePattern.creasePattern.document;
}

describe('fold-direction hints survive a .osf round trip', () => {
  it('keeps every hint from kernel through save, reload, and back into the kernel', () => {
    const handle = load_document(batterySnapshot('hint round trip'));
    const original = document_snapshot(handle) as OristudioCpDocumentSnapshot;
    const expected = hintPairs(original);
    // The battery must actually carry hints, or this test proves nothing.
    expect(expected.filter(([, hint]) => hint !== undefined).length).toBeGreaterThan(0);

    // The whole app path: store snapshot -> .osf text -> parse -> kernel.
    const reloaded = load_document(writeAndReadOsf(decodedStoreDocument(handle)));
    const after = document_snapshot(reloaded) as OristudioCpDocumentSnapshot;

    expect(hintPairs(after)).toEqual(expected);
    // Aux lines carry hints too, and reach `readSegment` by a different call.
    expect(after.crease_pattern.aux_line_segments.map((s) => s.fold_direction_hint)).toEqual(
      original.crease_pattern.aux_line_segments.map((s) => s.fold_direction_hint)
    );

    free_document(handle);
    free_document(reloaded);
  });

  it('keeps hints across an undo, which restores the same decoded snapshot', () => {
    // `historySlice` restores `previous.document` — a decoded store snapshot —
    // through `restore_document`, which replaces the kernel model wholesale. A
    // hint missing from that snapshot is erased document-wide, no save involved.
    const handle = load_document(batterySnapshot('hint undo'));
    const before = document_snapshot(handle) as OristudioCpDocumentSnapshot;

    const restored = load_document(decodedStoreDocument(handle));
    const after = document_snapshot(restored) as OristudioCpDocumentSnapshot;

    expect(hintPairs(after)).toEqual(hintPairs(before));
    free_document(handle);
    free_document(restored);
  });

  it('keeps hints through restore_from_compact (the transport-native path)', () => {
    const handle = load_document(batterySnapshot('hint compact'));
    const before = document_snapshot(handle) as OristudioCpDocumentSnapshot;

    restore_from_compact(handle, document_geometry(handle) as CpGeometryTransport);
    const after = document_snapshot(handle) as OristudioCpDocumentSnapshot;

    expect(hintPairs(after)).toEqual(hintPairs(before));
    free_document(handle);
  });
});
