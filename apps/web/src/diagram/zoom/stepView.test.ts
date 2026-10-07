import { describe, expect, it } from 'vitest';
import { pictureGeometry } from '../annotate/pictureGeometry';
import {
  createDiagram,
  insertSteps,
  type DiagramAnnotation,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { stepPictureFrame } from '../pictures/pictureFrame';
import { craneStep } from './zoom.fixtures';
import { marksInWindow, marksTouchingWindow, stepAsDrawn, stepView, viewFrame, viewGeometry, viewOfStep } from './stepView';
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

describe('the marks an enlarged step draws', () => {
  // A window twice as wide as it is tall: its marks' frame 1 × 0.5, grown by a window each way [-1, 2] × [-0.5, 1].
  const window = { x: 0.2, y: 0.4, width: 0.4, height: 0.2 };
  const line = (id: string, from: [number, number], to: [number, number]): KnownDiagramAnnotation => ({
    id,
    kind: 'valley-line',
    from,
    to,
  });
  const ids = (marks: readonly DiagramAnnotation[]) => marks.map(({ id }) => id);

  it('keeps a mark inside the window, one partly outside it, and one off it but within a window of it', () => {
    const marks = [
      line('inside', [0.2, 0.2], [0.8, 0.3]),
      line('across', [0.5, 0.25], [1.6, 0.25]),
      line('beside', [-0.9, 0.2], [-0.95, 0.3]),
      line('below', [0.5, 0.95], [0.6, 0.98]),
    ];
    expect(marksInWindow(window, marks)).toBe(marks);
  });

  it('drops a mark lying wholly beyond the window grown by a window each way, measured along each side', () => {
    const marks = [
      line('inside', [0.2, 0.2], [0.8, 0.3]),
      line('right', [2.1, 0.2], [2.8, 0.3]),
      line('left', [-1.5, 0.2], [-1.1, 0.3]),
      // Within a window's width across, but beyond its height down: the frame is half as tall.
      line('under', [0.5, 1.1], [0.6, 1.4]),
      line('over', [0.5, -0.6], [0.6, -0.9]),
    ];
    expect(ids(marksInWindow(window, marks))).toEqual(['inside']);
  });

  it('sizes the step by the marks touching its window: one off it, drawn or not, counts for neither its size nor its fit', () => {
    // Zach, 2026-10-07: a mark wholly outside the window is kept, and badged; one reaching out of it counts inside it.
    const marks = [
      line('inside', [0.2, 0.2], [0.8, 0.3]),
      line('across', [0.5, 0.25], [1.6, 0.25]),
      line('beside', [-0.9, 0.2], [-0.95, 0.3]),
      line('below', [0.5, 0.95], [0.6, 0.98]),
      line('right', [2.1, 0.2], [2.8, 0.3]),
    ];
    expect(ids(marksTouchingWindow(window, marks))).toEqual(['inside', 'across']);
    // Drawn: all but the one beyond a window of it.
    expect(ids(marksInWindow(window, marks))).toEqual(['inside', 'across', 'beside', 'below']);
    const touching = marks.slice(0, 2);
    expect(marksTouchingWindow(window, touching)).toBe(touching);
  });

  it('reaches a mark’s whole extent: a ring round its centre, a close-up’s two rings, an area’s outline, a path’s nodes', () => {
    const ring: KnownDiagramAnnotation = { id: 'ring', kind: 'circle', from: [2.2, 0.25], to: [2.2, 0.25], radius: 0.3 };
    // Its area far off, its inset ring reaching back over the window.
    const closeUp: KnownDiagramAnnotation = { id: 'close-up', kind: 'close-up', from: [3, 0.25], to: [2.3, 0.25], radius: 0.2, scale: 2 };
    const area: KnownDiagramAnnotation = { id: 'area', kind: 'zoom', from: [2.4, 0.25], to: [2.4, 0.25], size: [1, 0.2] };
    const path: KnownDiagramAnnotation = {
      id: 'path',
      kind: 'valley-arrow',
      from: [3, 0.2],
      to: [3.5, 0.2],
      path: [{ at: [3, 0.2] }, { at: [3.2, 0.2], in: [1.9, 0.2] }, { at: [3.5, 0.2] }],
    };
    const marks = [ring, closeUp, area, path];
    expect(marksInWindow(window, marks)).toBe(marks);
    // Each moved on by a window: none reaches it now.
    const away = marks.map((mark) => ({
      ...mark,
      from: [mark.from[0] + 1, mark.from[1]] as [number, number],
      to: [mark.to[0] + 1, mark.to[1]] as [number, number],
      ...(mark.path ? { path: mark.path.map((node) => ({ at: [node.at[0] + 1, node.at[1]] as [number, number], ...(node.in ? { in: [node.in[0] + 1, node.in[1]] as [number, number] } : {}) })) } : {}),
    }));
    expect(marksInWindow(window, away)).toEqual([]);
  });

  it('reaches hung text’s words where they hang, however far off its anchor is (17b)', () => {
    // Its anchor past a window right of the frame; its words hung 200 pt back left, inside it.
    const hung: KnownDiagramAnnotation = { id: 'hung', kind: 'label', from: [2.05, 0.25], to: [2.05, 0.25], text: 'P', sizePt: 9, offsetPt: [-200, 0] };
    expect(marksInWindow(window, [hung])).toEqual([hung]);
    expect(marksTouchingWindow(window, [hung])).toEqual([hung]);
    // Its words hung further right instead: off the window as its anchor is.
    expect(marksInWindow(window, [{ ...hung, offsetPt: [200, 0] }])).toEqual([]);
    // Plain text is where its anchor is, as before.
    const plain: KnownDiagramAnnotation = { id: 'plain', kind: 'label', from: [2.05, 0.25], to: [2.05, 0.25], text: 'P' };
    expect(marksInWindow(window, [plain])).toEqual([]);
  });

  it('keeps a mark this build cannot read, wherever it is', () => {

    const unknown: DiagramAnnotation = { id: 'newer', unknown: { id: 'newer', kind: 'sparkle', from: [9, 9] } };
    const marks = [unknown, line('right', [2.1, 0.2], [2.8, 0.3])];
    expect(ids(marksInWindow(window, marks))).toEqual(['newer']);
  });

  it('draws a step as it is when it keeps every mark, or is not enlarged; else without the marks far off its window', () => {
    const marks = [line('inside', [0.2, 0.2], [0.8, 0.3]), line('far', [5, 0.2], [5.5, 0.3])];
    const plain = { ...whole, annotations: marks };
    expect(stepAsDrawn(plain)).toBe(plain);
    const near = { ...enlarged, annotations: [marks[0]!] };
    expect(stepAsDrawn(near)).toBe(near);
    const drawn = stepAsDrawn({ ...enlarged, annotations: marks });
    expect(ids(drawn.annotations)).toEqual(['inside']);
    expect(drawn).toMatchObject({ id: enlarged.id, zoom: enlarged.zoom, picture: enlarged.picture });
  });
});
