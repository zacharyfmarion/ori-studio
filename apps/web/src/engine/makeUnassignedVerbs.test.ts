/**
 * The two "Make Unassigned" menu items, driven through `execute_cp_command`
 * against the real wasm kernel.
 *
 * End-to-end on purpose, and the purpose is specific. The kernel's own unit
 * tests called `make_unassigned` directly, so they exercised neither the
 * `forget_direction` payload flag nor the arm each menu item reaches — and the
 * two items are one `OperationId` separated by exactly that flag. A no-op
 * survived in the one case they differ (a crease already unassigned but still
 * carrying a hint) with every Rust test green, because no test crossed the
 * dispatch. These do.
 *
 * `line_ids` is **one-based** across this boundary, which is the other thing
 * only a test at this level can get wrong.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
  document_snapshot,
  execute_cp_command,
  free_document,
  load_document,
} from '../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import { batterySnapshot, initCpWasm } from './oristudioCpTestSupport';
import type {
  OristudioCpCommandResult,
  OristudioCpDocumentSnapshot,
  OristudioCpFoldDirectionHint,
  OristudioCpLineColor,
  OristudioCpLineSegment,
} from './oristudioCpTypes';

beforeAll(initCpWasm);

/** A document holding exactly `colors`, in order, through the real kernel. */
function documentWith(colors: OristudioCpLineColor[]): number {
  const base = batterySnapshot('unassign verbs');
  const line_segments: OristudioCpLineSegment[] = colors.map((color, index) => ({
    a: { x: index, y: 0 },
    b: { x: index, y: 10 },
    color,
    active: 'Inactive0',
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
  }));
  const snapshot: OristudioCpDocumentSnapshot = {
    ...base,
    crease_pattern: { ...base.crease_pattern, line_segments },
  };
  return load_document(snapshot) as number;
}

/**
 * `cp.makeUnassigned` sends `forget_direction: true`; the keep-direction item
 * sends no payload flag at all (`menuActions.ts`). Both are modelled here.
 */
function unassign(handle: number, lineIds: number[], forgetDirection?: boolean): number {
  const result = execute_cp_command(handle, 'CreaseMakeUnassigned', {
    line_ids: lineIds,
    ...(forgetDirection === undefined ? {} : { forget_direction: forgetDirection }),
  }) as OristudioCpCommandResult;
  const message = result.diagnostics[0] ?? '';
  const match = /^Changed (\d+) line\(s\)$/.exec(message);
  expect(match, `unexpected result message ${JSON.stringify(message)}`).not.toBeNull();
  return Number(match![1]);
}

/** `[colour, hint]`. The snapshot types `color` as a bare `string`, so this does too. */
type CreaseState = [string, OristudioCpFoldDirectionHint | undefined];

function creases(handle: number): CreaseState[] {
  const snapshot = document_snapshot(handle) as OristudioCpDocumentSnapshot;
  return snapshot.crease_pattern.line_segments.map(
    (segment): CreaseState => [segment.color, segment.fold_direction_hint]
  );
}

describe('Make Unassigned, through the real kernel', () => {
  /**
   * The bug, on the path the user takes: keep the direction, change your mind,
   * and ask for it to be forgotten. This reported `Changed 0 line(s)` and left
   * the hint in place, so the menu item did nothing and said nothing.
   */
  it('forgets a hint that Keep Direction left behind', () => {
    const handle = documentWith(['Red1']);
    try {
      expect(unassign(handle, [1])).toBe(1);
      expect(creases(handle)).toEqual([['None', 'Mountain']]);

      expect(unassign(handle, [1], true)).toBe(1);
      expect(creases(handle)).toEqual([['None', undefined]]);

      // Now there genuinely is nothing left to forget.
      expect(unassign(handle, [1], true)).toBe(0);
    } finally {
      free_document(handle);
    }
  });

  /**
   * The complement. Keep Direction cannot recover a direction from a crease
   * that has no colour to read one off, so it must leave an existing hint
   * alone rather than overwrite it with nothing.
   */
  it('Keep Direction never erases a hint it cannot recover', () => {
    const handle = documentWith(['Blue2']);
    try {
      expect(unassign(handle, [1])).toBe(1);
      expect(unassign(handle, [1])).toBe(0);
      expect(creases(handle)).toEqual([['None', 'Valley']]);
    } finally {
      free_document(handle);
    }
  });

  /** A realistic mixed selection, and the count the user is shown for it. */
  it('reports only the lines that moved', () => {
    const handle = documentWith(['Red1', 'Blue2', 'Black0', 'None']);
    try {
      // Line 2 acquires a hint the way a document acquires one in practice.
      expect(unassign(handle, [2])).toBe(1);
      expect(creases(handle)[1]).toEqual(['None', 'Valley']);

      // Red1, the hinted crease and the border move; the bare one does not.
      expect(unassign(handle, [1, 2, 3, 4], true)).toBe(3);
      expect(creases(handle)).toEqual([
        ['None', undefined],
        ['None', undefined],
        ['None', undefined],
        ['None', undefined],
      ]);

      expect(unassign(handle, [1, 2, 3, 4], true)).toBe(0);
    } finally {
      free_document(handle);
    }
  });

  /**
   * Select-all takes the sheet outline with it, deliberately — see
   * `operations/native/unassign.rs`. Pinned here as well as in Rust because
   * this is the layer the menu item actually goes through.
   */
  it('dissolves a border on select-all rather than silently declining', () => {
    const handle = documentWith(['Black0', 'Black0', 'Red1', 'Cyan3']);
    try {
      expect(unassign(handle, [1, 2, 3, 4], true)).toBe(4);
      expect(creases(handle).every(([color]) => color === 'None')).toBe(true);
    } finally {
      free_document(handle);
    }
  });
});
