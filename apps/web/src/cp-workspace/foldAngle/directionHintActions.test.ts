/**
 * The mixed-state logic behind the fold-direction chips, plus one end-to-end
 * check that the payload the control sends is one the real kernel acts on.
 *
 * The summariser is where this control can silently lie — "all unhinted" and
 * "they disagree" are different states that both have no shared direction, and
 * conflating them would light up the "None" chip on a half-mountain selection.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
  describeDirectionHintAffected,
  directionHintOptions,
  isDirectionHintActive,
  summariseDirectionHints,
} from './directionHintActions';
import {
  document_snapshot,
  execute_cp_command,
  free_document,
  load_cp,
  load_document,
} from '../../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import { initCpWasm } from '../../engine/oristudioCpTestSupport';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';

beforeAll(initCpWasm);

/** Minimal `t`: returns the inline English default, interpolating `{{name}}`. */
const t = ((_key: string, fallback: string, options?: Record<string, unknown>) =>
  options
    ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options[name] ?? ''))
    : fallback) as never;

describe('summariseDirectionHints', () => {
  it('reports a shared direction', () => {
    const summary = summariseDirectionHints(['Mountain', 'Mountain'], 0);
    expect(summary).toMatchObject({ hint: 'Mountain', unassignedCount: 2, mixed: false });
    expect(isDirectionHintActive(summary, 'Mountain')).toBe(true);
    expect(isDirectionHintActive(summary, 'Valley')).toBe(false);
    expect(isDirectionHintActive(summary, 'Clear')).toBe(false);
  });

  /**
   * The distinction the `mixed` flag exists for. Both of these have no shared
   * direction; only one of them means "cleared".
   */
  it('separates all-unhinted from disagreeing', () => {
    const cleared = summariseDirectionHints([null, null], 0);
    expect(cleared).toMatchObject({ hint: null, mixed: false });
    expect(isDirectionHintActive(cleared, 'Clear')).toBe(true);

    const disagreeing = summariseDirectionHints(['Mountain', 'Valley'], 0);
    expect(disagreeing).toMatchObject({ hint: null, mixed: true });
    expect(isDirectionHintActive(disagreeing, 'Clear')).toBe(false);
    expect(isDirectionHintActive(disagreeing, 'Mountain')).toBe(false);

    // A hinted crease beside an unhinted one is also a disagreement.
    expect(summariseDirectionHints(['Mountain', null], 0).mixed).toBe(true);
  });

  it('presses nothing on an empty selection', () => {
    const summary = summariseDirectionHints([], 3);
    expect(summary).toMatchObject({ hint: null, unassignedCount: 0, otherCount: 3, mixed: false });
    for (const change of ['Mountain', 'Valley', 'Clear'] as const) {
      expect(isDirectionHintActive(summary, change)).toBe(false);
    }
  });

  it('says how many of the selected lines a hint would actually reach', () => {
    expect(describeDirectionHintAffected(t, summariseDirectionHints(['Mountain'], 0))).toBe(
      '1 undecided crease'
    );
    expect(describeDirectionHintAffected(t, summariseDirectionHints([null, null], 0))).toBe(
      '2 undecided creases'
    );
    // The case that matters: decided creases in the selection are skipped, and
    // the readout must say so rather than implying all seven were hinted.
    expect(
      describeDirectionHintAffected(t, summariseDirectionHints(['Mountain', null], 5))
    ).toBe('2 of 7 selected lines');
  });

  it('offers mountain, valley and clear, in that order', () => {
    expect(directionHintOptions(t).map((option) => option.change)).toEqual([
      'Mountain',
      'Valley',
      'Clear',
    ]);
  });
});

describe('CreaseSetDirectionHint against the real kernel', () => {
  function documentWith(segments: OristudioCpLineSegment[]): number {
    const seed = load_cp('', 'seed');
    const empty = document_snapshot(seed) as OristudioCpDocumentSnapshot;
    free_document(seed);
    return load_document({
      ...empty,
      crease_pattern: { ...empty.crease_pattern, line_segments: segments },
    });
  }

  function segment(color: string, x: number): OristudioCpLineSegment {
    return {
      a: { x, y: 0 },
      b: { x, y: 10 },
      color,
      active: 'Inactive0',
      selected: 0,
      customized: 0,
      customized_color: { red: 0, green: 0, blue: 0 },
    };
  }

  function hintsOf(handle: number): (string | undefined)[] {
    const snapshot = document_snapshot(handle) as OristudioCpDocumentSnapshot;
    return snapshot.crease_pattern.line_segments.map((s) => s.fold_direction_hint);
  }

  /**
   * The gap this verb was added to close: `CreaseMakeUnassigned` reads the
   * direction off the colour it is leaving, so an already-unassigned crease is
   * exactly what it cannot touch.
   */
  it('hints a crease that was already unassigned, which unassigning cannot', () => {
    const handle = documentWith([segment('None', 0)]);

    execute_cp_command(handle, 'CreaseMakeUnassigned', { line_ids: [1] });
    expect(hintsOf(handle)).toEqual([undefined]);

    execute_cp_command(handle, 'CreaseSetDirectionHint', {
      line_ids: [1],
      direction_hint: 'Mountain',
    });
    expect(hintsOf(handle)).toEqual(['Mountain']);

    free_document(handle);
  });

  it('changes and clears a hint', () => {
    const handle = documentWith([segment('None', 0)]);
    const send = (direction_hint: string) =>
      execute_cp_command(handle, 'CreaseSetDirectionHint', {
        line_ids: [1],
        direction_hint,
      });

    send('Valley');
    expect(hintsOf(handle)).toEqual(['Valley']);
    send('Mountain');
    expect(hintsOf(handle)).toEqual(['Mountain']);
    send('Clear');
    expect(hintsOf(handle)).toEqual([undefined]);

    free_document(handle);
  });

  /**
   * Firing on a mixed selection must be safe, because that is what the control
   * does — it sends every selected line and lets the kernel's gate pick.
   */
  it('leaves decided creases, borders and auxiliary lines untouched', () => {
    const handle = documentWith([
      segment('Red1', 0),
      segment('Blue2', 1),
      segment('Black0', 2),
      segment('None', 3),
    ]);

    execute_cp_command(handle, 'CreaseSetDirectionHint', {
      line_ids: [1, 2, 3, 4],
      direction_hint: 'Valley',
    });

    expect(hintsOf(handle)).toEqual([undefined, undefined, undefined, 'Valley']);
    const colors = (
      document_snapshot(handle) as OristudioCpDocumentSnapshot
    ).crease_pattern.line_segments.map((s) => s.color);
    expect(colors).toEqual(['Red1', 'Blue2', 'Black0', 'None']);

    free_document(handle);
  });
});
