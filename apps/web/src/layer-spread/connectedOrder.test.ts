import { expect, it } from 'vitest';
import { visibility, type Point3 } from '@oristudio/layer-spread';
import { connectedPaperScene, type ConnectedDrawing } from './connectedScene';
import { readPaperScene } from '../lib/paper/paperSceneValidate';

it('uses global order in settled capture without synthesizing hidden-mask contours or changing material anchors', () => {
  const drawing: ConnectedDrawing = {
    mesh: {
      positions: [[0,2],[1,2],[0,2]].flatMap(([lo,hi],f) =>
        [[lo,0,3-f],[hi,0,3-f],[hi,1,3-f],[lo,1,3-f]] as Point3[]),
      triangles: [[0,1,2],[0,2,3],[4,5,6],[4,6,7],[8,9,10],[8,10,11]],
      triangleFaces: [0,0,1,1,2,2],
      visibility: visibility(3, [[0,1],[1,2]]),
    },
    rings: [[0,1,2,3],[4,5,6,7],[8,9,10,11]],
    front: [true,false,true],
    ink: [],
  };
  const live = connectedPaperScene(drawing, 2);
  const settled = connectedPaperScene(drawing, 2, true);
  expect(live.items.filter(i => i.kind === 'line')).toEqual([]);
  expect(settled.items.filter(i => i.kind === 'line')).toEqual([]);
  expect([...new Set(settled.items.flatMap(i => i.kind === 'face' && !i.hidden ? [i.face] : []))]).toEqual([2]);
  expect(settled.items.slice(0,3)).toEqual(live.items.slice(0,3));
  expect(readPaperScene(JSON.parse(JSON.stringify(settled)))).not.toBeNull();
});
