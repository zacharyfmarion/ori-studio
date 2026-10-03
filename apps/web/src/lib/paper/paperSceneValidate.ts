/**
 * A stored `PaperScene`, read back item by item from a file.
 *
 * A scene is drawn by *our* code from *our* fields, so a malformed one would
 * reach `earcut` and the GPU rather than a parser. Every number is checked,
 * unknown keys are dropped, and an item that does not read is dropped with
 * them: a picture missing a face is still a picture.
 *
 * Shared by every reader that persists a picture — the Edit workspace's 3D
 * folded figures and the Diagram workspace's step pictures — so the rules for
 * what a stored picture may contain live in one place. Faces and lines only:
 * `markup` items are dropped (see {@link readPaperItem}).
 *
 * DOM-free, store-free and pure.
 */

import type {
  PaperItem,
  PaperLineRole,
  PaperLineWhole,
  PaperScene,
  SceneBounds,
  ScenePoint,
} from '@treemaker/origami-simulator';

/**
 * `null` for anything that is not a scene at all, including an absent key.
 */
export function readPaperScene(value: unknown): PaperScene | null {
  if (!isRecord(value)) return null;
  const bounds = readSceneBounds(value.bounds);
  const sheet = finiteNumber(value.sheet);
  if (!bounds || sheet === null || !Array.isArray(value.items)) return null;
  const items: PaperItem[] = [];
  for (const item of value.items) {
    const read = readPaperItem(item);
    if (read) items.push(read);
  }
  return { bounds, sheet, items };
}

function readPaperItem(value: unknown): PaperItem | null {
  if (!isRecord(value)) return null;
  const hidden = value.hidden === true;
  if (value.kind === 'face') {
    const face = finiteNumber(value.face);
    const shade = finiteNumber(value.shade);
    if (face === null || shade === null) return null;
    if (value.side !== 'front' && value.side !== 'back') return null;
    if (!Array.isArray(value.rings)) return null;
    const rings: ScenePoint[][] = [];
    for (const ring of value.rings) {
      const points = readScenePointList(ring);
      if (points && points.length >= 3) rings.push(points);
    }
    if (rings.length === 0) return null;
    const outline = readSceneLineRole(value.outline);
    return {
      kind: 'face',
      face,
      side: value.side,
      rings,
      ...(outline ? { outline } : {}),
      shade,
      hidden,
    };
  }
  if (value.kind === 'line') {
    const role = readSceneLineRole(value.role);
    const a = readScenePoint(value.a);
    const b = readScenePoint(value.b);
    if (!role || !a || !b) return null;
    const face = finiteNumber(value.face);
    const whole = readSceneLineWhole(value.whole);
    return {
      kind: 'line',
      role,
      a,
      b,
      onBoundary: readBoundaryFlags(value.onBoundary),
      ...(whole ? { whole } : {}),
      ...(face === null ? {} : { face }),
      hidden,
    };
  }
  // Markup is never read back. A markup item is a raw SVG string the painter
  // concatenates into every page and file it composes, so one read from a file
  // would let a crafted .osf put arbitrary markup — script, handlers, external
  // links — into everything the app exports. Nothing stores markup legitimately:
  // only the References renderer emits it, at paint time, from data. Folded,
  // 3D and simulated scenes carry none, so dropping it loses nothing.
  return null;
}

export function readSceneLineRole(value: unknown): PaperLineRole | null {
  return value === 'edge' ||
    value === 'mountain' ||
    value === 'valley' ||
    value === 'diagram-mountain' ||
    value === 'diagram-valley' ||
    value === 'aux'
    ? value
    : null;
}

function readSceneLineWhole(value: unknown): PaperLineWhole | null {
  if (!isRecord(value)) return null;
  const a = readScenePoint(value.a);
  const b = readScenePoint(value.b);
  if (!a || !b) return null;
  return { a, b, onBoundary: readBoundaryFlags(value.onBoundary) };
}

/** A missing or malformed pair reads as "neither end retreats", which is inert. */
function readBoundaryFlags(value: unknown): [boolean, boolean] {
  return Array.isArray(value) ? [value[0] === true, value[1] === true] : [false, false];
}

export function readScenePoint(value: unknown): ScenePoint | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const x = finiteNumber(value[0]);
  const y = finiteNumber(value[1]);
  return x === null || y === null ? null : [x, y];
}

function readScenePointList(value: unknown): ScenePoint[] | null {
  if (!Array.isArray(value)) return null;
  const points: ScenePoint[] = [];
  for (const point of value) {
    const read = readScenePoint(point);
    if (!read) return null;
    points.push(read);
  }
  return points;
}

export function readSceneBounds(value: unknown): SceneBounds | null {
  if (!isRecord(value)) return null;
  const minX = finiteNumber(value.minX);
  const minY = finiteNumber(value.minY);
  const maxX = finiteNumber(value.maxX);
  const maxY = finiteNumber(value.maxY);
  if (minX === null || minY === null || maxX === null || maxY === null) return null;
  return { minX, minY, maxX, maxY };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
