// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SOLID_DASH_SLOT } from '../../lib/oristudioCpLineStyle';
import { cpPatternStrokes } from './cpPatternStrokes';
import type { CpLineSegmentInput } from './cpSnapshotToScene';

/** A square sheet with a valley across it and an auxiliary line: Edit's document lines, in painter's order. */
const PATTERN: CpLineSegmentInput[] = [
  { a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, color: 'Cyan3' },
  { a: { x: 0.5, y: 0 }, b: { x: 0.5, y: 1 }, color: 'Blue2' },
  { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, color: 'Black0' },
  { a: { x: 1, y: 0 }, b: { x: 1, y: 1 }, color: 'Black0' },
  { a: { x: 1, y: 1 }, b: { x: 0, y: 1 }, color: 'Black0' },
  { a: { x: 0, y: 1 }, b: { x: 0, y: 0 }, color: 'Black0' },
];

let themed: HTMLDivElement;

beforeEach(() => {
  themed = document.createElement('div');
  themed.style.setProperty('--fold-border', '#111417');
  themed.style.setProperty('--fold-mountain', '#ff4d5d');
  themed.style.setProperty('--fold-valley', '#60a5fa');
  themed.style.setProperty('--fold-unassigned', '#9aa4ad');
  themed.style.setProperty('--fold-flat', '#64c8c8');
  document.body.append(themed);
});

afterEach(() => themed.remove());

const rgb = (color: Float32Array, at: number) =>
  [0, 1, 2].map((k) => Math.round((color[at * 4 + k] ?? 0) * 255).toString(16).padStart(2, '0')).join('');

describe('a crease pattern drawn as Edit draws one', () => {
  it('inks each line by the line style it is given, and carries the line width it is given', () => {
    const colour = cpPatternStrokes(PATTERN, themed, { lineStyle: 'color', lineWidth: 1.5 });
    expect(colour.lineWidth).toBe(1.5);
    expect(colour.creases.count).toBe(PATTERN.length);
    // The auxiliary line in Edit's aux ink, solid; the valley in its own; the border in Edit's ink.
    expect(rgb(colour.creases.color, 0)).toBe('64c8c8');
    expect(colour.creases.dashSlot?.[0]).toBe(SOLID_DASH_SLOT);
    expect(rgb(colour.creases.color, 1)).toBe('60a5fa');
    expect(rgb(colour.creases.color, 2)).toBe('111417');
    // Every crease at 1×: the width is the frame's, over the line width.
    expect([...colour.creases.widthMul]).toEqual(Array(PATTERN.length).fill(1));
    expect(colour.instruction).toBeNull();

    // Monochrome: the valley in the border's ink, dashed.
    const mono = cpPatternStrokes(PATTERN, themed, { lineStyle: 'black-one-dot', lineWidth: 2 });
    expect(mono.lineWidth).toBe(2);
    expect(rgb(mono.creases.color, 1)).toBe('111417');
    expect(mono.creases.dashSlot?.[1]).not.toBe(SOLID_DASH_SLOT);
  });

  it('draws an instruction over the pattern as a tool’s line: each group in its crease colour, solid, in order, wider', () => {
    const strokes = cpPatternStrokes(
      PATTERN,
      themed,
      { lineStyle: 'black-one-dot', lineWidth: 1 },
      {
        groups: [
          { color: 'Blue2', segments: [{ a: { x: 0.25, y: 0 }, b: { x: 0.25, y: 1 } }] },
          // An empty group draws nothing and takes no colour.
          { color: 'Cyan3', segments: [] },
          {
            color: 'Red1',
            segments: [
              { a: { x: 0, y: 0.5 }, b: { x: 1, y: 0.5 } },
              { a: { x: 0, y: 0.25 }, b: { x: 1, y: 0.25 } },
            ],
          },
        ],
        widthMul: 3,
      }
    );
    const instruction = strokes.instruction!;
    expect(instruction.count).toBe(3);
    // In the crease colours whatever the line style says of the pattern, valley then mountain.
    expect([0, 1, 2].map((at) => rgb(instruction.color, at))).toEqual(['60a5fa', 'ff4d5d', 'ff4d5d']);
    expect([...(instruction.dashSlot ?? [])]).toEqual([0, 0, 0]);
    expect([...instruction.widthMul]).toEqual([3, 3, 3]);
    expect([...instruction.a.slice(0, 2)]).toEqual([0.25, 0]);
  });

  it('draws no instruction for groups with no lines', () => {
    const strokes = cpPatternStrokes(
      PATTERN,
      themed,
      { lineStyle: 'color', lineWidth: 1 },
      { groups: [{ color: 'Red1', segments: [] }], widthMul: 2 }
    );
    expect(strokes.instruction).toBeNull();
  });
});
