import { face, sceneOf } from '../../lib/paper/paperScene.fixtures';
import type { ScenePoint } from '../../lib/paper/paperScene';
import type { DiagramPaperFaces, DiagramStep } from '../document/diagramDocument';
import { storedSceneJson } from '../document/diagramFile';
import { cpStep } from '../document/diagramSteps.fixtures';
import { FLAT } from '../annotate/pictureSnap.fixtures';

/** A square from `a` to `b`, corner for corner the way a ring turns on the page. */
const square = (a: number, b: number): ScenePoint[] => [
  [a, a],
  [b, a],
  [b, b],
  [a, b],
];

/**
 * A hand-built flat fold of three layers, its stored scene in the fixture
 * sheet's 100 px (a scene px a hundredth of a picture unit): the paper's whole
 * square at the back (face 0, level 2); a small square in the middle, buried —
 * the stored scene, with no spread, drops it (face 2, level 1); and over both
 * a larger square on top (face 1, level 0), its corners clear of the buried
 * one's. Each face on the paper is its ring on the picture a hundredth the
 * size, so each shows the paper's front; the top one's turned over, its back.
 */
export function stackedStep(): DiagramStep {
  const rings = { back: square(0, 100), top: square(20, 60), buried: square(30, 50) };
  const scene = sceneOf([
    face([rings.back], { face: 0, side: 'front', outline: 'edge' }),
    face([rings.top], { face: 1, side: 'back', outline: 'edge' }),
  ]);
  const points: [number, number, number, number][] = [];
  const ring = (picture: ScenePoint[], mirrored: boolean) =>
    picture.map(([x, y]) => {
      points.push([mirrored ? -x / 100 : x / 100, y / 100, x, y]);
      return points.length - 1;
    });
  const faces: DiagramPaperFaces = {
    points,
    rings: [ring(rings.back, false), ring(rings.top, true), ring(rings.buried, false)],
    levels: [2, 0, 1],
  };
  const sceneJson = storedSceneJson(scene);
  if (sceneJson === null) throw new Error('a scene the file refuses');
  return cpStep('step-stacked', FLAT, {
    kind: 'scene',
    sceneJson,
    paperScale: 1,
    styleKey: null,
    key: 'scene-stacked',
    paperFaces: JSON.stringify(faces),
  });
}

/** A rectangle from (`x0`, `y0`) to (`x1`, `y1`), corner for corner the way a ring turns on the page. */
const rect = (x0: number, y0: number, x1: number, y1: number): ScenePoint[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/**
 * A hand-built flat fold of five faces whose stored order puts two faces that
 * never meet the other way round from a face it dropped between them (review
 * of 18e): `back` (face 1, level 2) at the back; `buried` (face 4, level 1)
 * over part of it, dropped — the stored scene, with no spread, keeps only the
 * faces that show; and three on top (level 0): `cover` (face 3) over both,
 * `beside` (face 0) over the buried one's other end and clear of `back`, edge
 * to edge with `cover`, and `apart` (face 2) clear of them all. The stored
 * order, [beside, back, apart, cover], is a true one — `beside` never meets
 * `back` — but chained face to face it would put `beside` before `back`, which
 * must come before `buried`, which must come before `beside`.
 */
export function knotStep(): DiagramStep {
  const rings = {
    beside: rect(42, 0, 70, 40),
    back: rect(0, 0, 40, 40),
    apart: rect(75, 60, 95, 90),
    cover: rect(10, 5, 42, 35),
    buried: rect(20, 10, 60, 30),
  };
  const scene = sceneOf([
    face([rings.beside], { face: 0, side: 'front', outline: 'edge' }),
    face([rings.back], { face: 1, side: 'front', outline: 'edge' }),
    face([rings.apart], { face: 2, side: 'front', outline: 'edge' }),
    face([rings.cover], { face: 3, side: 'front', outline: 'edge' }),
  ]);
  const points: [number, number, number, number][] = [];
  const ring = (picture: ScenePoint[]) =>
    picture.map(([x, y]) => {
      points.push([x / 100, y / 100, x, y]);
      return points.length - 1;
    });
  const faces: DiagramPaperFaces = {
    points,
    rings: [ring(rings.beside), ring(rings.back), ring(rings.apart), ring(rings.cover), ring(rings.buried)],
    levels: [0, 2, 0, 0, 1],
  };
  const sceneJson = storedSceneJson(scene);
  if (sceneJson === null) throw new Error('a scene the file refuses');
  return cpStep('step-knot', FLAT, {
    kind: 'scene',
    sceneJson,
    paperScale: 1,
    styleKey: null,
    key: 'scene-knot',
    paperFaces: JSON.stringify(faces),
  });
}
