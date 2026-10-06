import { describe, expect, it, vi } from 'vitest';
import { pictureGeometry } from '../annotate/pictureGeometry';
import { pictureSnapTarget } from '../annotate/pictureSnap';
import {
  createDiagram,
  DEFAULT_DIAGRAM_STYLE,
  insertSteps,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { estimateTextSetter } from '../pages/estimateTextSetter';
import { cellPicture, layoutPicture } from '../pages/pagePictures';
import { exportStepPicture } from '../pictures/exportStepPicture';
import { paintSource, sceneCulledTo, stepPictureSource } from '../pictures/paintDiagramStep';
import { paintedFrameLongerPx, storedScene } from '../pictures/pictureFrame';
import { zoomedStepUrl } from '../pictures/useStepPictureUrl';
import type { FileService } from '../../platform/fileService';
import { DEFAULT_PAPER_PAGE } from '../../lib/paper/paperPage';
import {
  paintZoomedPicture,
  poseGhostMarkup,
  posedZoomPicture,
  zoomClipShape,
  zoomCull,
  zoomedCardPicture,
  zoomedSource,
  zoomPlacement,
  ZOOM_GHOST_PEN,
} from './paintZoomed';
import { ANNOTATE_SELECTION_INK } from '../annotate/canvasInk';
import { viewOfStep } from './stepView';
import { craneStep } from './zoom.fixtures';
import { intoBox } from './zoomFrames';

const style = DEFAULT_DIAGRAM_STYLE;
const crane = craneStep('S.none');

/** The crane enlarged on a circle round its head's tip, as 16d's look-1 golden is. */
function enlarged(patch: Partial<DiagramStep> = {}): DiagramStep {
  return {
    ...crane,
    id: 'step-enlarged',
    zoom: { from: 'area-1', shape: 'circle', frame: { centre: [0.37, 0.13], radius: 0.13 } },
    annotatedPictureKey: crane.picture!.key,
    ...patch,
  };
}

const decode = (url: string | null) => new TextDecoder().decode(Uint8Array.from(atob(url!.split(',')[1]!), (c) => c.charCodeAt(0)));
const faces = (svg: string) => (svg.match(/<path d="M[^"]*Z" fill=/g) ?? []).length;

/** A label's place and size where it is drawn: the paper painter puts the marks' markup in a group that places it. */
function textAt(markup: string): { x: number; size: number } {
  const [, tx, , scale, x, size] = /<g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)"><text x="([-\d.]+)" y="[-\d.]+" font-size="([\d.]+)"/
    .exec(markup)!
    .map(Number);
  return { x: tx! + x! * scale!, size: size! * scale! };
}

describe('where an enlarged step’s window lands', () => {
  it('puts the window on the box asked for, and the whole picture and the frame with it by one scale and shift', () => {
    const view = viewOfStep(enlarged()).zoom!;
    const placement = zoomPlacement(view, { width: 0.7373, height: 1 }, { x: 10, y: 20, width: 100, height: 100 });
    // The window is 0.26 across: 100 / 0.26 units per picture unit.
    expect(placement.k).toBeCloseTo(100 / 0.26, 9);
    expect(placement.pictureFrame.x).toBeCloseTo(10 - 0.24 * placement.k, 9);
    expect(placement.pictureFrame.y).toBeCloseTo(20, 9);
    expect(placement.outline).toEqual({ centre: [60, 70], radius: expect.closeTo(50, 9) });
  });

  it('clips to the frame’s shape, a rounded rectangle turned with it, its corners 0.22 of its shorter side', () => {
    expect(zoomClipShape({ centre: [50, 40], radius: 20 })).toBe('<circle cx="50" cy="40" r="20"/>');
    expect(zoomClipShape({ centre: [50, 40], size: [60, 30], angle: 30 })).toBe(
      '<rect x="20" y="25" width="60" height="30" rx="6.6" ry="6.6" transform="rotate(30 50 40)"/>'
    );
  });
});

describe('an enlarged step painted', () => {
  it('paints its picture again so the window is a card’s 50 mm, its pens at their print weight', () => {
    const zoomed = zoomedSource(enlarged(), {})!;
    const painted = paintZoomedPicture(zoomed, style)!;
    // The window, 50 mm across, is the picture's frame.
    expect(Math.max(painted.frame.width, painted.frame.height)).toBeCloseTo(188.976, 2);
    // The picture is nested one to one: painted at the size it is drawn, its pens their pt widths.
    const nested = /<svg x="[-\d.]+" y="[-\d.]+" width="([\d.]+)" height="[\d.]+" viewBox="0 0 ([\d.]+) [\d.]+"/.exec(painted.svg)!;
    expect(Number(nested[1])).toBeCloseTo(Number(nested[2]), 1);
    expect(painted.svg).toContain('stroke-width="0.50"');
    // Twice the scale, twice the window: a close-up's inside.
    const twice = paintZoomedPicture(zoomed, style, { scale: 2 })!;
    expect(twice.frame.width).toBeCloseTo(2 * painted.frame.width, 6);
  });

  it('sizes the repaint from the scene as read once per picture, not parsed again for every window', () => {
    // Reading the step's frame read its scene.
    const zoomed = zoomedSource(enlarged(), {})!;
    const parse = vi.spyOn(JSON, 'parse');
    let atOne: number | null;
    try {
      atOne = paintedFrameLongerPx(zoomed.source);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
    // The frame the painter gives it at a scale of one.
    const painted = paintSource(zoomed.source, style)!;
    expect(atOne).toBeCloseTo(Math.max(painted.frame.width, painted.frame.height), 6);
  });

  it('paints only what lies near the window, and the scene keeps its bounds so the rest lands where it did', () => {
    const zoomed = zoomedSource(enlarged(), {})!;
    const whole = paintSource(zoomed.source, style)!.svg;
    const window = paintZoomedPicture(zoomed, style)!.svg;
    expect(faces(whole)).toBe(8);
    expect(faces(window)).toBeGreaterThan(0);
    expect(faces(window)).toBeLessThan(faces(whole));
    const scene = storedScene(crane.picture as never)!;
    const culled = sceneCulledTo(scene, zoomCull(zoomed.view, 50));
    expect(culled.bounds).toBe(scene.bounds);
    expect(culled.sheet).toBe(scene.sheet);
    expect(sceneCulledTo(scene, null)).toBe(scene);
  });

  it('clips the picture to the frame and draws its boundary over it, only where it crosses paper', () => {
    const svg = paintZoomedPicture(zoomedSource(enlarged(), {})!, style)!.svg;
    expect(svg).toMatch(/<clipPath id="zoom-clip"><circle [^>]*\/><\/clipPath><\/defs><g clip-path="url\(#zoom-clip\)">/);
    // One arc, in the paper's edges pen: 0.5 pt is 0.667 px.
    expect(svg.match(/<path d="M [\d.]+ [\d.]+ A [\d.]+ [\d.]+ 0 [01] 1 [\d.]+ [\d.]+" fill="none" stroke="#231f20" stroke-width="0.667"/g)).toHaveLength(1);
    // Drawn whole when the frame says so.
    const whole = paintZoomedPicture(zoomedSource(enlarged({ zoom: { ...enlarged().zoom!, edge: 'whole' } }), {})!, style)!.svg;
    expect(whole).toMatch(/<path d="M [\d.]+ [\d.]+ A [^"]* A [^"]*" fill="none"/);
  });

  it('draws its marks, in the window’s units, on the window as on a card’s frame', () => {
    const label: KnownDiagramAnnotation = { id: 'l', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'A' };
    const zoomed = zoomedSource(enlarged({ annotations: [label] }), {})!;
    const svg = zoomedCardPicture(zoomed, [label], style)!;
    const painted = paintZoomedPicture(zoomed, style)!;
    // At the window's middle, 0.05 of it tall.
    const text = textAt(svg);
    expect(text.x).toBeCloseTo(painted.frame.x + painted.frame.width / 2, 2);
    expect(text.size).toBeCloseTo(0.05 * painted.frame.width, 2);
  });

  it('shows a close-up on an enlarged step its window again, larger, under its ring', () => {
    const closeUp: KnownDiagramAnnotation = { id: 'c', kind: 'close-up', from: [0.5, 0.6], to: [0.8, 0.2], radius: 0.1 };
    const svg = zoomedCardPicture(zoomedSource(enlarged({ annotations: [closeUp] }), {})!, [closeUp], style)!;
    // The window's clip, and inside the close-up the window painted again under its own.
    expect(svg).toContain('clip-path="url(#zoom-clip)"');
    expect(svg).toContain('clip-path="url(#annotation-close-up-0-zoom-clip)"');
  });

  it('is a card’s picture, through the cache, and another frame is another picture', () => {
    const zoomed = zoomedSource(enlarged(), {})!;
    const url = zoomedStepUrl(zoomed, [], style);
    expect(decode(url)).toContain('data-zoom-window');
    expect(zoomedStepUrl(zoomed, [], style)).toBe(url);
    const moved = zoomedSource(enlarged({ zoom: { ...enlarged().zoom!, frame: { centre: [0.37, 0.2], radius: 0.13 } } }), {})!;
    expect(zoomedStepUrl(moved, [], style)).not.toBe(url);
  });

  it('is nothing to paint for a step that shows its whole picture, or none', () => {
    expect(zoomedSource(crane, {})).toBeNull();
    expect(zoomedSource({ ...enlarged(), picture: null }, {})).toBeNull();
    // A seeded step, its frame not landed yet, shows its picture whole.
    expect(zoomedSource(enlarged({ zoom: { from: 'area-1', shape: 'circle' } }), {})).toBeNull();
  });
});

describe('a label on an enlarged step', () => {
  it('prints the same size as on a step that is not enlarged, its frame printed as large', () => {
    const label: KnownDiagramAnnotation = { id: 'l', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'A' };
    const cell = { pictureMm: { x: 10, y: 20, size: 60 }, mmPerUnit: null, frameMm: 40 };
    const text = { hanStyle: 'sc' as const, runs: estimateTextSetter.runs };
    const size = (step: DiagramStep) => textAt(cellPicture(step, {}, style, cell, 'c0-', text)!.markup).size;
    const plain = { ...cpStep('step-plain'), annotations: [label] };
    expect(size(enlarged({ annotations: [label] }))).toBeCloseTo(size(plain), 6);
    // 0.05 of a 40 mm frame, in pt.
    expect(size(plain)).toBeCloseTo(0.05 * 40 * (72 / 25.4), 2);
  });
});

describe('an enlarged step on a page', () => {
  it('draws its window in the cell, its frame the window, its ids under the cell’s', () => {
    const cell = { pictureMm: { x: 10, y: 20, size: 60 }, mmPerUnit: null, frameMm: null };
    const picture = cellPicture(enlarged(), {}, style, cell, 'c3-', { hanStyle: 'sc', runs: estimateTextSetter.runs })!;
    expect(picture.markup).toContain('<clipPath id="c3-zoom-clip">');
    expect(picture.markup).toContain('clip-path="url(#c3-zoom-clip)"');
    // A circle's window is square, fitted to the 60 mm box with the boundary's pen, all it draws past it.
    const pt = 72 / 25.4;
    expect(picture.boundsPt.width).toBeCloseTo(60 * pt, 2);
    expect(picture.boundsPt.height).toBeCloseTo(picture.boundsPt.width, 6);
    expect(faces(picture.markup)).toBeLessThan(8);
  });
});

describe('marks far off an enlarged step’s window (Revision 2, Edge cases)', () => {
  // The window is 0.26 square: its marks' frame 1 × 1. One mark on it, one three windows off.
  const near: KnownDiagramAnnotation = { id: 'near', kind: 'valley-line', from: [0.2, 0.5], to: [0.8, 0.5] };
  const far: KnownDiagramAnnotation = { id: 'far', kind: 'valley-line', from: [3, 0.5], to: [3.5, 0.5] };
  const text = { hanStyle: 'sc' as const, runs: estimateTextSetter.runs };

  it('are neither drawn nor measured on a card', () => {
    const zoomed = zoomedSource(enlarged({ annotations: [near, far] }), {})!;
    expect(zoomedCardPicture(zoomed, [near, far], style)).toBe(zoomedCardPicture(zoomed, [near], style));
    // Nor on a card whose only mark is far off: the window alone.
    expect(zoomedCardPicture(zoomed, [far], style)).toBe(paintZoomedPicture(zoomed, style)!.svg);
  });

  it('are neither drawn nor measured on a page', () => {
    const cell = { pictureMm: { x: 10, y: 20, size: 60 }, mmPerUnit: null, frameMm: null };
    const both = enlarged({ annotations: [near, far] });
    const one = enlarged({ annotations: [near] });
    expect(cellPicture(both, {}, style, cell, 'c0-', text)).toEqual(cellPicture(one, {}, style, cell, 'c0-', text));
    expect(layoutPicture(both, {}, style)).toEqual(layoutPicture(one, {}, style));
    // A step that is not enlarged draws and measures every mark, wherever it lies.
    const plain = (annotations: KnownDiagramAnnotation[]) => ({ ...crane, annotations });
    expect(layoutPicture(plain([near, far]), {}, style)).not.toEqual(layoutPicture(plain([near]), {}, style));
  });
});

describe('an enlarged step in Pose', () => {
  it('shows its whole picture, the frame dashed in the selection’s ink and the rest dimmed, its marks ghosted on the window', () => {
    const label: KnownDiagramAnnotation = { id: 'l', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'A' };
    const step = enlarged({ annotations: [label] });
    const zoomed = zoomedSource(step, {})!;
    const painted = paintSource(zoomed.source, style)!;
    const svg = posedZoomPicture(painted, zoomed.view, zoomed.pictureFrame, [label], style, 0.3);
    expect(faces(svg)).toBe(8);
    expect(svg).toContain(`stroke="${ANNOTATE_SELECTION_INK}"`);
    expect(svg).toMatch(/stroke-dasharray="[\d.]+ [\d.]+"/);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('<g opacity="0.3">');
    // The label at the window's middle, on the whole picture: the head's tip.
    const k = Math.max(painted.frame.width, painted.frame.height);
    expect(textAt(svg).x).toBeCloseTo(painted.frame.x + 0.37 * k, 1);
  });

  it('shows all of its frame’s outline where it reaches past the picture, with no marks to grow its box', () => {
    // A circle round a point at the model's edge: it reaches past the picture's left side.
    const step = enlarged({ zoom: { from: 'area-1', shape: 'circle', frame: { centre: [0.08, 0.2], radius: 0.14 } } });
    const zoomed = zoomedSource(step, {})!;
    const painted = paintSource(zoomed.source, style)!;
    const svg = posedZoomPicture(painted, zoomed.view, zoomed.pictureFrame, [], style, 0.3);
    const [x, y, width, height] = /viewBox="(\S+) (\S+) (\S+) (\S+)"/.exec(svg)!.slice(1).map(Number);
    const k = Math.max(painted.frame.width, painted.frame.height);
    // The circle's leftmost point, and half the dashed pen past it.
    const left = painted.frame.x + (0.08 - 0.14) * k - ZOOM_GHOST_PEN.picture / 2;
    expect(left).toBeLessThan(0);
    expect(x).toBeCloseTo(left, 2);
    // The rest of the picture is in the box as before; the dimming covers all of it.
    expect([y, x + width, y + height]).toEqual([0, painted.widthPx, painted.heightPx].map((value) => expect.closeTo(value, 2)));
    expect(svg).toContain(`M ${Math.round(x * 1000) / 1000} 0 h`);
    expect(height).toBeGreaterThan(0);
  });

  it('outlines the frame over a live view, undimmed, its marks on the window', () => {
    const label: KnownDiagramAnnotation = { id: 'l', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'A' };
    const frame = { x: 0, y: 0, width: 300 * 0.7373, height: 300 };
    const markup = poseGhostMarkup([label], frame, style, viewOfStep(enlarged()).zoom)!;
    expect(markup).toContain('data-zoom-frame-ghost');
    expect(markup).not.toContain('evenodd');
    expect(textAt(markup).x).toBeCloseTo(0.37 * 300, 1);
    // A step that is not enlarged: its marks on its frame, as before.
    expect(poseGhostMarkup([label], frame, style)).not.toContain('data-zoom-frame-ghost');
  });
});

describe('Export Picture of an enlarged step', () => {
  const label: KnownDiagramAnnotation = { id: 'l', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'A' };
  /** What Export Picture writes of the step with this id. */
  async function exported(stepId: string): Promise<string> {
    const document = insertSteps(createDiagram({ title: 'Crane' }), [crane, enlarged({ annotations: [label] })], 0);
    const saveTextFile = vi.fn(async () => 'saved');
    expect(await exportStepPicture(document, stepId, { saveTextFile } as unknown as FileService)).toBe('svg');
    const [[{ contents }]] = saveTextFile.mock.calls as unknown as [[{ contents: string }]];
    return contents;
  }
  /** A file's root: its declaration, its size with its units, its view box. */
  const root = (svg: string) => {
    const [, declared, width, widthUnit, height, heightUnit, viewBox] =
      /^(<\?xml[^>]*\?>)?\s*<svg [^>]*?width="([\d.]+)([a-z]*)" height="([\d.]+)([a-z]*)" viewBox="([^"]*)"/.exec(svg)!;
    return { declared: declared !== undefined, width: Number(width), widthUnit, height: Number(height), heightUnit, viewBox };
  };

  it('writes what the step shows: its window and boundary, no marks, as SVG', async () => {
    const contents = await exported('step-enlarged');
    expect(contents).toContain('data-zoom-window');
    expect(contents).not.toContain('<text');
  });

  it('writes it sized in pt, its pens their pt widths, as it writes a picture that is not enlarged', async () => {
    const [plain, window] = [root(await exported(crane.id)), root(await exported('step-enlarged'))];
    expect(plain).toMatchObject({ declared: true, widthUnit: 'pt', heightUnit: 'pt' });
    expect(window).toMatchObject({ declared: true, widthUnit: 'pt', heightUnit: 'pt' });
    // A circle's window: 50 mm square, and the page's margin round it.
    const pt = 72 / 25.4;
    expect(window.width).toBeCloseTo((50 + 2 * DEFAULT_PAPER_PAGE.paddingMm) * pt, 2);
    expect(window.height).toBeCloseTo(window.width, 6);
    expect(window.viewBox).toBe(`0 0 ${window.width} ${window.height}`);
    // Its boundary in the paper's edges pen, 0.5 pt.
    const contents = await exported('step-enlarged');
    expect(contents).toMatch(/<path d="M [^"]*" fill="none" stroke="#231f20" stroke-width="0.5" stroke-linecap="round"/);
  });
});

describe('snapping on an enlarged step', () => {
  it('snaps to the picture’s points where the window puts them', () => {
    const step = enlarged();
    const window = viewOfStep(step).window!;
    // The head's tip, a corner of the paper, in the window's units.
    const tip = pictureGeometry(step, {}).points.find(({ at }) => Math.abs(at[1]) < 1e-3)!.at;
    const inWindow = intoBox(window, tip);
    const target = pictureSnapTarget(step, {}, [inWindow[0] + 0.01, inWindow[1] + 0.01], 0.05, { style });
    expect(target?.at[0]).toBeCloseTo(inWindow[0], 9);
    expect(target?.at[1]).toBeCloseTo(inWindow[1], 9);
    expect(stepPictureSource(step, {})).not.toBeNull();
  });
});
