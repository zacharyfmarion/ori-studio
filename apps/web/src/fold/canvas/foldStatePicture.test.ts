import { describe, expect, it } from 'vitest';
import type { Point } from '../../lib/geometry';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../../lib/paper/paperStyle';
import type { FoldScene } from '../engine/foldEngineWire';
import { bookScene, flatSquareScene } from './foldCanvas.fixtures';
import { FOLD_PANE_DISPLAY_DEFAULT } from './foldPaneScenes';
import { foldSpreadPictureKey, foldStatePictureKey, foldStatePictureUrl } from './foldStatePicture';

/** The SVG a data URL carries. */
const svgOf = (url: string | null): string => {
  if (!url) throw new Error('no picture');
  expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  return decodeURIComponent(url.slice(url.indexOf(',') + 1));
};

const STYLE: PaperStyle = {
  ...DEFAULT_PAPER_STYLE,
  paper: { front: '#f2d64b', back: '#3b6fb6' },
  edges: { ...DEFAULT_PAPER_STYLE.edges, color: '#202020' },
  auxCreases: { visible: true, pen: { ...DEFAULT_PAPER_STYLE.auxCreases.pen, color: '#9c27b0' } },
};

/** The flat square precreased down its middle: two faces side by side, joined by a flat edge. */
function precreasedSquareScene(): FoldScene {
  const p = (x: number, y: number): Point => ({ x, y });
  const scene = flatSquareScene();
  const left = [p(0, 0), p(0.5, 0), p(0.5, 1), p(0, 1)];
  const right = [p(0.5, 0), p(1, 0), p(1, 1), p(0.5, 1)];
  const edges = (ring: Point[], flat: number) =>
    ring.map((from, k) => ({ from, to: ring[(k + 1) % ring.length]!, kind: k === flat ? ('flat' as const) : ('border' as const) }));
  return {
    ...scene,
    faces: [
      { outline: left, points: [0, 1, 2, 3], front_up: true, edges: edges(left, 1) },
      { outline: right, points: [1, 4, 5, 2], front_up: true, edges: edges(right, 3) },
    ],
    subfaces: [
      { polygon: left, faces_top_to_bottom: [0] },
      { polygon: right, faces_top_to_bottom: [1] },
    ],
    face_transforms: [scene.view_transform, scene.view_transform],
  };
}

describe('a folded state’s card picture', () => {
  it('paints the paper in the user’s style: its front, its edges', () => {
    const svg = svgOf(foldStatePictureUrl(flatSquareScene(), STYLE));
    expect(svg).toContain('fill="#f2d64b"');
    expect(svg).toContain('stroke="#202020"');
    expect(svg).not.toContain('#3b6fb6');
  });

  it('shows the back where a fold turned it up, and draws only what the reader would see', () => {
    const svg = svgOf(foldStatePictureUrl(bookScene(), STYLE));
    // The right half lies over the left, back up: the left half is buried and dropped.
    expect(svg).toContain('fill="#3b6fb6"');
    expect(svg).not.toContain('fill="#f2d64b"');
  });

  it('draws a precrease in the aux pen, and none with the Precreases switch off', () => {
    const on = svgOf(foldStatePictureUrl(precreasedSquareScene(), STYLE));
    expect(on).toContain('stroke="#9c27b0"');
    const off = svgOf(foldStatePictureUrl(precreasedSquareScene(), STYLE, { ...FOLD_PANE_DISPLAY_DEFAULT, precreases: false }));
    expect(off).not.toContain('#9c27b0');
    expect(off).toContain('fill="#f2d64b"');
  });

  it('spreads the layers as the step’s picture does: the buried half peeks out, front up', () => {
    const spread = { kind: 'depth' as const, amount: 0.1, toward: 'down' as const };
    const svg = svgOf(foldStatePictureUrl(bookScene(), STYLE, FOLD_PANE_DISPLAY_DEFAULT, spread));
    expect(svg).toContain('fill="#3b6fb6"');
    expect(svg).toContain('fill="#f2d64b"');
    // None at all is the pane's unspread picture.
    expect(foldStatePictureUrl(bookScene(), STYLE, FOLD_PANE_DISPLAY_DEFAULT, null)).toBe(
      foldStatePictureUrl(bookScene(), STYLE)
    );
    // A spread is keyed by what it says.
    expect(foldSpreadPictureKey(spread)).toBe(foldSpreadPictureKey({ ...spread }));
    expect(foldSpreadPictureKey({ ...spread, amount: 0.2 })).not.toBe(foldSpreadPictureKey(spread));
    expect(foldSpreadPictureKey(null)).not.toBe(foldSpreadPictureKey(spread));
  });

  it('is keyed by what it reads: the style and the Precreases switch, not the step-creases one', () => {
    const base = foldStatePictureKey(STYLE, FOLD_PANE_DISPLAY_DEFAULT);
    expect(foldStatePictureKey(STYLE, { ...FOLD_PANE_DISPLAY_DEFAULT, stepCreases: false })).toBe(base);
    expect(foldStatePictureKey(STYLE, { ...FOLD_PANE_DISPLAY_DEFAULT, precreases: false })).not.toBe(base);
    expect(foldStatePictureKey({ ...STYLE, paper: { ...STYLE.paper, front: '#ffffff' } })).not.toBe(base);
    // A copy of the style is the same look: keyed by what it says, not by which object says it.
    expect(foldStatePictureKey({ ...STYLE })).toBe(base);
  });
});
