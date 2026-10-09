import { describe, expect, it } from 'vitest';
import type { DiagramStep, KnownDiagramAsset, QuarterTurns } from '../document/diagramDocument';
import { createStep, DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import { storedSceneJson } from '../document/diagramFile';
import { cpStep, fixedPicture, referencesStep, scenePicture } from '../document/diagramSteps.fixtures';
import { sheetWithCrease } from '../../lib/paper/paperScene.fixtures';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import {
  paintAsset,
  paintScene,
  paintSource,
  paintStepPicture,
  poseTransform,
  sceneMeasure,
  stepPictureSource,
} from './paintDiagramStep';
import { annotatedStepUrl, closeUpPictureUrl, stepPictureUrl } from './useStepPictureUrl';
import {
  cachedPictureUrl,
  clearStepPictureCacheForTests,
  objectSerial,
  STEP_PICTURE_CACHE_MAX_BYTES,
  stepPictureCacheBytesForTests,
  svgDataUrl,
} from './stepPictureCache';

/** Apply an SVG transform list (translate, rotate in right angles, scale) to a point. */
function apply(transform: string, [x, y]: [number, number]): [number, number] {
  const ops = [...transform.matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)].map(
    ([, name, args]) => [name, args.trim().split(/[\s,]+/).map(Number)] as const
  );
  let point: [number, number] = [x, y];
  for (const [name, args] of ops.reverse()) {
    const [px, py] = point;
    if (name === 'translate') point = [px + args[0], py + (args[1] ?? 0)];
    else if (name === 'scale') point = [px * args[0], py * (args[1] ?? args[0])];
    else {
      const turns = Math.round(args[0] / 90) % 4;
      point = turns === 1 ? [-py, px] : turns === 2 ? [-px, -py] : turns === 3 ? [py, -px] : [px, py];
    }
  }
  return point;
}

describe('poseTransform', () => {
  const corners: [number, number][] = [
    [0, 0],
    [40, 0],
    [40, 10],
    [0, 10],
  ];

  it.each([0, 1, 2, 3] as QuarterTurns[])('turns %i quarter(s) clockwise into the posed box', (turns) => {
    for (const mirrored of [false, true]) {
      const posed = poseTransform(40, 10, { rotationQuarterTurns: turns, mirrored });
      const moved = corners.map((corner) => apply(posed.transform, corner));
      // Every corner lands on a corner of the posed box.
      for (const [x, y] of moved) {
        expect([0, posed.widthPx]).toContain(Math.round(x));
        expect([0, posed.heightPx]).toContain(Math.round(y));
      }
      expect(posed.widthPx).toBe(turns % 2 ? 10 : 40);
    }
  });

  it('turns clockwise: the top-left corner goes to the top-right after one turn', () => {
    const posed = poseTransform(40, 10, { rotationQuarterTurns: 1, mirrored: false });
    expect(apply(posed.transform, [0, 0])).toEqual([10, 0]);
  });

  it('mirrors left to right before turning', () => {
    const posed = poseTransform(40, 10, { rotationQuarterTurns: 0, mirrored: true });
    expect(apply(posed.transform, [0, 0])).toEqual([40, 0]);
    const turned = poseTransform(40, 10, { rotationQuarterTurns: 1, mirrored: true });
    // Mirrored, the top-left is the top-right (40, 0); a clockwise turn takes it to the bottom-right.
    expect(apply(turned.transform, [0, 0])).toEqual([10, 40]);
  });

  it('is nothing at all upright', () => {
    expect(poseTransform(40, 10, { rotationQuarterTurns: 0, mirrored: false }).transform).toBe('');
  });
});

const svg: KnownDiagramAsset = {
  id: 'asset-a',
  kind: 'svg',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="10" viewBox="0 0 40 10"><rect width="4" height="4"/></svg>',
  widthPx: 40,
  heightPx: 10,
  bytes: 0,
};
const raster: KnownDiagramAsset = {
  id: 'asset-b',
  kind: 'raster',
  src: 'data:image/png;base64,AAAA',
  widthPx: 8,
  heightPx: 6,
  bytes: 0,
};

describe('paintAsset', () => {
  it('is an upright SVG itself', () => {
    // Its frame is the whole of it.
    expect(paintAsset(svg)).toEqual({
      svg: svg.svg,
      widthPx: 40,
      heightPx: 10,
      frame: { x: 0, y: 0, width: 40, height: 10 },
    });
  });

  it('nests a posed SVG whole, so it stays vector', () => {
    const painted = paintAsset(svg, { rotationQuarterTurns: 1, mirrored: false });
    expect(painted).toMatchObject({ widthPx: 10, heightPx: 40 });
    expect(painted.svg).toContain('viewBox="0 0 10 40"');
    expect(painted.svg).toContain(svg.svg);
    expect(new DOMParser().parseFromString(painted.svg, 'image/svg+xml').querySelector('parsererror')).toBeNull();
  });

  it('draws a bitmap as an image in its own box', () => {
    const painted = paintAsset(raster);
    expect(painted.svg).toContain('<image width="8" height="6"');
    expect(painted.svg).toContain(raster.src);
  });
});

describe('paintStepPicture', () => {
  const step = (patch: Partial<DiagramStep>): DiagramStep => ({ ...createStep(() => 'step-1'), ...patch });

  it('paints an upload in its pose, and nothing for a step without a picture it can draw', () => {
    const assets = { 'asset-a': svg };
    const upload = step({
      source: { kind: 'upload', assetId: 'asset-a', rotationQuarterTurns: 2, mirrored: false },
      picture: { kind: 'asset', assetId: 'asset-a', paperScale: null, key: 'asset:asset-a' },
    });
    const style = DEFAULT_DIAGRAM_STYLE;
    expect(paintStepPicture(upload, assets, style)?.svg).toContain('rotate(180)');
    expect(paintStepPicture(step({}), assets, style)).toBeNull();
    expect(paintStepPicture(upload, {}, style)).toBeNull();
    expect(paintStepPicture({ ...upload, unknown: { id: 'step-1' } }, assets, style)).toBeNull();
  });

  it('paints a captured scene in the diagram’s pens', () => {
    const painted = paintStepPicture(cpStep('step-1'), {}, DEFAULT_DIAGRAM_STYLE)!;
    const document = new DOMParser().parseFromString(painted.svg, 'image/svg+xml');
    expect(document.querySelector('parsererror')).toBeNull();
    // The paper and its one crease, and no page behind them.
    expect(document.querySelectorAll('path, line, polygon').length).toBeGreaterThanOrEqual(2);
    expect(painted.svg).not.toContain('<rect');
    expect(painted.widthPx).toBeGreaterThan(0);
    // Another style, other ink.
    const plain = paintStepPicture(cpStep('step-1'), {}, { style: { ...DEFAULT_PAPER_STYLE } })!;
    expect(plain.svg).not.toBe(painted.svg);
  });

  it('tells a crease pattern, measured by its sheet, from a folded model or a simulation, measured by the figure', () => {
    const flat = cpStep('step-1', { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 });
    const spatial = cpStep('step-1', { mode: 'folded-3d', camera: { yaw: 0, pitch: 0, zoom: 1 }, side: 'front' });
    const simulated = cpStep('step-1', { mode: 'simulated', foldPercent: 50, view: { yaw: 0, pitch: 0, zoom: 1 } });
    expect(stepPictureSource(cpStep('step-1'), {})).toMatchObject({ kind: 'scene', drawn: 'pattern' });
    expect(stepPictureSource(flat, {})).toMatchObject({ kind: 'scene', drawn: 'folded' });
    expect(stepPictureSource(spatial, {})).toMatchObject({ kind: 'scene', drawn: 'folded' });
    expect(stepPictureSource(simulated, {})).toMatchObject({ kind: 'scene', drawn: 'simulated' });
    expect(sceneMeasure('pattern')).toBe('sheet');
    expect(sceneMeasure('folded')).toBe('figure');
    expect(sceneMeasure('simulated')).toBe('figure');
  });

  it('draws a folded model’s folds in the edge pen, as a flat capture names them, and a simulation’s in the fold pens', () => {
    // A 3D capture names its folds mountain and valley (`paperScene.ts`): in the Diagram's style
    // the fold pens are half the edge pen, and a 3D step printed at half a flat one's weight.
    const picture = { ...scenePicture(), sceneJson: storedSceneJson(sheetWithCrease('mountain'))! };
    const edges = { width: 0.5, color: '#ff0000' as const, dash: null, cap: 'butt' as const };
    const folds = { width: 0.25, color: '#0000ff' as const, dash: null, cap: 'butt' as const };
    const pens = { style: { ...DEFAULT_PAPER_STYLE, edges, mountainFolds: folds, valleyFolds: folds } };
    const folded = paintScene({ kind: 'scene', picture, drawn: 'folded' }, pens)!.svg;
    expect(folded).not.toContain('#0000ff');
    expect(folded).toContain('#ff0000');
    expect(paintScene({ kind: 'scene', picture, drawn: 'simulated' }, pens)!.svg).toContain('#0000ff');
    expect(paintScene({ kind: 'scene', picture, drawn: 'pattern' }, pens)!.svg).toContain('#0000ff');
  });

  it('draws a crease pattern’s aux lines, the paper’s existing creases, whatever the style’s switch says', () => {
    const picture = { ...scenePicture(), sceneJson: storedSceneJson(sheetWithCrease('aux'))! };
    const auxPen = { width: 0.25, color: '#00ff00' as const, dash: null, cap: 'butt' as const };
    const hidden = { style: { ...DEFAULT_PAPER_STYLE, auxCreases: { visible: false, pen: auxPen } } };
    expect(paintScene({ kind: 'scene', picture, drawn: 'pattern' }, hidden)!.svg).toContain('#00ff00');
    // A folded model's are the style's to show or hide.
    expect(paintScene({ kind: 'scene', picture, drawn: 'folded' }, hidden)!.svg).not.toContain('#00ff00');
  });

  it('draws a fixed picture as it is stored', () => {
    const fixed = cpStep('step-1', undefined, fixedPicture());
    expect(paintStepPicture(fixed, {}, DEFAULT_DIAGRAM_STYLE)).toEqual({
      svg: fixedPicture().svg,
      widthPx: 20,
      heightPx: 10,
      frame: { x: 0, y: 0, width: 20, height: 10 },
    });
  });

  it('paints a step sent from References at the size it opens at, and its back mirrored', () => {
    const front = paintStepPicture(referencesStep('step-1'), {}, DEFAULT_DIAGRAM_STYLE)!;
    const document = new DOMParser().parseFromString(front.svg, 'image/svg+xml');
    expect(document.querySelector('parsererror')).toBeNull();
    // Its letter and arrow, drawn by the card's own marks.
    expect(front.svg).toContain('>A</text>');
    expect(stepPictureSource(referencesStep('step-1'), {})).toMatchObject({ kind: 'step-diagram' });
    const back = paintStepPicture(referencesStep('step-1', { side: 'back' }), {}, DEFAULT_DIAGRAM_STYLE)!;
    expect(back.svg).not.toBe(front.svg);
    expect(back.widthPx).toBeCloseTo(front.widthPx, 6);
  });

  it('paints nothing for a linked step not yet posed, or a scene that does not read', () => {
    expect(paintStepPicture(cpStep('step-1', undefined, null), {}, DEFAULT_DIAGRAM_STYLE)).toBeNull();
    const broken = cpStep('step-1');
    const picture = { ...(broken.picture as { sceneJson: string }), sceneJson: '{' };
    expect(paintStepPicture({ ...broken, picture } as DiagramStep, {}, DEFAULT_DIAGRAM_STYLE)).toBeNull();
  });
});

describe('a picture painted larger, for a close-up’s inside (15f)', () => {
  const style = DEFAULT_DIAGRAM_STYLE;
  const pens = (svg: string) => [...new Set([...svg.matchAll(/stroke-width="([^"]+)"/g)].map(([, width]) => width))].sort();

  it('paints a scene afresh at the scale, its frame that much larger and its pens at their print weight', () => {
    const source = stepPictureSource(cpStep('step-1'), {})!;
    const once = paintSource(source, style)!;
    const twice = paintSource(source, style, undefined, 2)!;
    expect(twice.frame.width).toBeCloseTo(2 * once.frame.width, 6);
    expect(twice.frame.height).toBeCloseTo(2 * once.frame.height, 6);
    // The margin is the pens' room, not the picture's: the same at any size.
    expect(twice.frame.x).toBeCloseTo(once.frame.x, 6);
    expect(pens(twice.svg)).toEqual(pens(once.svg));
  });

  it('builds a References step at the larger size, its letters at theirs', () => {
    const source = stepPictureSource(referencesStep('step-1'), {})!;
    const once = paintSource(source, style)!;
    const twice = paintSource(source, style, undefined, 3)!;
    expect(twice.frame.width).toBeCloseTo(3 * once.frame.width, 6);
    const sizes = (svg: string) => [...svg.matchAll(/font-size="([^"]+)"/g)].map(([, size]) => size);
    expect(sizes(twice.svg)).toEqual(sizes(once.svg));
  });

  it('draws an upload or a fixed picture larger whole, its own strokes with it', () => {
    const fixed = paintSource({ kind: 'fixed', picture: fixedPicture() }, style, undefined, 2)!;
    expect(fixed).toMatchObject({ widthPx: 40, heightPx: 20, frame: { x: 0, y: 0, width: 40, height: 20 } });
    expect(fixed.svg).toContain('width="40" height="20" viewBox="0 0 20 10"');
    expect(paintSource({ kind: 'fixed', picture: fixedPicture() }, style, undefined, 1)!.svg).toBe(fixedPicture().svg);
    const upload = paintSource({ kind: 'asset', asset: svg, pose: { rotationQuarterTurns: 0, mirrored: false } }, style, undefined, 1.5)!;
    expect(upload.widthPx).toBeCloseTo(1.5 * svg.widthPx, 9);
  });

  it('is painted inside a card’s close-up, and not in Pose, which ghosts the marks over the picture it poses', () => {
    const source = stepPictureSource(cpStep('step-1'), {})!;
    const zoom = { id: 'z', kind: 'close-up' as const, from: [0.5, 0.5] as [number, number], to: [1.3, 0.5] as [number, number], radius: 0.1, scale: 2 };
    const decoded = (url: string | null) => new TextDecoder().decode(Uint8Array.from(atob(url!.split(',')[1]!), (c) => c.charCodeAt(0)));
    const card = decoded(annotatedStepUrl(source, [zoom], style, 1, false));
    expect(card).toContain('clip-path="url(#annotation-close-up-0)"');
    const posed = decoded(annotatedStepUrl(source, [zoom], style, 0.35, false));
    expect(posed).not.toContain('clipPath');
    expect(posed.match(/<circle[^>]*fill="none"/g)).toHaveLength(2);
  });

  it('is cached for the canvas by picture, style and scale: an upload its own URL, drawn larger', () => {
    clearStepPictureCacheForTests();
    const source = stepPictureSource(cpStep('step-1'), {})!;
    const first = closeUpPictureUrl(source, style, 2)!;
    const bytes = stepPictureCacheBytesForTests();
    expect(first.url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(closeUpPictureUrl(source, style, 2)).toEqual(first);
    expect(stepPictureCacheBytesForTests()).toBe(bytes);
    expect(first.frame).toEqual(paintSource(source, style, undefined, 2)!.frame);
    const asset = { kind: 'asset' as const, asset: svg, pose: { rotationQuarterTurns: 0 as const, mirrored: false } };
    expect(closeUpPictureUrl(asset, style, 2)).toEqual({
      url: stepPictureUrl(asset, style),
      widthPx: 2 * svg.widthPx,
      heightPx: 2 * svg.heightPx,
      frame: { x: 0, y: 0, width: 2 * svg.widthPx, height: 2 * svg.heightPx },
    });
  });
});

describe('stepPictureUrl', () => {
  it('paints a scene once per picture and style, and again for another style', () => {
    clearStepPictureCacheForTests();
    const step = cpStep('step-1');
    const source = stepPictureSource(step, {})!;
    const first = stepPictureUrl(source, DEFAULT_DIAGRAM_STYLE);
    const bytes = stepPictureCacheBytesForTests();
    expect(first).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(stepPictureUrl(stepPictureSource({ ...step, text: 'edited' }, {})!, DEFAULT_DIAGRAM_STYLE)).toBe(first);
    expect(stepPictureCacheBytesForTests()).toBe(bytes);
    expect(stepPictureUrl(source, { style: { ...DEFAULT_PAPER_STYLE } })).not.toBe(first);
  });

  it('paints a picture shown for a moment — a drag’s preview — without keeping it', () => {
    clearStepPictureCacheForTests();
    const source = stepPictureSource(cpStep('step-1'), {})!;
    const url = stepPictureUrl(source, DEFAULT_DIAGRAM_STYLE, false);
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(stepPictureCacheBytesForTests()).toBe(0);
    expect(annotatedStepUrl(source, [], DEFAULT_DIAGRAM_STYLE, 1, false)).toBe(url);
    expect(stepPictureCacheBytesForTests()).toBe(0);
  });
});

describe('stepPictureUrl of a step sent from References', () => {
  it('paints it once per picture and style', () => {
    clearStepPictureCacheForTests();
    const source = stepPictureSource(referencesStep('step-1'), {})!;
    const first = stepPictureUrl(source, DEFAULT_DIAGRAM_STYLE);
    expect(first).toMatch(/^data:image\/svg\+xml;base64,/);
    const bytes = stepPictureCacheBytesForTests();
    expect(stepPictureUrl(source, DEFAULT_DIAGRAM_STYLE)).toBe(first);
    expect(stepPictureCacheBytesForTests()).toBe(bytes);
    expect(stepPictureUrl(source, { style: { ...DEFAULT_PAPER_STYLE } })).not.toBe(first);
  });
});

describe('the picture cache', () => {
  it('paints once per key, and drops the least recently used past its byte bound', () => {
    clearStepPictureCacheForTests();
    let paints = 0;
    const big = 'x'.repeat(STEP_PICTURE_CACHE_MAX_BYTES / 3 + 1);
    const paint = () => {
      paints += 1;
      return big;
    };
    cachedPictureUrl('a', paint);
    cachedPictureUrl('b', paint);
    cachedPictureUrl('a', paint); // a is now the most recent
    expect(paints).toBe(2);
    cachedPictureUrl('c', paint); // over the bound: b goes, not a
    cachedPictureUrl('a', paint);
    expect(paints).toBe(3);
    cachedPictureUrl('b', paint);
    expect(paints).toBe(4);
    expect(stepPictureCacheBytesForTests()).toBeLessThanOrEqual(STEP_PICTURE_CACHE_MAX_BYTES);
    clearStepPictureCacheForTests();
  });

  it('caches nothing for nothing to draw', () => {
    clearStepPictureCacheForTests();
    expect(cachedPictureUrl('none', () => null)).toBeNull();
    expect(stepPictureCacheBytesForTests()).toBe(0);
  });

  it('encodes markup with any character as a data URL that decodes back to it', () => {
    const markup = '<svg xmlns="http://www.w3.org/2000/svg"><text>#50% · 千纸鹤</text></svg>';
    const url = svgDataUrl(markup);
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const bytes = Uint8Array.from(atob(url.split(',')[1]), (char) => char.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(markup);
  });

  it('numbers objects, not ids', () => {
    expect(objectSerial(svg)).toBe(objectSerial(svg));
    expect(objectSerial({ ...svg })).not.toBe(objectSerial(svg));
  });
});
