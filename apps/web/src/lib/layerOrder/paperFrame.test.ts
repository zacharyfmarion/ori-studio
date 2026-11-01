import { describe, expect, it } from 'vitest';
import type { LayerOrderRecord } from './layerOrderRecord';
import {
  EDIT_PAPER_FRAME,
  layerOrderRecordFromSource,
  layerOrderRecordToSource,
  paperFrameAbout,
} from './paperFrame';

const RECORD: LayerOrderRecord = {
  faces: [
    { at: [1, 2], area: 0.5 },
    { at: [-4, 0.25], area: 3 },
  ],
  constraints: [[0, 1, 1]],
  order: [[1, 0, -1]],
  attention: { reason: 'detached', count: 1 },
};

describe('paper frames', () => {
  it('keeps an Edit figure’s points where its creases are', () => {
    expect(EDIT_PAPER_FRAME.toSource([3, -7])).toEqual({ x: 3, y: -7 });
    expect(EDIT_PAPER_FRAME.fromSource({ x: 3, y: -7 })).toEqual([3, -7]);
    expect(layerOrderRecordToSource(RECORD, EDIT_PAPER_FRAME)).toEqual(RECORD);
  });

  it('keeps a Diagram step’s points about its paper’s centre, so they move with its region', () => {
    const before = paperFrameAbout({ x: 10, y: 20 });
    const after = paperFrameAbout({ x: 110, y: -30 });
    const saved = layerOrderRecordFromSource(layerOrderRecordToSource(RECORD, before), before);
    expect(saved).toEqual(RECORD);
    // The region moved: the same saved points land on the same paper, moved with it.
    expect(layerOrderRecordToSource(RECORD, after).faces.map((face) => face.at)).toEqual([
      [111, -28],
      [106, -29.75],
    ]);
  });

  it('moves only the points: the areas, pairs and attention are the frame’s to keep', () => {
    const moved = layerOrderRecordToSource(RECORD, paperFrameAbout({ x: 5, y: 5 }));
    expect(moved.faces.map((face) => face.area)).toEqual([0.5, 3]);
    expect(moved.constraints).toBe(RECORD.constraints);
    expect(moved.order).toBe(RECORD.order);
    expect(moved.attention).toBe(RECORD.attention);
  });
});
