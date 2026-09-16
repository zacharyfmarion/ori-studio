/**
 * What the References workspace treats as "the pattern changed".
 *
 * The panel's whole staleness story hangs off this one string: a change marks a
 * finished answer "Out of date", drops its highlights, and makes Recompute
 * re-pay a multi-second ReferenceFinder query. Both directions matter, and the
 * two obvious counters get one of them wrong each.
 */
import { describe, expect, it } from 'vitest';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpDocumentState,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import { referencesRevisionKey } from './useReferencesView';

function segment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  selected = false
): OristudioCpLineSegment {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    color: 'Mountain',
    selected,
  } as unknown as OristudioCpLineSegment;
}

function snapshot(lines: OristudioCpLineSegment[]): OristudioCpDocumentSnapshot {
  return {
    crease_pattern: { line_segments: lines },
    metadata: {},
  } as unknown as OristudioCpDocumentSnapshot;
}

function state(
  document: OristudioCpDocumentSnapshot,
  loadSerial = 1
): OristudioCpDocumentState {
  return { loadSerial, document } as unknown as OristudioCpDocumentState;
}

const LINES = [segment(0, 0, 100, 0), segment(0, 0, 0, 100)];

describe('referencesRevisionKey', () => {
  it('is unchanged by a selection-only command', () => {
    // A box/lasso/polygon select goes through the kernel and bumps
    // `foldArtifactRevision` while changing no crease. Keyed on that counter the
    // panel said "Out of date" over a byte-identical pattern.
    const before = referencesRevisionKey(state(snapshot(LINES)));
    const after = referencesRevisionKey(
      state(snapshot([segment(0, 0, 100, 0, true), segment(0, 0, 0, 100, true)]))
    );
    expect(after).toBe(before);
  });

  it('changes when a crease moves, is added, or changes colour', () => {
    const before = referencesRevisionKey(state(snapshot(LINES)));
    expect(referencesRevisionKey(state(snapshot([segment(0, 0, 100, 1), LINES[1]])))).not.toBe(before);
    expect(referencesRevisionKey(state(snapshot([...LINES, segment(0, 0, 50, 50)])))).not.toBe(before);
    const recoloured = segment(0, 0, 100, 0);
    (recoloured as { color: string }).color = 'Valley';
    expect(referencesRevisionKey(state(snapshot([recoloured, LINES[1]])))).not.toBe(before);
  });

  it('still catches an undo, which bumps no CP revision of its own', () => {
    // CP undo/redo advances `foldArtifactRevision` alone (`historySlice`), so a
    // key built from `loadSerial` + `oristudioCpRevision` would call the
    // restored snapshot current. The content hash does not.
    const edited = referencesRevisionKey(state(snapshot([...LINES, segment(0, 0, 50, 50)])));
    const undone = referencesRevisionKey(state(snapshot(LINES)));
    expect(undone).not.toBe(edited);
  });

  it('changes on a fresh load of the same geometry, and has a value with no document', () => {
    expect(referencesRevisionKey(state(snapshot(LINES), 2))).not.toBe(
      referencesRevisionKey(state(snapshot(LINES), 1))
    );
    expect(referencesRevisionKey(null)).toBe('none');
  });
});
