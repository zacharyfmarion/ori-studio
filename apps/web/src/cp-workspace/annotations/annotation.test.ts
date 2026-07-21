import { describe, expect, it } from 'vitest';
import { createCpImage } from '../images/cpImage';
import {
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
