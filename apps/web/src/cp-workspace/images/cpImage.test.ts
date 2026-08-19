import { describe, expect, it } from 'vitest';
import {
  cpImageEmbeddedBytes,
  createCpImage,
  defaultCpImageCrop,
  totalCpImageBytes,
  validateCpImages,
  type CpImage,
} from './cpImage';

function baseImage(overrides: Partial<CpImage> = {}): CpImage {
  return createCpImage({
    id: 'image-1',
    src: 'data:image/png;base64,AAAA',
    naturalWidth: 100,
    naturalHeight: 80,
    center: { x: 0, y: 0 },
    width: 1,
    height: 0.8,
    ...overrides,
  });
}

describe('createCpImage', () => {
  it('fills defaults for optional fields', () => {
    const image = baseImage();
    expect(image.rotation).toBe(0);
    expect(image.crop).toEqual(defaultCpImageCrop());
    expect(image.opacity).toBe(1);
    expect(image.locked).toBe(false);
    expect(image.hidden).toBe(false);
    expect(image.z).toBe(0);
  });

  it('generates an id when none is supplied', () => {
    const image = createCpImage({
      src: 'data:image/png;base64,AAAA',
      naturalWidth: 10,
      naturalHeight: 10,
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
    });
    expect(image.id).toMatch(/^image-/);
  });

  it('copies center and crop rather than aliasing them', () => {
    const center = { x: 1, y: 2 };
    const crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    const image = baseImage({ center, crop });
    center.x = 999;
    crop.w = 999;
    expect(image.center).toEqual({ x: 1, y: 2 });
    expect(image.crop).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  });
});

describe('byte accounting', () => {
  it('sums embedded base64 payload lengths', () => {
    const a = baseImage({ id: 'a', src: 'data:image/png;base64,AAAA' });
    const b = baseImage({ id: 'b', src: 'data:image/png;base64,BBBBBB' });
    expect(cpImageEmbeddedBytes(a)).toBe(a.src.length);
    expect(totalCpImageBytes([a, b])).toBe(a.src.length + b.src.length);
  });
});

describe('validateCpImages', () => {
  it('returns [] for non-arrays', () => {
    expect(validateCpImages(null)).toEqual([]);
    expect(validateCpImages({})).toEqual([]);
    expect(validateCpImages(undefined)).toEqual([]);
  });

  it('keeps a well-formed image and normalizes it', () => {
    const [image] = validateCpImages([
      {
        id: 'x',
        src: 'data:image/png;base64,AAAA',
        naturalWidth: 20,
        naturalHeight: 10,
        center: { x: 3, y: 4 },
        width: 2,
        height: 1,
        rotation: 0.5,
        crop: { x: 0, y: 0, w: 1, h: 1 },
        opacity: 0.25,
        locked: true,
        hidden: true,
        z: 5,
      },
    ]);
    expect(image).toMatchObject({
      id: 'x',
      naturalWidth: 20,
      center: { x: 3, y: 4 },
      opacity: 0.25,
      locked: true,
      hidden: true,
      z: 5,
    });
  });

  it('drops entries missing required geometry or src', () => {
    expect(validateCpImages([{ id: 'a', src: '' }])).toEqual([]);
    expect(validateCpImages([{ id: 'a', src: 'data:...', naturalWidth: 10 }])).toEqual([]); // missing center/size
    expect(
      validateCpImages([
        {
          src: 'data:...',
          naturalWidth: 10,
          naturalHeight: 10,
          center: { x: 0, y: 0 },
          width: 0, // non-positive → dropped
          height: 1,
        },
      ]),
    ).toEqual([]);
  });

  it('clamps opacity and defaults an invalid crop', () => {
    const [image] = validateCpImages([
      {
        src: 'data:image/png;base64,AAAA',
        naturalWidth: 10,
        naturalHeight: 10,
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        opacity: 5,
        crop: { x: 0, y: 0, w: -1, h: 1 },
      },
    ]);
    expect(image.opacity).toBe(1);
    expect(image.crop).toEqual(defaultCpImageCrop());
  });
});
