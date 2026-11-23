import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { face, line, SQUARE } from '../../lib/paper/paperScene.fixtures';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { createStep, DEFAULT_DIAGRAM_STYLE, type DiagramStep, type DiagramStyle } from '../document/diagramDocument';
import { scenePicture } from '../document/diagramSteps.fixtures';
import { createAnnotation } from '../annotate/annotationModel';
import { annotation, sceneStep } from '../annotate/pictureSnap.fixtures';
import { viewGeometry } from '../zoom/stepView';
import { xrayFacesOf } from '../xray/xrayScene';
import { xrayCase } from '../xray/xray.cases';
import { useStepPictureUrl } from './useStepPictureUrl';
vi.mock('../zoom/stepView', async (original) => {
  const actual = await original<typeof import('../zoom/stepView')>();
  return { ...actual, viewGeometry: vi.fn(actual.viewGeometry) };
});
vi.mock('../xray/xrayScene', async (original) => {
  const actual = await original<typeof import('../xray/xrayScene')>();
  return { ...actual, xrayFacesOf: vi.fn(actual.xrayFacesOf) };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function Card({ step }: { step: DiagramStep }) {
  const url = useStepPictureUrl(step, {}, DEFAULT_DIAGRAM_STYLE);
  return <img src={url ?? undefined} alt="Step" />;
}
it('paints immediately without building annotation or X-ray geometry until marks need it', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const step = { ...createStep(), picture: scenePicture() };
  try {
    act(() => root.render(<Card step={step} />));
    expect(host.querySelector('img')?.src).toContain('data:image/svg+xml');
    expect(viewGeometry).not.toHaveBeenCalled();
    expect(xrayFacesOf).not.toHaveBeenCalled();
    const marked = {
      ...step,
      annotations: [createAnnotation('circle', [0.2, 0.2], [0.4, 0.4], { width: 1, height: 1 })],
    };
    act(() => root.render(<Card step={marked} />));
    expect(viewGeometry).toHaveBeenCalled();
    expect(xrayFacesOf).not.toHaveBeenCalled();
    act(() => root.render(<Card step={xrayCase('crane-edge')} />));
    expect(xrayFacesOf).toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
  }
});

it('leaves a picture’s line out of a card under a line mark drawn along it', () => {
  // A precrease in a pen of its own colour, and a valley drawn along it.
  const style: DiagramStyle = {
    style: { ...DEFAULT_PAPER_STYLE, auxCreases: { visible: true, pen: { ...DEFAULT_PAPER_STYLE.auxCreases.pen, color: '#00aa11' } } },
  };
  const precrease = sceneStep([face([SQUARE]), line('aux', [0, 50], [100, 50])]);
  const marked = { ...precrease, annotations: [annotation({ kind: 'valley-line', from: [0, 0.5], to: [1, 0.5] })] };
  const circled = { ...precrease, annotations: [annotation({ kind: 'circle', from: [0.5, 0.5], to: [0.5, 0.5] })] };
  function Styled({ step }: { step: DiagramStep }) {
    const url = useStepPictureUrl(step, {}, style);
    return <img src={url ?? undefined} alt="Step" />;
  }
  const precreases = (host: HTMLElement) => {
    const base64 = host.querySelector('img')!.src.replace(/^data:image\/svg\+xml;base64,/, '');
    const svg = new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
    return (svg.match(/stroke="#00aa11"/g) ?? []).length;
  };
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    act(() => root.render(<Styled step={circled} />));
    expect(precreases(host)).toBe(1);
    act(() => root.render(<Styled step={marked} />));
    expect(precreases(host)).toBe(0);
  } finally {
    act(() => root.unmount());
  }
});
