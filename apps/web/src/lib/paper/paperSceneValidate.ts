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

/** The fields a stored scene, its bounds, and each kind of item are written with. */
const SCENE_KEYS: ReadonlySet<string> = new Set(['bounds', 'sheet', 'items']);
const BOUNDS_KEYS: ReadonlySet<string> = new Set(['minX', 'minY', 'maxX', 'maxY']);
const FACE_KEYS: ReadonlySet<string> = new Set(['kind', 'face', 'side', 'rings', 'outline', 'shade', 'hidden', 'group']);
const LINE_KEYS: ReadonlySet<string> = new Set([
  'kind',
  'role',
  'a',
  'b',
  'onBoundary',
  'whole',
  'joined',
  'face',
  'hidden',
  'group',
]);
const WHOLE_KEYS: ReadonlySet<string> = new Set(['a', 'b', 'onBoundary']);
const SIDES: readonly string[] = ['front', 'back'];

/**
 * Whether a stored scene is a newer build's: a field, an item of a kind, a
 * line role or a side this build has no name for. Not damage, though
 * {@link readPaperScene} drops such an item as it drops damage — right for a
 * figure the Edit workspace draws again from its fold, but a Diagram step's
 * picture is its only copy, so the Diagram carries a step that holds one
 * whole rather than lose part of it on save (`diagramFile.ts`).
 */
export function isNewerPaperScene(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (hasOtherKey(value, SCENE_KEYS)) return true;
  if (isRecord(value.bounds) && hasOtherKey(value.bounds, BOUNDS_KEYS)) return true;
  return Array.isArray(value.items) && value.items.some(isNewerPaperItem);
}

function isNewerPaperItem(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  switch (value.kind) {
    case 'face':
      return hasOtherKey(value, FACE_KEYS) || isNewerWord(value.side, SIDES) || isNewerLineRole(value.outline);
    case 'line':
      return (
        hasOtherKey(value, LINE_KEYS) ||
        isNewerLineRole(value.role) ||
        (isRecord(value.whole) && hasOtherKey(value.whole, WHOLE_KEYS))
      );
    // Never read back, for safety rather than age (`readPaperItem`).
    case 'markup':
      return false;
    default:
      return true;
  }
}

/** A word where one of `known` goes, that is none of them. */
function isNewerWord(value: unknown, known: readonly string[]): boolean {
  return typeof value === 'string' && !known.includes(value);
}

function isNewerLineRole(value: unknown): boolean {
  return typeof value === 'string' && readSceneLineRole(value) === null;
}

function hasOtherKey(value: Record<string, unknown>, known: ReadonlySet<string>): boolean {
  return Object.keys(value).some((key) => !known.has(key));
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
    const joined = readJoinedFlags(value.joined);
    return {
      kind: 'line',
      role,
      a,
      b,
      onBoundary: readBoundaryFlags(value.onBoundary),
      ...(whole ? { whole } : {}),
      ...(joined ? { joined } : {}),
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
    value === 'diagram-hidden' ||
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

/**
 * Which ends join the next line, as the producer said: kept, or a stored
 * crease pattern's border loses its corners and a 3D crease's chain of pieces
 * a wedge at every bend. Null — each end takes its pen's cap — when neither
 * joins, or the pair does not read.
 */
function readJoinedFlags(value: unknown): [boolean, boolean] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const joined: [boolean, boolean] = [value[0] === true, value[1] === true];
  return joined[0] || joined[1] ? joined : null;
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
