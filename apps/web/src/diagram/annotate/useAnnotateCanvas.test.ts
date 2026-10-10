import { describe, expect, it } from 'vitest';
import { createDiagram, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { zoomedSource } from '../zoom/paintZoomed';
import { annotateFitRect, pastedRect, zoomedCanvasLayout } from './useAnnotateCanvas';

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

  it('takes in an x-ray’s window only where its step draws it: a picture with the layers it cuts into (review of 18e)', () => {
    const xray: KnownDiagramAnnotation = { id: 'xray', kind: 'x-ray', from: [1.5, 0.5], to: [1.5, 0.5], radius: 0.3, depth: 1 };
    const bare = annotateFitRect(layout, [], style, false);
    expect(annotateFitRect(layout, [xray], style, false)).toEqual(bare);
    expect(annotateFitRect(layout, [xray], style, false, true).width).toBeGreaterThan(bare.width);
  });
});

describe('what a paste brings into view (18d review)', () => {
  const step = cpStep('step-zoom');
  const enlarged = {
    ...step,
    zoom: { from: 'area-1', shape: 'circle' as const, frame: { centre: [0.5, 0.4] as [number, number], radius: 0.15 } },
    annotatedPictureKey: step.picture!.key,
  };
  const layout = zoomedCanvasLayout(zoomedSource(enlarged, {})!)!;
  const star = (id: string, at: [number, number]): KnownDiagramAnnotation => ({ id, kind: 'star', from: at, to: at });

  it('is the pasted marks the canvas draws, in world px: beside an enlarged step’s window too, out of its fit', () => {
    // Where a star from another picture's whole step lands beside the window, at the same place on the picture.
    const beside = star('beside', [-0.54, 1.27]);
    const rect = pastedRect(layout, [star('kept', [0.5, 0.5]), beside], ['beside'])!;
    const [x, y] = [layout.frame.x - 0.54 * layout.unit, layout.frame.y + 1.27 * layout.unit];
    expect(rect.x).toBeLessThan(x);
    expect(rect.x + rect.width).toBeGreaterThan(x);
    expect(rect.y).toBeLessThan(y);
    expect(rect.y + rect.height).toBeGreaterThan(y);
    expect(rect.width).toBeLessThan(0.2 * layout.unit);
    expect(rect.y).toBeGreaterThan(layout.picture.y + layout.picture.height);
  });

  it('is nothing when the canvas draws none of them', () => {
    expect(pastedRect(layout, [star('kept', [0.5, 0.5])], ['far'])).toBeNull();
  });
});
