import { describe, expect, it } from 'vitest';

import { readPaperScene } from './paperSceneValidate';

const face = {
  kind: 'face',
  face: 3,
  side: 'front',
  rings: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
  ],
  shade: 0.5,
  hidden: false,
};

const line = {
  kind: 'line',
  role: 'edge',
  a: [0, 0],
  b: [10, 0],
  onBoundary: [true, false],
  hidden: true,
};

const scene = (items: unknown[]) => ({
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  sheet: 400,
  items,
});

describe('readPaperScene', () => {
  it('reads faces and lines back exactly', () => {
    expect(readPaperScene(scene([face, line]))).toEqual(scene([face, line]));
  });

  it('drops markup items, whatever they hold', () => {
    const hostile = {
      kind: 'markup',
      svg: '<script>alert(1)</script><a href="javascript:alert(2)"><rect/></a>',
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    };
    const read = readPaperScene(scene([face, hostile, line]));
    expect(read?.items.map((item) => item.kind)).toEqual(['face', 'line']);
    expect(JSON.stringify(read)).not.toContain('script');
  });

  it('drops an item that does not read, and keeps the rest', () => {
    const badFace = { ...face, shade: Number.NaN };
    const badLine = { ...line, role: 'cut' };
    const read = readPaperScene(scene([badFace, line, badLine]));
    expect(read?.items).toEqual([line]);
  });

  it('is null for anything that is not a scene', () => {
    expect(readPaperScene(undefined)).toBeNull();
    expect(readPaperScene({ items: [] })).toBeNull();
    expect(readPaperScene({ ...scene([]), sheet: 'big' })).toBeNull();
  });
});
