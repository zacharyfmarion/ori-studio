import { act, createRef, type Ref } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canvasDiagramInk,
  DIAGRAM_MARKS,
  REFERENCES_VIEW_MARKS,
} from './diagram/diagramInk';
import type { FoldScene } from './fold/foldScene';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { ReferencesDiagramLayer, type ReferencesDiagramLayerHandle } from './ReferencesDiagramLayer';
import type { ReferencesDiagramView } from './ReferencesCpView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A unit square folded along y = 0.5, the top half swinging down. */
const FOLD: FoldScene = {
  kind: 'cp',
  flaps: [
    {
      chord: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
      side: 1,
      polygon: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      creased: [[0, 1]],
    },
  ],
  sheetShortSide: 1,
  reach: 0.5,
};

/** A mark on the flap with its letter, and a mark on the paper that stays. */
const MODEL: StepDiagramModel = {
  sheet: { width: 1, height: 1, centre: [0.5, 0.5] },
  primitives: [
    { kind: 'point', at: [0.5, 0.75], style: 'highlight' },
    { kind: 'label', at: [0.5, 0.75], text: 'P', style: 'highlight' },
    { kind: 'point', at: [0.5, 0.25], style: 'normal' },
  ],
};

/** The unit sheet's outline, as the canvas fills it. */
const SHEET: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

const camera = (scale: number): ReferencesDiagramView => ({
  view: { origin: [0, 0], ex: [scale, 0], ey: [0, -scale] },
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const groups = () => [...(container?.querySelectorAll<SVGGElement>('g[data-fold-flap]') ?? [])];
/** The shapes drawn, one per primitive, beside the clip pair's `<defs>`. */
const shapes = () => container?.querySelectorAll('svg > :not(defs)').length;

describe('ReferencesDiagramLayer', () => {
  it('fades the symbols riding the moving paper with the pose, and keeps them faded across a re-render', () => {
    const handle = createRef<ReferencesDiagramLayerHandle>();
    const render = (view: ReferencesDiagramView) =>
      act(() =>
        root?.render(
          <ReferencesDiagramLayer
            ref={handle}
            model={MODEL}
            outline={SHEET}
            mirrored={false}
            camera={view}
            lineWidth={1}
            arrowWidth={1.4}
            fold={FOLD}
          />
        )
      );
    render(camera(100));
    // The mark on the flap and its letter; the other mark is drawn bare.
    expect(groups().map((g) => g.dataset.foldFlap)).toEqual(['0', '0']);
    expect(shapes()).toBe(3);

    act(() => handle.current?.setFoldPose({ flap: 0, angle: Math.PI / 2, press: 0 }));
    expect(groups().map((g) => g.style.opacity)).toEqual(['0', '0']);

    // The camera moves mid-fold: the picture is redrawn, the fade stays.
    render(camera(200));
    expect(groups().map((g) => g.style.opacity)).toEqual(['0', '0']);

    act(() => handle.current?.setFoldPose(null));
    expect(groups().map((g) => g.style.opacity)).toEqual(['1', '1']);
  });

  it('wraps nothing without a fold', () => {
    act(() =>
      root?.render(
        <ReferencesDiagramLayer
          model={MODEL}
          outline={SHEET}
          mirrored={false}
          camera={camera(100)}
          lineWidth={1}
          arrowWidth={1.4}
        />
      )
    );
    expect(groups()).toHaveLength(0);
    expect(shapes()).toBe(3);
  });

  // The arrow is the paper style's pen, in CSS px, whatever the crease width,
  // and never lighter than the table's (1.75 px at a line width of 1); the
  // mark's ring beside it stays on the crease pen like every other mark.
  // The ring round the point the arrow leaves is drawn in the same pen, so the
  // two are one weight.
  // The full-screen view, not a page: its rings and letters are never smaller
  // than the view's floors at the reader's line width, while a card and a page
  // keep the sizes tuned against a printed step.
  it('draws its rings and letters at the view’s own sizes, larger than a page’s', () => {
    act(() =>
      root?.render(
        <ReferencesDiagramLayer
          model={MODEL}
          outline={SHEET}
          mirrored={false}
          camera={camera(100)}
          lineWidth={1}
          arrowWidth={1.4}
        />
      )
    );
    const ink = canvasDiagramInk(1);
    const ring = container?.querySelector('.step-diagram__point');
    expect(Number(ring?.getAttribute('r'))).toBeCloseTo(REFERENCES_VIEW_MARKS.ringRadius * ink, 9);
    const letter = container?.querySelector('text');
    expect(Number(letter?.getAttribute('font-size'))).toBeCloseTo(
      REFERENCES_VIEW_MARKS.labelSize * ink,
      9
    );
    expect(REFERENCES_VIEW_MARKS.ringRadius).toBeGreaterThan(DIAGRAM_MARKS.ringRadius);
    expect(REFERENCES_VIEW_MARKS.labelSize).toBeGreaterThan(DIAGRAM_MARKS.labelSize);
  });

  it('draws the fold arrow, and the ring it leaves, at the paper style’s arrow pen', () => {
    const arrow: StepDiagramModel = {
      sheet: MODEL.sheet,
      primitives: [
        { kind: 'point', at: [0.5, 0.25], style: 'normal' },
        {
          kind: 'fold-arrow',
          out: { center: [0.5, 0.5], radius: 0.25, from: -Math.PI / 2, to: Math.PI / 2, ccw: true },
        },
      ],
    };
    const strokeWidths = () =>
      [...(container?.querySelectorAll<SVGElement>('.step-diagram__line--arrow') ?? [])].map(
        (path) => Number(path.getAttribute('stroke-width'))
      );
    const ringWidth = () =>
      Number(container?.querySelector('.step-diagram__point')?.getAttribute('stroke-width'));
    act(() =>
      root?.render(
        <ReferencesDiagramLayer
          model={arrow}
          outline={SHEET}
          mirrored={false}
          camera={camera(100)}
          lineWidth={1}
          arrowWidth={1.4}
        />
      )
    );
    // The arrow's two strokes, each drawn twice: on the paper and off it.
    expect(strokeWidths()).toEqual([1.75, 1.75, 1.75, 1.75]);
    expect(ringWidth()).toBe(1.75);
    act(() =>
      root?.render(
        <ReferencesDiagramLayer
          model={arrow}
          outline={SHEET}
          mirrored={false}
          camera={camera(100)}
          lineWidth={1}
          arrowWidth={4}
        />
      )
    );
    expect(strokeWidths()).toEqual([4, 4, 4, 4]);
    expect(ringWidth()).toBe(4);
  });
});

describe('ReferencesDiagramLayer, a letter on the paper', () => {
  // The canvas's camera maps model space without a y flip, so its projector
  // reports a mirror on the paper's front. The face a letter's halo is
  // painted in is the view's, said by the panel, not that handedness.
  const modelCamera: ReferencesDiagramView = {
    view: { origin: [0, 0], ex: [100, 0], ey: [0, 100] },
  };
  const halo = (mirrored: boolean) => {
    act(() =>
      root?.render(
        <ReferencesDiagramLayer
          model={MODEL}
          outline={SHEET}
          mirrored={mirrored}
          camera={modelCamera}
          lineWidth={1}
          arrowWidth={1.4}
        />
      )
    );
    return container?.querySelector('text')?.getAttribute('class');
  };

  it('is haloed in the face the view shows, whatever the camera’s handedness', () => {
    expect(halo(false)).toContain('step-diagram__label--on-paper');
    expect(halo(false)).not.toContain('--on-back');
    expect(halo(true)).toContain('step-diagram__label--on-back');
  });
});

describe('ReferencesDiagramLayer, a mark off the paper', () => {
  // X11: the marks take the style's ink on the paper and the theme's off it,
  // clipped to the outline the canvas fills — and while a fold plays the
  // moving flap is paper wherever it has swung, and the place it left is not.
  const clipPaths = () => {
    const [inside, outside] = [...(container?.querySelectorAll('defs > clipPath') ?? [])];
    return {
      inside: inside!,
      outside: outside!,
      rings: [...inside!.querySelectorAll('polygon')].map((p) => p.getAttribute('points')),
      rest: outside!.querySelector('path')!.getAttribute('d')!,
    };
  };
  const render = (handle?: Ref<ReferencesDiagramLayerHandle>, outline = SHEET) =>
    act(() =>
      root?.render(
        <ReferencesDiagramLayer
          ref={handle}
          model={MODEL}
          outline={outline}
          mirrored={false}
          camera={camera(100)}
          lineWidth={1}
          arrowWidth={1.4}
          fold={FOLD}
        />
      )
    );

  it('clips each mark to the paper the canvas fills, through the camera', () => {
    render();
    const { inside, outside, rings, rest } = clipPaths();
    // The camera maps y up to y down at 100 px a unit.
    expect(rings).toEqual(['0,0 100,0 100,-100 0,-100', '']);
    expect(rest).toContain('M 0 0 L 100 0 L 100 -100 L 0 -100 Z');
    const [ring] = [...(container?.querySelectorAll('.step-diagram__ground') ?? [])];
    expect(ring!.getAttribute('clip-path')).toBe(`url(#${outside.id})`);
    expect(ring!.nextElementSibling!.getAttribute('clip-path')).toBe(`url(#${inside.id})`);
    // Three marks: two rings, drawn twice; the letter once.
    expect(container?.querySelectorAll('circle')).toHaveLength(4);
    expect(container?.querySelectorAll('text')).toHaveLength(1);
  });

  it('moves the paper with the flap while a fold plays, and puts it back at rest', () => {
    const handle = createRef<ReferencesDiagramLayerHandle>();
    render(handle);
    const atRest = clipPaths();
    // Folded over: the top half has come down onto the bottom one, and the
    // top of the sheet is ground now.
    act(() => handle.current?.setFoldPose({ flap: 0, angle: Math.PI, press: 1 }));
    const folded = clipPaths();
    expect(folded.rings).toHaveLength(2);
    expect(folded.rings[0]).toBe('0,0 100,0 100,-50 0,-50');
    const [, flap] = folded.rings;
    const ys = flap!.split(' ').map((point) => Number(point.split(',')[1]));
    // The flap lies over the bottom half, hovering no higher than the hinge.
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-50 - 1e-6);
    expect(Math.max(...ys)).toBeCloseTo(0, 1);
    expect(folded.rest).not.toBe(atRest.rest);
    // A re-render mid-fold redraws the clip for the pose in force.
    render(handle);
    expect(clipPaths().rings).toEqual(folded.rings);
    act(() => handle.current?.setFoldPose(null));
    expect(clipPaths().rings).toEqual(atRest.rings);
    expect(clipPaths().rest).toBe(atRest.rest);
  });

  it('draws every mark in the ground’s ink with no paper to clip to', () => {
    render(undefined, []);
    expect(container?.querySelectorAll('clipPath')).toHaveLength(0);
    expect(container?.querySelectorAll('[clip-path]')).toHaveLength(0);
    expect(container?.querySelectorAll('.step-diagram__ground circle')).toHaveLength(2);
  });
});
