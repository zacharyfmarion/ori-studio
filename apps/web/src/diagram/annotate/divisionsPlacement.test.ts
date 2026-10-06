import { describe, expect, it } from 'vitest';
import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import { mmInPictureUnits } from './canvasInk';
import { divisionsSignedOffset, draggedDivisions } from './divisionsPlacement';

describe('equal divisions dragged (Revision 2, ED2)', () => {
  // Along a level line running right, their line 2.5 mm below it: to the right of its way.
  const below: KnownDiagramAnnotation = { id: 'd', kind: 'divisions', from: [0.2, 0.5], to: [0.6, 0.5], parts: 4, offset: 2.5 };
  const mm = mmInPictureUnits(1);

  it('stand signed: positive to the right of their line’s way, negative to its left', () => {
    expect(divisionsSignedOffset(below)).toBe(2.5);
    expect(divisionsSignedOffset({ ...below, mirrored: true })).toBe(-2.5);
  });

  it('slide square to their line by as far as the pointer went that way, along it counting for nothing', () => {
    const start: [number, number] = [0.3, 0.5 + 2.5 * mm];
    expect(draggedDivisions(below, start, [0.5, 0.5 + 4 * mm])).toEqual({ ...below, offset: 4 });
    expect(draggedDivisions(below, start, [0.3, 0.5 + 1.04 * mm])).toEqual({ ...below, offset: 1 });
    // Never moved whole: the line they measure stays.
    expect(draggedDivisions(below, start, [0.9, 0.9]).from).toEqual(below.from);
  });

  it('go over to the other side when dragged across their line, and hold the side they had where they end on it', () => {
    const start: [number, number] = [0.3, 0.5 + 2.5 * mm];
    expect(draggedDivisions(below, start, [0.3, 0.5 - 3 * mm])).toEqual({ ...below, offset: 3, mirrored: true });
    expect(draggedDivisions(below, start, [0.3, 0.5])).toEqual({ ...below, offset: 0 });
    expect(draggedDivisions({ ...below, mirrored: true }, [0.3, 0.5 - 2.5 * mm], [0.3, 0.5])).toEqual({
      ...below,
      offset: 0,
      mirrored: true,
    });
  });

  it('keep to a tenth of a millimetre, or with Shift a half, and to the furthest a line may stand', () => {
    const start: [number, number] = [0.3, 0.5 + 2.5 * mm];
    expect(draggedDivisions(below, start, [0.3, 0.5 + 3.37 * mm]).offset).toBe(3.4);
    expect(draggedDivisions(below, start, [0.3, 0.5 + 3.37 * mm], { halves: true }).offset).toBe(3.5);
    expect(draggedDivisions(below, start, [0.3, 0.5 + 40 * mm]).offset).toBe(15);
    // A line whose ends meet has no way to be square to: left as it is.
    const point = { ...below, to: below.from };
    expect(draggedDivisions(point, start, [0.3, 0.9])).toBe(point);
  });
});
