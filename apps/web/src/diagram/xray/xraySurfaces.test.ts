import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { DiagramCloseUpInsides } from '../../components/diagram/DiagramCloseUpInsides';
import { PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import { PT_PER_MM } from '../../lib/paper/paperSvg';
import { annotationDrawing } from '../annotate/annotationPrimitives';
import { CARD_FRAME_PX } from '../annotate/canvasInk';
import { closeUpInsides } from '../annotate/useCloseUpInsides';
import {
  createDiagram,
  DEFAULT_DIAGRAM_STYLE,
  insertSteps,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { FIXTURE_FONTS, fixtureSubsetter } from '../fonts/diagramFonts.fixtures';
import type { FontSubsetter } from '../fonts/fontSubset';
import { PAD_MM } from '../export/stepFileGeometry';
import { prepareStepFiles } from '../export/stepFiles';
import { layoutPicture } from '../pages/pagePictures';
import { stepPictureSource } from '../pictures/paintDiagramStep';
import { poseGhostMarkup } from '../zoom/paintZoomed';
import { markGeometry, viewFrame, viewOfStep } from '../zoom/stepView';
import { fromBox, outlineIntoBox } from '../zoom/zoomFrames';
import { XRAY_CASES, xrayCase } from './xray.cases';
import { groupsIn, xraySurfaces, xrayWindowsIn, type XRaySurfaceDrawn } from './xray.surfaces';
import { xraySurfaceOf } from './xrayPaint';

const style = DEFAULT_DIAGRAM_STYLE;
/** The Diagram preset's edges, in pt: a face's outline; the rim is 1.5 times it (R3-15b (ii)). */
const EDGES_PT = 0.5;

type Pt = [number, number];

/** A window as a surface drew it, read back: in its frame's units (its longer side one) and its pens in pt. */
interface WindowRead {
  clip: { x: number; y: number; r: number };
  bound: Pt[] | null;
  faces: { fill: string; stroke: string; pt: number; rings: Pt[][] }[];
  /** The white over the faces it takes away: its ink, its pen in pt, and each face's rings. */
  ground: { color: string; pt: number; rings: Pt[][][] } | null;
  /** The rim: its centre and radius, its pen in pt and, `w`, in the frame's units. */
  rim: { x: number; y: number; r: number; pt: number; w: number; color: string };
}

const numbers = (text: string) => text.match(/-?[\d.]+/g)!.map(Number);

/** A face path's rings: `M x,y L x,y … Z`, one ring each. */
function ringsOf(d: string): Pt[][] {
  return d
    .split('M')
    .filter((ring) => ring !== '')
    .map((ring) => {
      const values = numbers(ring.replace('Z', ''));
      const points: Pt[] = [];
      for (let i = 0; i < values.length; i += 2) points.push([values[i]!, values[i + 1]!]);
      return points;
    });
}

/** A window's markup on `surface`, read in its frame's units and pt. */
function readWindow(markup: string, surface: Pick<XRaySurfaceDrawn, 'frame' | 'unitsPerPt'>): WindowRead {
  const { frame, unitsPerPt } = surface;
  const longer = Math.max(frame.width, frame.height);
  const at = ([x, y]: Pt): Pt => [(x - frame.x) / longer, (y - frame.y) / longer];
  const clip = /<clipPath id="[^"]*clip"><circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"\/>/.exec(markup);
  const bound = /<clipPath id="[^"]*bound"><polygon points="([^"]+)"\/>/.exec(markup);
  const ground = /<g data-x-ray-ground="" fill="([^"]+)" stroke="[^"]+" stroke-width="([\d.]+)"[^>]*>(.*?)<\/g>/.exec(markup);
  const rim = /<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)" fill="none" stroke="([^"]+)" stroke-width="([\d.]+)"\/>$/.exec(markup)!;
  const faces = [...markup.matchAll(/<path d="([^"]+)"(?: fill-rule="evenodd")? fill="([^"]+)" stroke="([^"]+)" stroke-width="([\d.]+)"\/>/g)].map(
    ([, d, fill, stroke, width]) => ({ fill: fill!, stroke: stroke!, pt: Number(width) / unitsPerPt, rings: ringsOf(d!).map((ring) => ring.map(at)) })
  );
  const circle = (x: string, y: string, r: string) => {
    const [cx, cy] = at([Number(x), Number(y)]);
    return { x: cx, y: cy, r: Number(r) / longer };
  };
  return {
    clip: clip ? circle(clip[1]!, clip[2]!, clip[3]!) : { x: NaN, y: NaN, r: NaN },
    bound: bound
      ? numbers(bound[1]!).reduce<Pt[]>((points, value, index, all) => (index % 2 === 0 ? [...points, at([value, all[index + 1]!])] : points), [])
      : null,
    faces,
    ground: ground
      ? {
          color: ground[1]!,
          pt: Number(ground[2]) / unitsPerPt,
          rings: [...ground[3]!.matchAll(/<path d="([^"]+)"/g)].map(([, d]) => ringsOf(d!).map((ring) => ring.map(at))),
        }
      : null,
    rim: { ...circle(rim[1]!, rim[2]!, rim[3]!), pt: Number(rim[5]) / unitsPerPt, w: Number(rim[5]) / longer, color: rim[4]! },
  };
}

/** Two windows read back, the same within what each surface's rounding allows. */
function expectSameWindow(actual: WindowRead, expected: WindowRead, where: string) {
  const close = (a: number, b: number, what: string, within = 1e-4) => expect(Math.abs(a - b), `${where}: ${what}`).toBeLessThan(within);
  for (const key of ['x', 'y', 'r'] as const) {
    close(actual.clip[key], expected.clip[key], `clip ${key}`);
    close(actual.rim[key], expected.rim[key], `rim ${key}`);
  }
  close(actual.rim.pt, expected.rim.pt, 'rim pen', 6e-3);
  expect(actual.rim.color).toBe(expected.rim.color);
  // An enlarged step's frame, inset by half its cut's pen at its print weight on each surface: the same outline, its
  // middle where the canvas has it (its inset is checked on its own).
  expect(actual.bound === null, `${where}: bound`).toBe(expected.bound === null);
  if (actual.bound && expected.bound) {
    expect(actual.bound).toHaveLength(expected.bound.length);
    const middle = (points: Pt[]) => [0, 1].map((axis) => points.reduce((sum, point) => sum + point[axis]!, 0) / points.length);
    close(middle(actual.bound)[0]!, middle(expected.bound)[0]!, 'bound x');
    close(middle(actual.bound)[1]!, middle(expected.bound)[1]!, 'bound y');
  }
  // The white over the faces it takes away: the same faces, where the picture draws them, their outline's pen wide.
  expect(actual.ground === null, `${where}: ground`).toBe(expected.ground === null);
  if (actual.ground && expected.ground) {
    expect(actual.ground.color).toBe(expected.ground.color);
    close(actual.ground.pt, expected.ground.pt, 'ground pen', 6e-3);
    expect(actual.ground.rings.map((rings) => rings.map((ring) => ring.length))).toEqual(
      expected.ground.rings.map((rings) => rings.map((ring) => ring.length))
    );
    actual.ground.rings.forEach((rings, face) => rings.forEach((ring, r) => ring.forEach((point, p) => {
      close(point[0], expected.ground!.rings[face]![r]![p]![0], `ground ${face} x`);
      close(point[1], expected.ground!.rings[face]![r]![p]![1], `ground ${face} y`);
    })));
  }
  expect(actual.faces.map((face) => face.fill), `${where}: the faces, in order`).toEqual(expected.faces.map((face) => face.fill));
  actual.faces.forEach((face, index) => {
    const other = expected.faces[index]!;
    expect(face.stroke).toBe(other.stroke);
    close(face.pt, other.pt, 'face pen', 6e-3);
    expect(face.rings.map((ring) => ring.length)).toEqual(other.rings.map((ring) => ring.length));
    face.rings.forEach((ring, r) => ring.forEach((point, p) => {
      close(point[0], other.rings[r]![p]![0], `face ${index} x`);
      close(point[1], other.rings[r]![p]![1], `face ${index} y`);
    }));
  });
}

/** The step shown as its crease pattern (Show As, D19): its picture kept, its render changed — no layers to x-ray. */
function asPattern(step: DiagramStep): DiagramStep {
  if (step.source?.kind !== 'cp') throw new Error('a linked step');
  return { ...step, source: { ...step.source, render: { mode: 'crease-pattern', rotationDeg: 0 } } };
}

/** `step` without its x-rays. */
function withoutXRays(step: DiagramStep): DiagramStep {
  return { ...step, annotations: step.annotations.filter((annotation) => (annotation as KnownDiagramAnnotation).kind !== 'x-ray') };
}

const xrays = (step: DiagramStep) => step.annotations.filter((annotation) => (annotation as KnownDiagramAnnotation).kind === 'x-ray');

describe('an x-ray on every surface (Revision 3, 18f)', () => {
  it.each(XRAY_CASES.map((entry) => [entry.id, entry.step] as const))(
    '%s: a card and a page draw the canvas’s window, and Pose its rim, where their frame puts it, its pens at their print weight',
    (_id, step) => {
      const surfaces = xraySurfaces(step);
      const count = xrays(step).length;
      for (const surface of [surfaces.canvas, surfaces.card, surfaces.page, surfaces.pose]) expect(surface.windows).toHaveLength(count);
      // Pose draws the whole picture, an enlarged step's marks on its window there: the canvas's rim, in the picture's
      // units — its pen the canvas's at the window's scale (review of 18f).
      const zoom = viewOfStep(step).zoom;
      const unit = zoom ? Math.max(zoom.window.width, zoom.window.height) : 1;
      // The canvas lays each window's markup down as it is made.
      expect(xrays(step).flatMap((mark) => groupsIn(surfaces.canvas.markup, `<g data-x-ray-inside="${mark.id}">`))).toEqual(surfaces.canvas.windows);
      surfaces.canvas.windows.forEach((markup, index) => {
        const canvas = readWindow(markup, surfaces.canvas);
        // The rim 1.5 × the edges' pen, each face outlined in the edges' pen: their pt on every surface.
        expect(canvas.rim.pt).toBeCloseTo(1.5 * EDGES_PT, 2);
        for (const face of canvas.faces) expect(face.pt).toBeCloseTo(EDGES_PT, 1);
        // The white over what it takes away covers their outlines, the edges' pen wide.
        if (canvas.ground) expect(canvas.ground.pt).toBeCloseTo(EDGES_PT, 1);
        expect(canvas.faces.length).toBeGreaterThan(0);
        expectSameWindow(readWindow(surfaces.card.windows[index]!, surfaces.card), canvas, 'card');
        expectSameWindow(readWindow(surfaces.page.windows[index]!, surfaces.page), canvas, 'page');
        const { rim } = readWindow(surfaces.pose.windows[index]!, { frame: surfaces.pose.frame, unitsPerPt: 1 });
        const [x, y] = zoom ? fromBox(zoom.window, [canvas.rim.x, canvas.rim.y]) : [canvas.rim.x, canvas.rim.y];
        expect(Math.abs(rim.x - x), 'Pose: rim x').toBeLessThan(1e-4);
        expect(Math.abs(rim.y - y), 'Pose: rim y').toBeLessThan(1e-4);
        expect(Math.abs(rim.r - canvas.rim.r * unit), 'Pose: rim r').toBeLessThan(1e-4);
        expect(Math.abs(rim.w - canvas.rim.w * unit), 'Pose: rim pen').toBeLessThan(1e-4);
        expect(rim.color).toBe(canvas.rim.color);
      });
    }
  );

  it('lays the window where the mark is: its centre and radius on the frame, in the marks’ units', () => {
    for (const id of ['stacked-1', 'crane-spread', 'crane-enlarged']) {
      const step = xrayCase(id);
      const [mark] = xrays(step) as KnownDiagramAnnotation[];
      const { canvas, page } = xraySurfaces(step);
      for (const surface of [canvas, page]) {
        const { clip } = readWindow(surface.windows[0]!, surface);
        expect(clip.x).toBeCloseTo(mark!.from[0], 4);
        expect(clip.y).toBeCloseTo(mark!.from[1], 4);
        expect(clip.r).toBeCloseTo(mark!.radius!, 4);
      }
    }
  });

  it('shows the picture’s own faces through a window, less those it takes away, face for face, on a card and a page (18.0 results, 6; 18g)', () => {
    const step = xrayCase('crane-off-paper');
    const { card, page } = xraySurfaces(step);
    // The page draws the picture in pt, as the window is drawn: its own face paths, before the marks.
    const pictureOnPage = page.markup.slice(0, page.markup.indexOf('data-x-ray-window'));
    // A card nests the picture whole at the origin, in its own pt: put back in the card's px.
    const nested = /<svg xmlns="[^"]+" width="([\d.]+)pt" height="[\d.]+pt" viewBox="0 0 ([\d.]+) [\d.]+"/.exec(card.markup)!;
    const scale = (Number(nested[1]) * PT_TO_CSS_PX) / Number(nested[2]);
    const pictureOnCard = card.markup.slice(nested.index, card.markup.indexOf('data-x-ray-window')).replace(/d="([^"]+)"/g, (_, d: string) =>
      `d="${d.replace(/-?[\d.]+/g, (value) => (Number(value) * scale).toFixed(4))}"`
    ).replace(/stroke-width="([\d.]+)"/g, (_, width: string) => `stroke-width="${(Number(width) * scale).toFixed(4)}"`);
    for (const [surface, picture] of [
      [page, pictureOnPage],
      [card, pictureOnCard],
    ] as const) {
      const window = readWindow(surface.windows[0]!, surface);
      const own = readWindow(`${picture}<circle cx="0" cy="0" r="0" fill="none" stroke="#000" stroke-width="0"/>`, surface).faces;
      const box = { x0: window.clip.x - window.clip.r, x1: window.clip.x + window.clip.r, y0: window.clip.y - window.clip.r, y1: window.clip.y + window.clip.r };
      // Every face of the picture that reaches into the window's box, in its order, its pen and its places — but those
      // it takes away, which lie under its white where the picture draws them. A spread picture draws every face, so a
      // window shows no face the picture does not.
      const taken = (face: WindowRead['faces'][number]) =>
        (window.ground?.rings ?? []).some(
          (rings) =>
            rings.length === face.rings.length &&
            rings.every(
              (ring, r) =>
                ring.length === face.rings[r]!.length &&
                ring.every(([x, y], p) => Math.abs(x - face.rings[r]![p]![0]) < 1e-4 && Math.abs(y - face.rings[r]![p]![1]) < 1e-4)
            )
        );
      const reaching = own.filter((face) => {
        const points = face.rings.flat();
        const [xs, ys] = [points.map(([x]) => x), points.map(([, y]) => y)];
        return Math.max(...xs) >= box.x0 && Math.min(...xs) <= box.x1 && Math.max(...ys) >= box.y0 && Math.min(...ys) <= box.y1;
      });
      expect(window.ground).not.toBeNull();
      expect(reaching.filter(taken).length).toBe(window.ground!.rings.length);
      expect(window.faces.length).toBeGreaterThan(3);
      expectSameWindow(window, { ...window, faces: reaching.filter((face) => !taken(face)) }, surface === page ? 'page' : 'card');
    }
  });

  it('is drawn under the step’s marks, and a close-up whose area takes one in shows the picture plain there (R3-20 B)', () => {
    const step = xrayCase('crane-marks');
    const { card, page } = xraySurfaces(step);
    for (const markup of [card.markup, page.markup]) {
      const windowsEnd = markup.lastIndexOf('data-x-ray-window');
      // The valley line drawn over the windows, its dashes after them.
      expect(markup.indexOf('stroke-dasharray')).toBeGreaterThan(windowsEnd);
      // The close-up's inside, after the windows, draws none of them: no window, no rim.
      const [closeUp, ...more] = groupsIn(markup, markup.includes('c0-') ? '<g clip-path="url(#c0-annotation-close-up-0)">' : '<g clip-path="url(#annotation-close-up-0)">');
      expect(more).toEqual([]);
      expect(markup.indexOf('annotation-close-up-0')).toBeGreaterThan(windowsEnd);
      // The picture painted again, plain: its faces.
      expect(closeUp).toMatch(/<path d="M/);
      expect(closeUp).not.toContain('x-ray');
    }
    // The canvas's close-up draws the step's other marks inside it, and no x-ray among them.
    const frame = viewFrame(viewOfStep(step), {})!;
    const layers = markGeometry(step, {}, style).layers;
    const drawing = annotationDrawing(step.annotations, frame, CARD_FRAME_PX, style, layers);
    const insides = closeUpInsides({
      drawing,
      shown: step.annotations,
      committed: step.annotations,
      source: stepPictureSource(step, {}),
      style,
      layers,
      pictureFrame: frame,
      framePx: CARD_FRAME_PX,
    });
    expect(insides).toHaveLength(1);
    expect(renderToStaticMarkup(createElement(DiagramCloseUpInsides, { insides, style }))).not.toContain('x-ray');
  });

  it('on an enlarged step, holds its inside to the frame within the frame’s cut, half the cut’s pen in, on every surface', () => {
    const step = xrayCase('crane-enlarged');
    const view = viewOfStep(step).zoom!;
    const frame = outlineIntoBox(view.window, view.frame);
    const surfaces = xraySurfaces(step);
    for (const surface of [surfaces.canvas, surfaces.card, surfaces.page]) {
      const { bound } = readWindow(surface.windows[0]!, surface);
      // Half the edges' pen, at its print weight there, in the window's units.
      const half = (EDGES_PT * surface.unitsPerPt) / 2 / Math.max(surface.frame.width, surface.frame.height);
      expect(bound!.length).toBeGreaterThan(8);
      for (const [x, y] of bound!) expect(Math.hypot(x - frame.centre[0], y - frame.centre[1])).toBeCloseTo(frame.radius! - half, 4);
    }
  });

  it('gives every window ids of its own on a page: two windows, two clips', () => {
    const { page } = xraySurfaces(xrayCase('crane-marks'));
    const ids = [...page.markup.matchAll(/ id="([^"]+)"/g)].map(([, id]) => id);
    expect(ids).toContain('c0-annotation-x-ray-0-clip');
    expect(ids).toContain('c0-annotation-x-ray-1-clip');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('draws at the deepest where its depth is past the stack, as the canvas does', () => {
    expect(xraySurfaces(xrayCase('stacked-past'))).toEqual(xraySurfaces(xrayCase('stacked-2')));
  });

  it('is drawn nowhere on a picture with no layers, rim included, and no surface makes room for it (R3-18b A)', () => {
    for (const id of ['stacked-edge', 'crane-off-paper', 'crane-enlarged']) {
      const step = asPattern(xrayCase(id));
      const surfaces = xraySurfaces(step);
      const plain = xraySurfaces(withoutXRays(step));
      for (const surface of ['canvas', 'card', 'page', 'pose'] as const) expect(surfaces[surface].windows).toEqual([]);
      expect(surfaces.page.boundsPt).toEqual(plain.page.boundsPt);
      expect(layoutPicture(step, {}, style)).toEqual(layoutPicture(withoutXRays(step), {}, style));
    }
    // Shown back as its flat fold, it is drawn again.
    expect(xraySurfaces(xrayCase('stacked-edge')).page.windows).toHaveLength(1);
  });

  it('reaches past the frame by its rim: a page leaves it room, measured and drawn, where it has layers', () => {
    const step = xrayCase('stacked-edge');
    const { page } = xraySurfaces(step);
    const plain = xraySurfaces(withoutXRays(step)).page;
    const rim = /<circle cx="([-\d.]+)" cy="[-\d.]+" r="([-\d.]+)" fill="none" stroke="[^"]+" stroke-width="([\d.]+)"\/>$/.exec(page.windows[0]!)!;
    const right = Number(rim[1]) + Number(rim[2]) + Number(rim[3]) / 2;
    expect(page.boundsPt.x + page.boundsPt.width).toBeCloseTo(right, 2);
    expect(page.boundsPt.x + page.boundsPt.width).toBeGreaterThan(plain.boundsPt.x + plain.boundsPt.width);
    // The layout measures it as the page draws it: a reach past the frame's right side.
    const measured = layoutPicture(step, {}, style)!;
    const bare = layoutPicture(withoutXRays(step), {}, style)!;
    expect(measured.sides!.right.beyond + measured.sides!.right.grows).toBeGreaterThan(bare.sides!.right.beyond + bare.sides!.right.grows);
  });

  it('in Pose, is its rim alone, ghosted with the marks: on a card and on an enlarged step (R3-19 A)', () => {
    for (const id of ['crane-marks', 'crane-enlarged', 'stacked-1']) {
      const step = xrayCase(id);
      const { pose } = xraySurfaces(step);
      expect(pose.windows).toHaveLength(xrays(step).length);
      for (const window of pose.windows) {
        expect(window).toMatch(/^<circle cx="[-\d.]+" cy="[-\d.]+" r="[-\d.]+" fill="none" stroke="#231f20" stroke-width="[\d.]+"\/>$/);
      }
      // Under the ghost's opacity, as every mark is.
      expect(pose.markup).toMatch(/<g opacity="0\.3">[^]*data-x-ray-window/);
      expect(pose.markup).not.toContain('x-ray-0-clip');
    }
    // A live view (3D or simulated) is a picture with no layers: its ghost draws none (R3-18b A).
    const step = xrayCase('crane-spread');
    expect(poseGhostMarkup(step.annotations, { x: 10, y: 20, width: 300, height: 400 }, style)).toBeNull();
    expect(xraySurfaceOf(asPattern(step), 'rim')).toBeNull();
  });
});

describe('an x-ray in a ZIP’s step files (Revision 3, 18f)', () => {
  let subsetter: FontSubsetter;
  beforeAll(async () => {
    subsetter = await fixtureSubsetter();
  });

  const cropped = { number: false, text: false, sameSize: false, widthMm: 80, heightMm: 100, transparent: true };

  it('is drawn in a cropped file, which is cut round its rim and a pad past it', () => {
    const step = xrayCase('stacked-edge');
    const file = (each: DiagramStep) => {
      const document = insertSteps(createDiagram({ title: 'Stack', hanStyle: 'sc' }), [each], 0);
      return prepareStepFiles(document, FIXTURE_FONTS, subsetter, cropped).compose(0).svg;
    };
    const svg = file(step);
    const [window] = xrayWindowsIn(svg);
    expect(window).toBeDefined();
    const rim = /<circle cx="([-\d.]+)" cy="[-\d.]+" r="([-\d.]+)" fill="none" stroke="[^"]+" stroke-width="([\d.]+)"\/>$/.exec(window!)!;
    const [x, , width] = numbers(/viewBox="([^"]+)"/.exec(svg)![1]!);
    // The picture is drawn where its room settles it: its markup moved as a whole.
    const settled = /<g transform="translate\(([-\d.]+) [-\d.]+\)">/.exec(svg);
    const dx = settled && settled.index < svg.indexOf('data-x-ray-window') ? Number(settled[1]) : 0;
    expect(x! + width!).toBeCloseTo(dx + Number(rim[1]) + Number(rim[2]) + Number(rim[3]) / 2 + PAD_MM * PT_PER_MM, 2);
    // Without layers the file draws no window and is cut round the picture alone.
    const pattern = file(asPattern(step));
    expect(xrayWindowsIn(pattern)).toEqual([]);
    expect(/viewBox="([^"]+)"/.exec(pattern)![1]).toBe(/viewBox="([^"]+)"/.exec(file(asPattern(withoutXRays(step))))![1]);
  });
});

/** Whether `point` is inside `rings`, filled even-odd. */
function insideRings(rings: readonly Pt[][], [x, y]: Pt): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Whether `point` is within `within` of an edge of `rings`: where their outline's pen reaches. */
function nearRings(rings: readonly Pt[][], [x, y]: Pt, within: number): boolean {
  return rings.some((ring) =>
    ring.some(([ax, ay], index) => {
      const [bx, by] = ring[(index + 1) % ring.length]!;
      const [dx, dy] = [bx - ax, by - ay];
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= within;
    })
  );
}

/** A shape drawn in a surface's markup, in its units: rings filled even-odd, their outline's pen reaching `reach` either side. */
interface Painted {
  rings: Pt[][];
  reach: number;
}

const paints = (shape: Painted, point: Pt) => insideRings(shape.rings, point) || nearRings(shape.rings, point, shape.reach);

/** Every face path in `markup` — the picture's, or a window's faces left — as the shape it paints. */
function facePaths(markup: string): Painted[] {
  return [...markup.matchAll(/<path d="([^"]+)"(?: fill-rule="evenodd")? fill="[^"]+" stroke="[^"]+" stroke-width="([\d.]+)"\/>/g)].map(
    ([, d, width]) => ({ rings: ringsOf(d!), reach: Number(width) / 2 })
  );
}

/**
 * The points inside a window that are off the paper, and those of them it
 * paints, in its surface's units: on a grid across its clip, inside its rim
 * and its bound, farther than an edge's pen from every face of the picture
 * (`picture`, the surface's markup before its windows) — and painted where
 * any shape the window draws covers one: the white over the faces it takes
 * away, a face left, a filled disc.
 */
function offPaper(window: string, picture: readonly Painted[]): { off: Pt[]; painted: Pt[] } {
  const [cx, cy, r] = numbers(/<clipPath id="[^"]*clip"><circle ([^/]+)\/>/.exec(window)![1]!);
  const rim = Number(/stroke-width="([\d.]+)"\/>$/.exec(window)![1]);
  const boundPoints = /<clipPath id="[^"]*bound"><polygon points="([^"]+)"\/>/.exec(window);
  const bound = boundPoints ? [numbers(boundPoints[1]!).reduce<Pt[]>((points, value, index, all) => (index % 2 === 0 ? [...points, [value, all[index + 1]!]] : points), [])] : null;
  const ground = /<g data-x-ray-ground="" fill="[^"]+" stroke="[^"]+" stroke-width="([\d.]+)"[^>]*>(.*?)<\/g>/.exec(window);
  const shapes: Painted[] = [
    ...(ground ? [...ground[2]!.matchAll(/<path d="([^"]+)"/g)].map(([, d]) => ({ rings: ringsOf(d!), reach: Number(ground[1]) / 2 })) : []),
    ...facePaths(window),
  ];
  const discs = [...window.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)" fill="(?!none)[^"]+"\/>/g)].map(([, x, y, radius]) => [Number(x), Number(y), Number(radius)] as const);
  const off: Pt[] = [];
  const painted: Pt[] = [];
  const steps = 48;
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      const point: Pt = [cx! - r! + (2 * r! * i) / steps, cy! - r! + (2 * r! * j) / steps];
      if (Math.hypot(point[0] - cx!, point[1] - cy!) >= r! - rim || (bound && !insideRings(bound, point))) continue;
      if (picture.some((face) => insideRings(face.rings, point) || nearRings(face.rings, point, 2 * face.reach))) continue;
      off.push(point);
      if (shapes.some((shape) => paints(shape, point)) || discs.some(([x, y, radius]) => Math.hypot(point[0] - x, point[1] - y) <= radius)) painted.push(point);
    }
  }
  return { off, painted };
}

describe('an x-ray off the paper (review of 18f)', () => {
  let subsetter: FontSubsetter;
  beforeAll(async () => {
    subsetter = await fixtureSubsetter();
  });

  /** A ZIP's step file cut round its picture, transparent: nothing under it but what it is laid on. */
  const transparentFile = (step: DiagramStep) => {
    const document = insertSteps(createDiagram({ title: 'Crane', hanStyle: 'sc' }), [step], 0);
    return prepareStepFiles(document, FIXTURE_FONTS, subsetter, {
      number: false,
      text: false,
      sameSize: false,
      widthMm: 80,
      heightMm: 100,
      transparent: true,
    }).compose(0).svg;
  };

  /** The windows of a surface's markup, each with the picture drawn under it: its faces, in the same units. */
  const windowsOver = (markup: string) => {
    const picture = facePaths(markup.slice(0, markup.indexOf('<g data-x-ray-window')));
    return xrayWindowsIn(markup).map((window) => offPaper(window, picture));
  };

  it.each(XRAY_CASES.map((entry) => [entry.id, entry.step] as const))(
    '%s paints nothing inside its window off the paper, on a page cell and in a transparent step file',
    (_id, step) => {
      // What is under the picture shows through there as it does round the window: a page's band, a selected cell's
      // tint, a step file's transparency — never the page's white laid over it.
      for (const markup of [xraySurfaces(step).page.markup, transparentFile(step)]) {
        for (const { painted } of windowsOver(markup)) expect(painted).toEqual([]);
      }
    }
  );

  it('lays the page’s white only on the faces a window takes away, where it crosses the paper’s edge', () => {
    for (const id of ['crane-edge', 'stacked-edge', 'crane-off-paper']) {
      const step = xrayCase(id);
      for (const markup of [xraySurfaces(step).page.markup, transparentFile(step)]) {
        const [window] = windowsOver(markup);
        // A part of each window is off the paper, and nothing is painted there.
        expect(window!.off.length, id).toBeGreaterThan(50);
        expect(window!.painted, id).toEqual([]);
      }
    }
    // On the flap's edge the window takes the top layer away: the white lies on it, and the faces left over it.
    const [edge] = xrayWindowsIn(xraySurfaces(xrayCase('crane-edge')).page.markup);
    expect(edge).toMatch(/<g clip-path="url\(#[^"]*clip\)"><g data-x-ray-ground="" fill="#ffffff" stroke="#ffffff" stroke-width="0\.5" stroke-linejoin="round"><path d="M/);
    // Where it takes nothing away — one layer in it — it lays no white at all: the picture's own faces, through its clip.
    expect(xrayWindowsIn(xraySurfaces(xrayCase('stacked-edge')).page.markup)[0]).not.toContain('data-x-ray-ground');
  });
});
