import { describe, expect, it } from 'vitest';
import { pictureGeometry } from '../annotate/pictureGeometry';
import { createDiagram, insertSteps, type DiagramStep } from '../document/diagramDocument';
import { stepPictureFrame } from '../pictures/pictureFrame';
import { craneStep } from './zoom.fixtures';
import { stepView, viewFrame, viewGeometry, viewOfStep } from './stepView';
import { fromBox, intoBox } from './zoomFrames';
import { frameWindow } from './zoomModel';

const NO_ASSETS = {};

const whole = craneStep('S.none');
const enlarged: DiagramStep = {
  ...whole,
  id: 'step-enlarged',
  zoom: { from: 'area-1', shape: 'rounded', frame: { centre: [0.35, 0.85], size: [0.3, 0.2], angle: 30 } },
};

describe('what a step shows', () => {
  it('is its whole picture when it is not enlarged, its frame the picture’s', () => {
    const view = viewOfStep(whole);
    expect(view).toMatchObject({ window: null, zoom: null });
    expect(viewFrame(view, NO_ASSETS)).toEqual(stepPictureFrame(whole, NO_ASSETS));
    expect(viewGeometry(view, NO_ASSETS)).toBe(pictureGeometry(whole, NO_ASSETS));
  });

  it('is its frame’s window when it is enlarged: the window is the frame its marks are drawn on', () => {
    const document = insertSteps(createDiagram({ title: 'View' }), [enlarged], 0);
    const view = stepView(document, 'step-enlarged')!;
    const window = frameWindow(enlarged.zoom!.frame!);
    expect(view.window).toEqual(window);
    expect(view.zoom).toMatchObject({ frame: enlarged.zoom!.frame, window });
    const frame = viewFrame(view, NO_ASSETS)!;
    expect(Math.max(frame.width, frame.height)).toBe(1);
    expect(frame.width / frame.height).toBeCloseTo(window.width / window.height, 12);
    // A seeded step, with no frame yet, shows its picture whole.
    expect(viewOfStep({ ...enlarged, zoom: { from: 'area-1', shape: 'circle' } }).window).toBeNull();
    expect(stepView(document, 'nowhere')).toBeNull();
  });

  it('reads the picture’s geometry in the window’s units, and only what lies near the window', () => {
    const view = viewOfStep(enlarged);
    const geometry = viewGeometry(view, NO_ASSETS, undefined, 0.1);
    const all = pictureGeometry(enlarged, NO_ASSETS);
    expect(geometry.points.length).toBeGreaterThan(0);
    expect(geometry.points.length).toBeLessThan(all.points.length);
    const frame = viewFrame(view, NO_ASSETS)!;
    for (const { at } of geometry.points) {
      expect(at[0]).toBeGreaterThanOrEqual(-0.1);
      expect(at[0]).toBeLessThanOrEqual(frame.width + 0.1);
      expect(at[1]).toBeGreaterThanOrEqual(-0.1);
      expect(at[1]).toBeLessThanOrEqual(frame.height + 0.1);
    }
    // Every point of the picture near the window is there, where the window puts it.
    const near = all.points
      .map(({ at }) => intoBox(view.window!, at))
      .filter(([x, y]) => x >= -0.1 && x <= frame.width + 0.1 && y >= -0.1 && y <= frame.height + 0.1);
    expect(geometry.points.map(({ at }) => at)).toEqual(near);
    // Back in picture units, a point is the picture's own.
    const [first] = geometry.points;
    expect(all.points.some(({ at }) => Math.hypot(at[0] - fromBox(view.window!, first!.at)[0], at[1] - fromBox(view.window!, first!.at)[1]) < 1e-12)).toBe(true);
    // Its layers come with it, renumbered: each segment's paint order is its own.
    expect(geometry.layers?.orders).toHaveLength(geometry.segments.length);
    expect(geometry.segmentIndex.segmentsNear(geometry.segments[0]!.a.x, geometry.segments[0]!.a.y, 1e-9).length).toBeGreaterThan(0);
    // Worked out once per picture and window.
    expect(viewGeometry(view, NO_ASSETS, undefined, 0.1)).toBe(geometry);
  });

  it('keeps only the last window it read a picture through, so a frame dragged across it holds no trail of copies', () => {
    const at = (x: number): DiagramStep => ({ ...enlarged, zoom: { ...enlarged.zoom!, frame: { ...enlarged.zoom!.frame!, centre: [x, 0.85] } } });
    const first = viewGeometry(viewOfStep(at(0.35)), NO_ASSETS);
    // A drag: a new window at every move, over the one picture.
    for (let step = 1; step <= 50; step += 1) viewGeometry(viewOfStep(at(0.35 + step * 0.002)), NO_ASSETS);
    const last = viewOfStep(at(0.45));
    expect(viewGeometry(last, NO_ASSETS)).toBe(viewGeometry(last, NO_ASSETS));
    // The first window was let go: read again, it is worked out again, the same.
    const again = viewGeometry(viewOfStep(at(0.35)), NO_ASSETS);
    expect(again).not.toBe(first);
    expect(again.points).toEqual(first.points);
  });
});
