import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PaperLineItem, PaperScene } from '@treemaker/origami-simulator';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import type { OristudioCpFolded3dAuxLines, OristudioCpFolded3dRenderModel } from '../../engine/oristudioCpTypes';
import { DEFAULT_FOLDED_3D_CAMERA, type FoldedFigureCamera } from './folded3dCamera';
import { folded3dMesh } from './folded3dMesh';
import { folded3dPaperScene, folded3dSceneCamera } from './folded3dScene';
import { folded3dWindowRenderSettings } from './folded3dWindow';
import {
  BACKGROUND,
  INK,
  WINDOW_PARITY_BOX as BOX,
  compareWithWindow,
  folded3dPictureCreases,
  inkMask,
  liveFolded3dView,
  ownPaperCheck,
  pictureLines,
  pictureRaster,
  windowPicture,
  type OwnPaperLine,
  type PaperRaster,
} from './folded3dWindowParity.testSupport';

/**
 * The comparison itself: a line the scene draws over paper the window shows
 * bare is counted, and put down to the role of the line that drew it, which is
 * how the diagram corpus tells a buried aux line drawn on top from the concave
 * creases the window loses.
 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const model = JSON.parse(readFileSync(join(FIXTURES, 'box_90.rendermodel.json'), 'utf8')) as OristudioCpFolded3dRenderModel;

function setup() {
  const built = folded3dMesh(model);
  if (built.kind !== 'mesh') throw new Error(`expected a mesh, got ${built.kind}`);
  const camera = folded3dSceneCamera(DEFAULT_FOLDED_3D_CAMERA, built.mesh, BOX);
  const scene = folded3dPaperScene(built.mesh, model, camera, {
    style: DEFAULT_PAPER_STYLE,
    markHidden: true,
    // The kernel's shipped `Fold3dTolerances::DEFAULT`, as folded3dScene.test.ts uses.
    tolerances: { angle_radians: 1e-7, distance_relative: 1e-6, flat_snap_degrees: 1e-6, overlap_area_relative: 1e-9 },
  });
  return { mesh: built.mesh, camera, scene };
}

/** A pixel whose neighbourhood the window shows as bare paper, far from any of its ink. */
function bareInterior(window: ReturnType<typeof windowPicture>): [number, number] {
  const ink = inkMask(window, 14);
  for (let y = 0; y < BOX; y += 1) {
    for (let x = 0; x < BOX; x += 1) {
      const at = y * BOX + x;
      const id = window.id[at]!;
      if (id !== BACKGROUND && id < INK && !ink[at]) return [x, y];
    }
  }
  throw new Error('the window shows no bare paper');
}

describe('the window comparison', () => {
  it('puts ink drawn over bare paper down to the line that drew it', () => {
    const { mesh, camera, scene } = setup();
    const before = compareWithWindow(mesh, scene, camera);
    expect(before.spuriousInkByRole.aux).toBeUndefined();

    const [x, y] = bareInterior(windowPicture(mesh, camera, 1.5));
    const stray: PaperLineItem = {
      kind: 'line',
      role: 'aux',
      a: [x - 6, y + 0.5],
      b: [x + 6, y + 0.5],
      onBoundary: [false, false],
      hidden: false,
    };
    const drawnOnTop: PaperScene = { ...scene, items: [...scene.items, stray] };
    const after = compareWithWindow(mesh, drawnOnTop, camera);

    expect(after.spuriousInkByRole.aux).toBeGreaterThan(0);
    expect(after.linesWithSpuriousInk.aux).toBe(1);
    expect(after.spuriousInk - before.spuriousInk).toBe(after.spuriousInkByRole.aux);
    expect(after.missingInk).toBe(before.missingInk);
  });
});

/**
 * The self-check: a line shows only on its own paper, in the live window as
 * its own draws are replayed, and in a picture. Nothing to compare with, so it
 * runs at any camera.
 */
describe('a line shows only on its own paper', () => {
  const settings = folded3dWindowRenderSettings({ style: DEFAULT_PAPER_STYLE, displayStyle: 'Paper5', devicePixelRatio: 1 });
  const TOLERANCES = { angle_radians: 1e-7, distance_relative: 1e-6, flat_snap_degrees: 1e-6, overlap_area_relative: 1e-9 };
  const fixture = (name: string) =>
    JSON.parse(readFileSync(join(FIXTURES, `${name}.rendermodel.json`), 'utf8')) as OristudioCpFolded3dRenderModel;
  const meshOf = (model: OristudioCpFolded3dRenderModel, aux?: OristudioCpFolded3dAuxLines) => {
    const built = folded3dMesh(model, aux);
    if (built.kind !== 'mesh') throw new Error(`expected a mesh, got ${built.kind}`);
    return built.mesh;
  };

  it('replays the live window from the draws it makes, as the window model draws it', () => {
    const { mesh, camera } = setup();
    const live = liveFolded3dView(mesh, settings).render(camera);
    const window = windowPicture(mesh, camera, 1.5);
    let paper = 0;
    let agree = 0;
    for (let at = 0; at < BOX * BOX; at += 1) {
      const id = window.id[at]!;
      if (id === BACKGROUND || id >= INK || live.frame.ink[at]! >= 0) continue;
      paper += 1;
      if (live.frame.face[at] === id) agree += 1;
    }
    expect(paper).toBeGreaterThan(5000);
    expect(agree / paper).toBeGreaterThan(0.99);
    // Read from the draws, not restated: the live settings' crease bias and depth write.
    expect(live.frame.depth.creaseBias).toEqual([settings.creaseDepthBias]);
    expect(live.frame.depth.creaseWritesDepth).toEqual([settings.creaseWritesDepth]);
    expect(live.check.foreign.aux ?? 0).toBe(0);
  });

  it('counts a buried aux line drawn over the layers that cover it as ink over paper not its own', () => {
    // folded3dScene.test.ts's pinwheel: an aux line on the base (face 1)
    // along the left arm's free edge, where the top arm covers both.
    const model = fixture('pinwheel');
    const mesh = meshOf(model, { faces: [1], points: [25, 0, 0, 25, -25, 0] });
    const check = (scene: PaperScene, camera: ReturnType<typeof folded3dSceneCamera>) => {
      const raster = pictureRaster(scene, BOX, BOX);
      return ownPaperCheck(raster, pictureLines(scene, raster, folded3dPictureCreases(mesh, camera)));
    };
    let buried = 0;
    for (let yawStep = 0; yawStep < 4; yawStep += 1) {
      for (const tiltDeg of [0, 30, 60, 100, 140]) {
        const view: FoldedFigureCamera = { yaw: (yawStep / 4) * Math.PI * 2 + 0.2, pitch: -Math.PI / 2 + (tiltDeg / 180) * Math.PI, zoom: 1 };
        const camera = folded3dSceneCamera(view, mesh, BOX);
        const scene = folded3dPaperScene(mesh, model, camera, { style: DEFAULT_PAPER_STYLE, markHidden: true, tolerances: TOLERANCES });
        const aux = scene.items.filter((item): item is PaperLineItem => item.kind === 'line' && item.role === 'aux');
        if (aux.length === 0 || !aux.every((line) => line.hidden)) continue;
        buried += 1;
        const label = `yaw ${yawStep} tilt ${tiltDeg}`;
        const kept = check(scene, camera);
        expect(kept.foreign.aux ?? 0, `${label}: the picture as built`).toBe(0);
        expect(kept.unchecked, `${label}: every line found its crease`).toBe(0);
        // 90591a0ca's picture: the buried line moved past the faces over it, and shown.
        const onTop: PaperScene = {
          ...scene,
          items: [...scene.items.filter((item) => !aux.includes(item as PaperLineItem)), ...aux.map((line) => ({ ...line, hidden: false }))],
        };
        expect(check(onTop, camera).foreign.aux ?? 0, `${label}: the line drawn on top`).toBeGreaterThan(5);
      }
    }
    expect(buried).toBeGreaterThan(0);
  });

  it('counts ink over another face, and a line missing where its own paper shows', () => {
    const width = 40;
    const height = 20;
    const raster: PaperRaster = {
      width,
      height,
      face: Int32Array.from({ length: width * height }, (_, at) => (at % width < 20 ? 1 : 2)),
      side: new Int8Array(width * height).fill(1),
      ink: new Int32Array(width * height).fill(-1),
    };
    // Face 1's line, drawn on across face 2.
    for (let x = 2; x < 38; x += 1) raster.ink[10 * width + x] = 0;
    // Face 2's line, its ink missing for six pixels.
    for (let x = 22; x < 38; x += 1) if (x < 26 || x > 31) raster.ink[4 * width + x] = 1;
    const lines: OwnPaperLine[] = [
      { role: 'aux', own: new Set([1]), group: 0, from: [2, 10.5], to: [38, 10.5], halfWidthPx: 0.5 },
      { role: 'edge', own: new Set([2]), group: 1, from: [22, 4.5], to: [38, 4.5], halfWidthPx: 0.5 },
    ];
    const record = ownPaperCheck(raster, lines);
    // Past two pixels of face 1, every pixel of its line is over face 2.
    expect(record.foreign).toEqual({ aux: 16 });
    expect(record.foreignLines).toEqual({ aux: 1 });
    // A pixel's reach either way: four of the six missing pixels are gaps.
    expect(record.gaps).toEqual({ edge: 4 });
    expect(record.gapLines).toEqual({ edge: 1 });
  });
});
