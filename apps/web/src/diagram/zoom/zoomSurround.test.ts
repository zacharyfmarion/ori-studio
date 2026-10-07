import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE, type DiagramStep } from '../document/diagramDocument';
import { CARD_FRAME_PX } from '../annotate/canvasInk';
import { paintedFrameLongerPx } from '../pictures/pictureFrame';
import { zoomSurroundUrl } from '../pictures/useStepPictureUrl';
import { paintZoomSurround, zoomedSource, zoomSurroundRegion, ZOOM_SURROUND_MOST_CELLS, ZOOM_SURROUND_REACH } from './paintZoomed';
import { craneStep } from './zoom.fixtures';

const crane = craneStep('S.none');

/** The crane enlarged on a circle about `centre`. */
function enlarged(centre: [number, number], radius: number): DiagramStep {
  return { ...crane, id: 'step-enlarged', zoom: { from: 'area-1', shape: 'circle', frame: { centre, radius } } };
}

const zoomed = (centre: [number, number], radius: number) => zoomedSource(enlarged(centre, radius), {})!;

describe('the picture round a selected frame (16e)', () => {
  it('is cut to a region a few windows round the frame, never the whole model at the window’s scale', () => {
    const small = zoomed([0.3, 0.2], 0.015);
    const { scale, region } = zoomSurroundRegion(small)!;
    const window = small.view.window;
    // About the window's own scale: the window a card's 50 mm, within a quarter octave.
    const exact = CARD_FRAME_PX / Math.max(window.width, window.height) / paintedFrameLongerPx(small.source)!;
    expect(Math.abs(Math.log2(scale / exact))).toBeLessThanOrEqual(0.125 + 1e-9);
    // Round the window and some, but a few windows across — not the picture, some 33 windows wide.
    expect(region.x).toBeLessThanOrEqual(window.x - ZOOM_SURROUND_REACH * window.width * 0.8);
    expect(region.x + region.width).toBeGreaterThanOrEqual(window.x + window.width * (1 + ZOOM_SURROUND_REACH * 0.8));
    expect(region.width).toBeLessThan(10 * window.width);
    const painted = paintZoomSurround(small.source, DEFAULT_DIAGRAM_STYLE, scale, region)!;
    expect(Math.max(painted.widthPx, painted.heightPx)).toBeLessThan(10 * CARD_FRAME_PX);
    // Its frame — the whole picture's — where the picture would lie, so a surface lays it as the whole.
    expect(painted.frame.width).toBeGreaterThan(painted.widthPx);
  });

  it('takes in the anchor face it outlines, as far as a few cards, so the outline lies on the picture', () => {
    const frame = zoomed([0.3, 0.2], 0.05);
    const near = zoomSurroundRegion(frame)!;
    // The body's back layer, below the head: further than the window's reach.
    const anchor = { x: 0.35, y: 0.55, width: 0.2, height: 0.15 };
    const { scale, region } = zoomSurroundRegion(frame, anchor)!;
    expect(scale).toBe(near.scale);
    expect(region.x).toBeLessThanOrEqual(near.region.x);
    expect(region.y + region.height).toBeGreaterThanOrEqual(anchor.y + anchor.height);
    expect(region.x + region.width).toBeGreaterThanOrEqual(anchor.x + anchor.width);
    // Never more than the most cells across, however far the face lies.
    const cell = CARD_FRAME_PX / scale / paintedFrameLongerPx(frame.source)!;
    const far = zoomSurroundRegion(frame, { x: 3, y: 3, width: 0.5, height: 0.5 })!.region;
    expect(far.width / cell).toBeLessThanOrEqual(ZOOM_SURROUND_MOST_CELLS + 2);
    expect(far.height / cell).toBeLessThanOrEqual(ZOOM_SURROUND_MOST_CELLS + 2);
  });

  it('paints nothing new for a frame moved or resized a little', () => {
    const first = zoomSurroundRegion(zoomed([0.3, 0.2], 0.05))!;
    const moved = zoomSurroundRegion(zoomed([0.302, 0.201], 0.0505))!;
    expect(moved).toEqual(first);
    const url = zoomSurroundUrl(zoomed([0.3, 0.2], 0.05), DEFAULT_DIAGRAM_STYLE)!;
    expect(zoomSurroundUrl(zoomed([0.302, 0.201], 0.0505), DEFAULT_DIAGRAM_STYLE)!.url).toBe(url.url);
    // Far enough, another region.
    expect(zoomSurroundRegion(zoomed([0.6, 0.6], 0.05))!.region).not.toEqual(first.region);
  });
});
