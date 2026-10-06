import { describe, expect, it } from 'vitest';
import { face, SQUARE } from '../../lib/paper/paperScene.fixtures';
import { createDiagram, insertSteps, type DiagramAsset, type DiagramStep } from '../document/diagramDocument';
import { sceneStep, uploadStep } from '../annotate/pictureSnap.fixtures';
import type { LayoutCell } from './diagramPageLayout';
import type { PreparedDiagramPages } from './diagramPages';
import { printedFrames } from './printedFrames';

type Cell = Pick<LayoutCell, 'stepId' | 'mmPerUnit' | 'frameMm'> & Partial<Pick<LayoutCell, 'pictureMm' | 'drawMm'>>;

/** Pages laid out with these cells, as far as the printed frames read them. */
const laidOut = (cells: Cell[]) => ({ layout: { pages: [{ cells }] } }) as unknown as PreparedDiagramPages;

/** A cell's square box, `size` mm, and the room drawn for its picture, `w` × `h` mm. */
const room = (size: number, w: number, h: number) => ({
  pictureMm: { x: 0, y: 0, size },
  drawMm: { x: 0, y: 0, w, h },
});

describe('printedFrames (Revision 2)', () => {
  // A crease pattern a hundred pattern units across, at a paper scale of one; an upload, only ever fitted.
  const pattern = { ...sceneStep([face([SQUARE])]), id: 'pattern' };
  const upload = { ...uploadStep(), step: { ...uploadStep().step, id: 'upload' } };
  // An upload twice as wide as it is tall.
  const wideAsset: DiagramAsset = {
    id: 'asset-wide',
    kind: 'svg',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"/>',
    widthPx: 200,
    heightPx: 100,
    bytes: 70,
  };
  const wide: DiagramStep = {
    ...upload.step,
    id: 'wide',
    source: { kind: 'upload', assetId: wideAsset.id, rotationQuarterTurns: 0, mirrored: false },
    picture: { kind: 'asset', assetId: wideAsset.id, paperScale: null, key: wideAsset.id },
  };
  const document = {
    ...insertSteps(createDiagram(), [pattern, upload.step, wide], 0),
    assets: { ...upload.assets, [wideAsset.id]: wideAsset },
  };

  it('reads each step’s frame at the size it prints: its pattern units at the page’s mm per unit, or the size its run fits it to', () => {
    const frames = printedFrames(
      laidOut([
        { stepId: 'pattern', mmPerUnit: 0.4, frameMm: null, ...room(50, 60, 50) },
        { stepId: 'upload', mmPerUnit: null, frameMm: 38, ...room(50, 60, 50) },
      ]),
      document
    );
    expect(Object.fromEntries(frames)).toEqual({ pattern: 40, upload: 38 });
  });

  it('reads a picture the layout found no scale for — an upload under the Paper scale — at the size the page fits it to its room', () => {
    const frames = printedFrames(
      laidOut([
        // A square upload in a room 45 mm across and 40 down: 40 mm, as tall as the room.
        { stepId: 'upload', mmPerUnit: null, frameMm: null, ...room(40, 45, 40) },
        // Twice as wide as it is tall, in the same room: 45 mm, as wide as the room.
        { stepId: 'wide', mmPerUnit: null, frameMm: null, ...room(40, 45, 40) },
        // Given a page's mm per unit it has no paper for: fitted all the same.
        { stepId: 'pattern', mmPerUnit: null, frameMm: null, pictureMm: { x: 0, y: 0, size: 30 } },
      ]),
      document
    );
    expect(Object.fromEntries(frames)).toEqual({ upload: 40, wide: 45, pattern: 30 });
    const scaledWithout = printedFrames(laidOut([{ stepId: 'upload', mmPerUnit: 0.4, frameMm: null, ...room(40, 45, 40) }]), document);
    expect(scaledWithout.get('upload')).toBe(40);
  });

  it('knows none before the pages are laid out, nor for a step that is gone', () => {
    expect(printedFrames(null, document).size).toBe(0);
    expect(printedFrames(laidOut([{ stepId: 'gone', mmPerUnit: null, frameMm: 30 }]), document).size).toBe(0);
  });
});
