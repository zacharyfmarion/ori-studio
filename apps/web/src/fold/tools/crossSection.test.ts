import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import type { FoldCrossSection, FoldCrossSectionRow } from '../engine/foldEngineWire';
import {
  flapNumbers,
  foldFlapChips,
  foldLayersSummary,
  foldSectionPicker,
  isWoven,
  topFlapOf,
  wovenIntervalAt,
  type FoldSeedView,
} from './crossSection';

const t = i18n.t.bind(i18n);

const row = (faces: number[], spans: [number, number][], flap: number): FoldCrossSectionRow => ({ faces, spans, flap });

/** The fields of the bridge's section these tests do not read. */
const along = {
  line: { n: [0, 1] as const, d: 0.5 },
  side: 'positive' as const,
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
};

/**
 * A square folded in half, then in half again: four layers at the second
 * line, in two flaps the engine numbers by face id — so its flap 1 is the
 * bottom pair and flap 0 the top pair — each pair joined by its bend.
 */
const twice: FoldCrossSection = {
  ...along,
  flaps: [
    { faces: [2, 3], witness: [0.2, 0.7] },
    { faces: [0, 1], witness: [0.2, 0.2] },
  ],
  rows: [row([3], [[0, 1]], 0), row([2], [[0, 1]], 0), row([1], [[0, 1]], 1), row([0], [[0, 1]], 1)],
  intervals: [{ start: 0, end: 1, faces: [3, 2, 1, 0], rows: [0, 1, 2, 3] }],
  order: { kind: 'layered', unordered: [] },
  layers: 4,
  joins: [
    { upper: 0, lower: 1, at: 1 },
    { upper: 2, lower: 3, at: 0 },
  ],
};

const seed = (picked: number[], added: number[] = [], needed: number[] = []): FoldSeedView => ({
  picked: new Set(picked),
  added: new Set(added),
  needed: new Set(needed),
});

describe('flapNumbers', () => {
  it('numbers the flaps top to bottom by their first row, not by the engine’s face-id order', () => {
    const [a, b, c, d] = twice.rows;
    const reordered: FoldCrossSection = { ...twice, rows: [c!, d!, a!, b!] };
    expect(flapNumbers(twice, 2)).toEqual([1, 2]);
    expect(flapNumbers(reordered, 2)).toEqual([2, 1]);
  });

  it('keeps the engine’s order for flaps with no row, after the rest, and without a section', () => {
    expect(flapNumbers({ ...twice, rows: [twice.rows[2]!] }, 3)).toEqual([2, 1, 3]);
    expect(flapNumbers(null, 3)).toEqual([1, 2, 3]);
  });
});

describe('topFlapOf', () => {
  it('is the flap of the top row as the front shows it — Flap 1 — not the engine’s first flap', () => {
    const [a, b, c, d] = twice.rows;
    expect(topFlapOf(twice)).toBe(0);
    expect(topFlapOf({ ...twice, rows: [c!, d!, a!, b!] })).toBe(1);
    expect(flapNumbers({ ...twice, rows: [c!, d!, a!, b!] }, 2)[1]).toBe(1);
  });

  it('is the top of the first interval’s stack for a woven section, the stack the picker shows first; none with no rows', () => {
    const woven: FoldCrossSection = {
      ...twice,
      order: { kind: 'woven' },
      intervals: [
        { start: 0, end: 0.5, faces: [1, 3], rows: [2, 0] },
        { start: 0.5, end: 1, faces: [3, 1], rows: [0, 2] },
      ],
    };
    expect(topFlapOf(woven)).toBe(1);
    expect(topFlapOf({ ...twice, rows: [], intervals: [] })).toBeNull();
    expect(topFlapOf({ ...woven, intervals: [] })).toBeNull();
  });
});

describe('foldSectionPicker', () => {
  it('names each row by its place and its flap, and says how it reads against the seed', () => {
    const picker = foldSectionPicker(t, twice, seed([0], [1]));
    expect(picker.label).toBe('Layers at the fold line, top to bottom');
    expect(picker.multiple).toBe(true);
    expect(picker.rows.map((r) => [r.label, r.state, r.tag])).toEqual([
      ['Layer 1, Flap 1', 'picked', 'Flap 1'],
      ['Layer 2, Flap 1', 'picked', null],
      ['Layer 3, Flap 2, moves with the fold', 'added', 'Flap 2'],
      ['Layer 4, Flap 2, moves with the fold', 'added', null],
    ]);
    expect(foldSectionPicker(t, twice, seed([1])).rows.map((r) => r.state)).toEqual([
      'excluded',
      'excluded',
      'picked',
      'picked',
    ]);
  });

  it('is one row for one physical layer a precrease crosses: the display layer, not its faces', () => {
    // A diagonal precrease, then the half across it: the moving layer is two
    // faces joined across the flat crease, cut where the crease crosses the
    // line, and one row.
    const precreased: FoldCrossSection = {
      ...along,
      flaps: [{ faces: [1, 2], witness: [0.8, 0.8] }],
      rows: [row([1, 2], [[0, 1]], 0)],
      intervals: [
        { start: 0, end: 0.5, faces: [1], rows: [0] },
        { start: 0.5, end: 1, faces: [2], rows: [0] },
      ],
      order: { kind: 'layered', unordered: [] },
      layers: 1,
      joins: [],
    };
    const picker = foldSectionPicker(t, precreased, seed([0]));
    expect(picker.rows.map((r) => [r.label, r.from, r.to])).toEqual([['Layer 1, Flap 1', 0, 1]]);
    expect(foldLayersSummary(t, picker)).toBe('1 of 1 layer moving');
  });

  it('marks a row the stacks do not order against the one above, and places each bar along the line', () => {
    const beside: FoldCrossSection = {
      ...along,
      flaps: [
        { faces: [0], witness: [0.1, 0.1] },
        { faces: [1], witness: [0.9, 0.1] },
      ],
      rows: [row([0], [[0, 0.4]], 0), row([1], [[0.6, 1]], 1)],
      intervals: [
        { start: 0, end: 0.4, faces: [0], rows: [0] },
        { start: 0.6, end: 1, faces: [1], rows: [1] },
      ],
      order: { kind: 'layered', unordered: [[0, 1]] },
      layers: 1,
      joins: [],
    };
    const rows = foldSectionPicker(t, beside, seed([0, 1])).rows;
    expect(rows.map((r) => r.unordered)).toEqual([false, true]);
    expect(rows[1]?.label).toBe('Layer 2, Flap 2, beside layer 1');
    expect(rows.map((r) => [r.from, r.to])).toEqual([
      [0, 0.4],
      [0.6, 1],
    ]);
    // A pair the stacks leave free that is not this row and the one above it
    // says nothing of this row's place.
    const apart = foldSectionPicker(t, { ...beside, order: { kind: 'layered', unordered: [[0, 2]] } }, seed([0]));
    expect(apart.rows.map((r) => r.unordered)).toEqual([false, false]);
  });

  it('draws a bracket where a bend joins two rows, bulging past the side of the line it is on', () => {
    expect(foldSectionPicker(t, twice, seed([0, 1])).brackets).toEqual([
      { upper: 0, lower: 1, at: 1, side: 'end' },
      { upper: 2, lower: 3, at: 0, side: 'start' },
    ]);
  });

  it('shows one interval’s stack for a woven section, across the interval, with no brackets', () => {
    const woven: FoldCrossSection = {
      ...twice,
      order: { kind: 'woven' },
      intervals: [
        { start: 0, end: 0.5, faces: [3, 1], rows: [0, 2] },
        { start: 0.5, end: 1, faces: [1, 3], rows: [2, 0] },
      ],
    };
    expect(isWoven(woven)).toBe(true);
    const first = foldSectionPicker(t, woven, seed([0, 1]));
    expect(first.woven).toBe(true);
    expect(first.label).toBe('Layers at the fold line under the pointer, top to bottom');
    expect(first.brackets).toEqual([]);
    expect(first.rows.map((r) => [r.label, r.from, r.to])).toEqual([
      ['Layer 1, Flap 1', 0, 1],
      ['Layer 2, Flap 2', 0, 1],
    ]);
    const second = foldSectionPicker(t, woven, seed([0, 1]), { interval: 1 });
    expect(second.rows.map((r) => r.flap)).toEqual([1, 0]);
  });

  it('finds the interval of a woven section under a point of the folded pane, square onto the line', () => {
    const woven: FoldCrossSection = {
      ...twice,
      from: { x: 1, y: 0.5 },
      to: { x: 0, y: 0.5 },
      order: { kind: 'woven' },
      intervals: [
        { start: 0, end: 0.4, faces: [3, 1], rows: [0, 2] },
        { start: 0.4, end: 1, faces: [1, 3], rows: [2, 0] },
      ],
    };
    // Measured from the section's start, which here is the right end.
    expect(wovenIntervalAt(woven, { x: 0.9, y: 0.5 })).toBe(0);
    expect(wovenIntervalAt(woven, { x: 0.3, y: 0.1 })).toBe(1);
    expect(wovenIntervalAt(woven, { x: 1.4, y: 0.5 })).toBeNull();
    // A layered section shows every interval at once: there is none to pick.
    expect(wovenIntervalAt(twice, { x: 0.5, y: 0.5 })).toBeNull();
    expect(wovenIntervalAt(null, { x: 0.5, y: 0.5 })).toBeNull();
  });

  it('marks the rows of a flap a refusal says is in the way', () => {
    const rows = foldSectionPicker(t, twice, seed([1], [], [0])).rows;
    expect(rows.map((r) => r.needed)).toEqual([true, true, false, false]);
  });
});

describe('foldFlapChips', () => {
  it('is a chip per flap in their numbered order, pressed while picked, with its rows at the line', () => {
    const chips = foldFlapChips(t, twice, seed([1], [0], [0]));
    expect(chips.map((chip) => [chip.flap, chip.name, chip.detail, chip.pressed, chip.added, chip.needed])).toEqual([
      [0, 'Flap 1', '2 layers', false, true, true],
      [1, 'Flap 2', '2 layers', true, false, false],
    ]);
    expect(chips.map((chip) => chip.label)).toEqual(['Flap 1, 2 layers, moves with the fold', 'Flap 2, 2 layers']);
  });
});

describe('foldLayersSummary', () => {
  it('counts display layers on the moving side, and those whose flap moves', () => {
    expect(foldLayersSummary(t, foldSectionPicker(t, twice, seed([0, 1])))).toBe('4 of 4 layers moving');
    expect(foldLayersSummary(t, foldSectionPicker(t, twice, seed([1])))).toBe('2 of 4 layers moving');
    expect(foldLayersSummary(t, foldSectionPicker(t, twice, seed([1], [0])))).toBe('4 of 4 layers moving');
  });
});
