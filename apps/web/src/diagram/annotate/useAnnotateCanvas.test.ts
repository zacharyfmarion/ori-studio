import { describe, expect, it } from 'vitest';
import { createDiagram, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { zoomedSource } from '../zoom/paintZoomed';
import { annotateFitRect, zoomedCanvasLayout } from './useAnnotateCanvas';

describe('what Annotate’s fit frames on an enlarged step (Zach, 2026-10-07)', () => {
  const step = cpStep('step-zoom');
  const enlarged = {
    ...step,
    zoom: { from: 'area-1', shape: 'circle' as const, frame: { centre: [0.5, 0.4] as [number, number], radius: 0.15 } },
    annotatedPictureKey: step.picture!.key,
  };
  const style = createDiagram().style;
  const layout = zoomedCanvasLayout(zoomedSource(enlarged, {})!)!;
  const line = (id: string, from: [number, number], to: [number, number]): KnownDiagramAnnotation => ({ id, kind: 'valley-line', from, to });
  // Duplicate Step's copy of a long crease, from the window to eight windows under it; and a mark a window off it.
  const copied = [line('long', [0.5, 0.4], [0.5, 8]), line('beside', [1.3, 0.5], [1.7, 0.5])];

  it('is its window, whatever marks reach out of it or lie off it', () => {
    expect(annotateFitRect(layout, copied, style, true)).toEqual(annotateFitRect(layout, [], style, true));
    expect(annotateFitRect(layout, [], style, true)).toEqual(layout.picture);
  });

  it('would take them in on a step that shows its whole picture', () => {
    const whole = annotateFitRect(layout, copied, style, false);
    expect(whole.height).toBeGreaterThan(5 * layout.picture.height);
  });
});
