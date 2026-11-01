/**
 * The Layer order panes over Oriedita's own folded figures, as the CP kernel
 * draws them in this process (`folded_figure_fold`, `folded_figure_paper_scene`,
 * front and back): the scenes the dialog's session draws are these, face for
 * face and spot for spot (`layerOrderEngine.wasm.test.ts`). On the solution
 * sample, kabuto, iguana-c0, `r271-s03` (convex faces, two of whose spots are
 * not: the faces over them leave notches) and a frame with a window cut in
 * it, whose one face and cell bend round it (the dialog refuses such a face,
 * D4, and names it on the crease pattern).
 *
 * What the panes read off a scene holds on each: every face rings the crease
 * pattern and the rings tile the paper; restacking a scene by its own stacks
 * leaves every spot's face on top where it was; every face has somewhere to
 * put its letter, and a face that shows has it on itself; a ring fits inside
 * nearly every face at the panes' scale and never outside one; X-ray's alpha
 * composes to its cover over the deepest stack.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { OristudioCpFoldedFigureResult, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { initCpWasm } from '../../engine/oristudioCpTestSupport';
import {
  folded_figure_fold,
  folded_figure_paper_scene,
  folded_figure_set_model,
  free_document,
  free_folded_figure,
  load_cp,
  load_fold_file,
  load_ori,
} from '../../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import { insideEvenOdd } from '../../cp-workspace/picking/polygonContains';
import { StackHitIndex } from '../../cp-workspace/picking/stackHitIndex';
import type { Point } from '../../lib/geometry';
import { faceLettersOf } from '../engine/faceIndex';
import { insetRing, ringInsetPx } from './faceRing';
import {
  foldedOutlinesOf,
  foldedPaneToUser,
  foldedPivot,
  paneFacesOf,
  restackedScene,
  ringArea,
  stackDepth,
  topFaces,
  XRAY_COVER,
  xrayFaceAlpha,
} from './layerPaneFigure';
import { foldedLabelIndex, paneLetters, patternLabelIndex } from './layerPaneLabels';
import { NO_FACE_MARKS, SUBJECT_RING_PX } from './layerPaneMarks';

const CP_WASM = resolve(process.cwd(), 'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm');
const FIXTURES = resolve(process.cwd(), '../../tests/fixtures');

interface Figure {
  name: string;
  front: OristudioCpFoldedPaperScene;
  back: OristudioCpFoldedPaperScene;
}

function fold(name: string, load: () => number): Figure {
  const document = load();
  const result = folded_figure_fold(document, 1, 'Order5', undefined, 0) as OristudioCpFoldedFigureResult;
  const front = folded_figure_paper_scene(result.handle) as OristudioCpFoldedPaperScene | null;
  folded_figure_set_model(result.handle, { ...result.snapshot.model, state: 'Back1' });
  const back = folded_figure_paper_scene(result.handle) as OristudioCpFoldedPaperScene | null;
  free_folded_figure(result.handle);
  free_document(document);
  if (!front || !back) throw new Error(`${name}: the kernel drew nothing`);
  return { name, front, back };
}

const text = (relative: string) => readFileSync(resolve(FIXTURES, relative), 'utf8');

let figures: Figure[] = [];

/** Each spot's stacks, packed as the engine answers them. */
function stacksOf(scene: OristudioCpFoldedPaperScene) {
  const offsets = [0];
  const faces: number[] = [];
  for (const subface of scene.subfaces) {
    faces.push(...subface.faces_top_to_bottom);
    offsets.push(faces.length);
  }
  return { offsets: new Uint32Array(offsets), faces: new Uint32Array(faces) };
}

describe.skipIf(!existsSync(CP_WASM))('the Layer order panes over Oriedita’s folded figures', () => {
  beforeAll(async () => {
    await initCpWasm();
    figures = [
      fold('solution_sample_1', () => load_cp(text('oriedita/solution_sample_1.cp'), 'sample')),
      fold('kabuto', () => load_fold_file(text('flat-folder/kabuto.fold'))),
      fold('iguana-c0', () => load_fold_file(text('precrease/iguana-c0.fold'))),
      fold('r271-s03', () => load_fold_file(text('flat-folder/r271-s03.fold'))),
      fold('holed_frame_collinear', () => load_ori(text('oriedita/holed_frame_collinear.ori'), false)),
    ];
  }, 600_000);

  it('rings every face on the crease pattern, the rings tiling the paper, the same from either side', () => {
    const rows: string[] = [];
    for (const { name, front, back } of figures) {
      const faces = paneFacesOf(front);
      expect(paneFacesOf(back).pattern, name).toEqual(faces.pattern);
      expect(faces.pattern.every((ring) => ring.length >= 3), name).toBe(true);
      const tiled = faces.pattern.reduce((sum, ring) => sum + ringArea(ring), 0);
      const outlines = foldedOutlinesOf(front).reduce((sum, ring) => sum + ringArea(ring), 0);
      // Folding keeps every face's area.
      expect(tiled / outlines, name).toBeCloseTo(1, 6);
      const cells = new StackHitIndex(front.subfaces).cells;
      rows.push(
        `${name}: ${front.faces.length} faces, ${front.subfaces.length} spots (${cells.filter((cell) => !cell.convex).length} non-convex), ${stackDepth(front)} deep`
      );
    }
    console.info(rows.join('\n'));
    // Cells that bend: round the frame's window, and round r271-s03's notches over convex faces.
    for (const name of ['holed_frame_collinear', 'r271-s03']) {
      const { front } = figures.find((figure) => figure.name === name)!;
      expect(new StackHitIndex(front.subfaces).cells.some((cell) => !cell.convex), name).toBe(true);
    }
  });

  it('restacking a scene by its own stacks keeps every spot’s face on top', () => {
    for (const { name, front, back } of figures) {
      for (const scene of [front, back]) {
        expect(topFaces(restackedScene(scene, stacksOf(scene))), name).toEqual(topFaces(scene));
      }
    }
  });

  it('gives every face somewhere for its letter, and a face that shows its letter on itself', () => {
    for (const { name, front, back } of figures) {
      for (const scene of [front, back]) {
        const all = scene.faces.map((_, face) => face);
        const spotsOf = foldedLabelIndex(scene);
        const onTop = new Set(topFaces(scene));
        for (const face of all) {
          const spots = spotsOf(face)!;
          expect(spots.spots.length, `${name} face ${face}`).toBeGreaterThan(0);
          expect(spots.visible, `${name} face ${face}`).toBe(onTop.has(face));
          if (spots.visible) {
            const outline = scene.faces[face]!.outline;
            // A convex face holds its spots' centres.
            expect(insideEvenOdd(outline, spots.spots[0]!.at, scene.sheet * 1e-9), `${name} face ${face}`).toBe(true);
          }
          // Each spot inside the region a chip there must stay in.
          for (const { at, region } of spots.spots) {
            expect(insideEvenOdd(region, at, scene.sheet * 1e-9), `${name} face ${face}`).toBe(true);
          }
        }
      }
    }
  });

  it('offers every face on the crease pattern several spots inside it', () => {
    for (const { name, front } of figures) {
      const { pattern } = paneFacesOf(front);
      const spotsOf = patternLabelIndex(pattern);
      let several = 0;
      pattern.forEach((ring, face) => {
        const spots = spotsOf(face)!;
        expect(spots.spots.length, `${name} face ${face}`).toBeGreaterThan(0);
        for (const { at } of spots.spots) expect(insideEvenOdd(ring, at, front.sheet * 1e-9), `${name} face ${face}`).toBe(true);
        if (spots.spots.length > 1) several += 1;
      });
      expect(several, name).toBe(pattern.length);
    }
  });

  it('letters every face of a subject on kabuto: none past the cap', () => {
    const { front } = figures.find(({ name }) => name === 'kabuto')!;
    const letters = faceLettersOf(front);
    const faces = paneFacesOf(front);
    const pickable = front.faces.map((_, face) => face).filter((face) => face !== 0);
    const { labels, pastCap } = paneLetters(
      { ...NO_FACE_MARKS, picking: 'object', subject: 0, pickable },
      faces.patternCentroids
    );
    expect(pastCap).toEqual([]);
    expect(labels.map(({ face }) => letters.letterOf(face)).every((letter) => letter !== '')).toBe(true);
  });

  it('fits a ring inside nearly every face at the panes’ scale, and never outside one', () => {
    const rows: string[] = [];
    for (const { name, front } of figures) {
      // The folded paper fitted to a 500 px pane: that many px across its longest side.
      const toUser = foldedPaneToUser(0, foldedPivot(front));
      const outlines = foldedOutlinesOf(front).map((ring) => ring.map(toUser));
      const xs = outlines.flat().map(({ x }) => x);
      const ys = outlines.flat().map(({ y }) => y);
      const scale = 500 / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const px = (ring: Point[]) => ring.map(({ x, y }) => ({ x: x * scale, y: y * scale }));
      const inset = ringInsetPx(SUBJECT_RING_PX);
      let fitted = 0;
      for (const ring of outlines.map(px)) {
        const inner = insetRing(ring, inset);
        if (!inner) continue;
        fitted += 1;
        for (const corner of inner) expect(insideEvenOdd(ring, corner), name).toBe(true);
      }
      rows.push(`${name}: a 2 px ring fits ${fitted} of ${outlines.length} faces at a 500 px fit`);
      expect(fitted / outlines.length, name).toBeGreaterThan(0.9);
    }
    console.info(rows.join('\n'));
  });

  it('shares X-ray’s cover out over the deepest stack of each', () => {
    for (const { front } of figures) {
      const depth = stackDepth(front);
      expect(1 - (1 - xrayFaceAlpha(depth)) ** depth).toBeCloseTo(XRAY_COVER, 9);
    }
  });
});
