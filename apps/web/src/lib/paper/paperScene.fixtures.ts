import type {
  PaperFaceItem,
  PaperItem,
  PaperLineItem,
  PaperLineRole,
  PaperScene,
  PaperSide,
  SceneBounds,
  ScenePoint,
} from './paperScene';

/**
 * Hand-built scenes for the painter's tests and for any surface's export test
 * that wants a known picture without a mesh. A `.fixtures.ts` module so the
 * painter test, the PNG test and the export hooks' tests seed the same items.
 */

export const FIXTURE_SHEET_PX = 100;

/** The unit square in scene px, wound clockwise on screen (y down). */
export const SQUARE: ScenePoint[] = [
  [0, 0],
  [FIXTURE_SHEET_PX, 0],
  [FIXTURE_SHEET_PX, FIXTURE_SHEET_PX],
  [0, FIXTURE_SHEET_PX],
];

export function face(
  rings: ScenePoint[][],
  options: Partial<Omit<PaperFaceItem, 'kind' | 'rings'>> = {}
): PaperFaceItem {
  return { kind: 'face', face: 0, side: 'front', shade: 1, hidden: false, ...options, rings };
}

export function line(
  role: PaperLineRole,
  a: ScenePoint,
  b: ScenePoint,
  options: Partial<Omit<PaperLineItem, 'kind' | 'role' | 'a' | 'b'>> = {}
): PaperLineItem {
  return { kind: 'line', role, a, b, onBoundary: [false, false], hidden: false, ...options };
}

/** The extent of every item, hidden ones included; zeros when there are none. */
export function sceneBoundsOf(items: readonly PaperItem[]): SceneBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    const points = item.kind === 'face' ? item.rings.flat() : [item.a, item.b];
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return minX === Infinity ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };
}

export function sceneOf(items: PaperItem[], sheet: number = FIXTURE_SHEET_PX): PaperScene {
  return { bounds: sceneBoundsOf(items), sheet, items };
}

/** A sheet with one crease across it: the smallest scene with a face and a line. */
export function sheetWithCrease(
  role: PaperLineRole = 'mountain',
  side: PaperSide = 'front'
): PaperScene {
  return sceneOf([
    face([SQUARE], { side }),
    line(role, [0, FIXTURE_SHEET_PX / 2], [FIXTURE_SHEET_PX, FIXTURE_SHEET_PX / 2], {
      onBoundary: [true, true],
      face: 0,
    }),
  ]);
}
