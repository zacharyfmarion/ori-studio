import type {
  PaperFaceItem,
  PaperItem,
  PaperLineItem,
  PaperLineRole,
  PaperMarkupItem,
  PaperScene,
  PaperSide,
  SceneBounds,
  ScenePoint,
} from './paperScene';
import { DEFAULT_PAPER_PAGE, type PaperPage } from './paperPage';

/**
 * Hand-built scenes for the painter's tests and for any surface's export test
 * that wants a known picture without a mesh. A `.fixtures.ts` module so the
 * painter test, the PNG test and the export hooks' tests seed the same items.
 */

export const FIXTURE_SHEET_PX = 100;

/**
 * The default page at the size that paints a fixture's sheet at the screen's
 * own ratio — 0.75 pt per scene px, 96 px to the inch — so a test's arithmetic
 * on scene px carries straight onto the page.
 */
export const FIXTURE_PAGE: PaperPage = {
  ...DEFAULT_PAPER_PAGE,
  sheet: { mm: (FIXTURE_SHEET_PX * 25.4) / 96 },
};

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

/** Markup in scene px; its bounds default to the fixture sheet. */
export function markup(svg: string, bounds: SceneBounds = sceneBoundsOf([face([SQUARE])])): PaperMarkupItem {
  return { kind: 'markup', svg, bounds, hidden: false };
}

/** The extent of every item, hidden ones included; zeros when there are none. */
export function sceneBoundsOf(items: readonly PaperItem[]): SceneBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    const points =
      item.kind === 'face'
        ? item.rings.flat()
        : item.kind === 'line'
          ? [item.a, item.b]
          : [
              [item.bounds.minX, item.bounds.minY],
              [item.bounds.maxX, item.bounds.maxY],
            ];
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
