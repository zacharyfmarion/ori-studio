import { describe, expect, it } from 'vitest';
import { createCpImage } from '../images/cpImage';
import {
  annotationAtModelPoint,
  flattenTextAnnotations,
  isImageAnnotation,
  isTextAnnotation,
  type CanvasAnnotation,
} from './annotation';
import { createTextAnnotation, textDocFromPlainText } from './textAnnotation';

function image(): CanvasAnnotation {
  return createCpImage({
    src: 'data:image/png;base64,AAAA',
    naturalWidth: 10,
    naturalHeight: 10,
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
  });
}

describe('annotation guards', () => {
  it('narrow by kind', () => {
    const img = image();
    const text = createTextAnnotation({ center: { x: 0, y: 0 } });
    expect(isImageAnnotation(img)).toBe(true);
    expect(isTextAnnotation(img)).toBe(false);
    expect(isTextAnnotation(text)).toBe(true);
    expect(isImageAnnotation(text)).toBe(false);
  });
});

describe('flattenTextAnnotations', () => {
  it('projects only text boxes to {x,y,text} using the box center + plain text', () => {
    const annotations: CanvasAnnotation[] = [
      image(),
      createTextAnnotation({ center: { x: 2, y: -3 }, doc: textDocFromPlainText('hello\nworld') }),
      image(),
      createTextAnnotation({ center: { x: 0.5, y: 0.25 }, doc: textDocFromPlainText('label') }),
    ];
    expect(flattenTextAnnotations(annotations)).toEqual([
      { x: 2, y: -3, text: 'hello\nworld' },
      { x: 0.5, y: 0.25, text: 'label' },
    ]);
  });

  it('returns an empty list when there are no text boxes', () => {
    expect(flattenTextAnnotations([image()])).toEqual([]);
  });
});

describe('annotationAtModelPoint', () => {
  const box = createTextAnnotation({ center: { x: 5, y: 5 }, width: 4, height: 2, z: 1 });

  it('hits a box that contains the point', () => {
    expect(annotationAtModelPoint([box], { x: 6, y: 5.5 })?.id).toBe(box.id);
    expect(annotationAtModelPoint([box], { x: 5, y: 5 })?.id).toBe(box.id);
  });

  it('misses outside the box', () => {
    expect(annotationAtModelPoint([box], { x: 8, y: 5 })).toBeNull();
    expect(annotationAtModelPoint([box], { x: 5, y: 7 })).toBeNull();
  });

  it('returns the topmost (highest z) among overlapping boxes', () => {
    const lower = createTextAnnotation({ center: { x: 5, y: 5 }, width: 4, height: 2, z: 0 });
    const upper = createTextAnnotation({ center: { x: 5, y: 5 }, width: 4, height: 2, z: 5 });
    expect(annotationAtModelPoint([lower, upper], { x: 5, y: 5 })?.id).toBe(upper.id);
  });

  it('skips hidden and locked annotations', () => {
    const hidden = createTextAnnotation({
      center: { x: 5, y: 5 },
      width: 4,
      height: 2,
      hidden: true,
    });
    const locked = createTextAnnotation({
      center: { x: 5, y: 5 },
      width: 4,
      height: 2,
      locked: true,
    });
    expect(annotationAtModelPoint([hidden, locked], { x: 5, y: 5 })).toBeNull();
  });
});
