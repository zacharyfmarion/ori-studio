import { expect, it, vi } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import { xrayCase } from '../xray/xray.cases';
import * as xray from '../xray/xrayScene';
import { annotatedXRaySurface } from '../xray/xrayPaint';
import { cellPicture, layoutPicture } from './pagePictures';
import { estimateTextSetter } from './estimateTextSetter';

it('does not reconstruct x-ray layers to paint or measure a picture without an x-ray mark', () => {
  const step = { ...xrayCase('crane-edge'), annotations: [] };
  const read = vi.spyOn(xray, 'xrayFacesOf');
  try {
    expect(annotatedXRaySurface(step)).toBeNull();
    expect(layoutPicture(step, {}, DEFAULT_DIAGRAM_STYLE)).not.toBeNull();
    expect(cellPicture(step, {}, DEFAULT_DIAGRAM_STYLE,
      { pictureMm: { x: 10, y: 10, size: 60 }, mmPerUnit: null, frameMm: null },
      'page', { hanStyle: 'sc', runs: estimateTextSetter.runs })).not.toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(annotatedXRaySurface(xrayCase('crane-edge'))).not.toBeNull();
    expect(read).toHaveBeenCalledOnce();
  } finally { read.mockRestore(); }
});
