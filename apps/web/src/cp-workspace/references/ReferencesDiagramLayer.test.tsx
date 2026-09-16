import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('ReferencesDiagramLayer', () => {
  it('fades the symbols riding the moving paper with the pose, and keeps them faded across a re-render', () => {
    const handle = createRef<ReferencesDiagramLayerHandle>();
    const render = (view: ReferencesDiagramView) =>
      act(() =>
        root?.render(
          <ReferencesDiagramLayer ref={handle} model={MODEL} camera={view} lineWidth={1} fold={FOLD} />
        )
      );
    render(camera(100));
    // The mark on the flap and its letter; the other mark is drawn bare.
    expect(groups().map((g) => g.dataset.foldFlap)).toEqual(['0', '0']);
    expect(container?.querySelectorAll('svg > *').length).toBe(3);

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
      root?.render(<ReferencesDiagramLayer model={MODEL} camera={camera(100)} lineWidth={1} />)
    );
    expect(groups()).toHaveLength(0);
    expect(container?.querySelectorAll('svg > *').length).toBe(3);
  });
});
