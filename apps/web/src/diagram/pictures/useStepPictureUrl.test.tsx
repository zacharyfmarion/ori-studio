import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createStep, DEFAULT_DIAGRAM_STYLE, type DiagramStep } from '../document/diagramDocument';
import { scenePicture } from '../document/diagramSteps.fixtures';
import { createAnnotation } from '../annotate/annotationModel';
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
