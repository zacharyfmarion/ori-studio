// Finds the pieces of an ordered drawing that no pixel of the page ever shows.
//
// A painter's order says what covers what, not what survives. The BSP hands back
// every piece it cut, in an order that draws correctly, and the ones buried under
// later geometry are written out with the rest: a fifth of the polygons in a real
// export, and a quarter of its bytes. They cannot change the picture at any zoom,
// and in a vector editor they are worse than wasted — they sit under the visible
// artwork and take the clicks meant for it.
//
// So sample the page on a grid and ask, of each piece, whether it holds any
// sample against everything drawn after it. Walking the drawing backwards is what
// makes that cheap: by the time a piece is reached, the pieces that could hide it
// are exactly the ones already marked, so the answer is one scan of its own
// footprint and the record needed is a single bit per sample rather than an index.
//
// Software rather than a canvas because the export runs in a worker and in Node,
// and because deciding what to delete on geometry we control beats deciding it on
// someone else's antialiasing.

/** One drawn shape, in the page coordinates the SVG uses. */
export interface DrawnPiece {
  /** A polygon's vertices, or the two ends of a stroked segment. */
  points: ReadonlyArray<readonly [number, number]>;
  /** Stroke width for a segment. Zero fills `points` as a polygon instead. */
  strokeWidth: number;
}

export interface VisibilityOptions {
  /** The page rect, in the same units as the pieces' points. */
  minX: number;
  minY: number;
  width: number;
  height: number;
  /**
   * Samples per page unit along each axis.
   *
   * The one approximation here: a sliver of a piece narrower than the sample
   * spacing can go unseen and be dropped. Measured on a real export the count of
   * hidden polygons settles quickly — 158 of 745 at one sample per unit, 150 at
   * two, 148 at four, 145 at twelve — so the default sits within about three
   * pieces of the true answer, and those three are hairlines a fraction of a
   * pixel wide. Cost is quadratic in this, which is the other half of the choice.
   */
  samplesPerUnit?: number;
}

const DEFAULT_SAMPLES_PER_UNIT = 4;

/**
 * Samples the grid may hold.
 *
 * At four per unit a page of a thousand units square already wants 16M, so large
 * pages step the sampling down rather than the allocation up. They can afford to:
 * a piece that survives on a big page covers proportionally more of it.
 */
const MAX_SAMPLES = 12_000_000;

/** Emits the horizontal runs of samples a shape covers, top row to bottom. */
type SpanSink = (row: number, from: number, to: number) => void;

/**
 * Which pieces hold at least one sample, given they are drawn in order and each
 * covers what came before. Index-aligned with `pieces`.
 */
export function findVisiblePieces(
  pieces: readonly DrawnPiece[],
  options: VisibilityOptions,
): boolean[] {
  const visible = new Array<boolean>(pieces.length).fill(false);
  if (pieces.length === 0) return visible;

  const requested = options.samplesPerUnit ?? DEFAULT_SAMPLES_PER_UNIT;
  const area = Math.max(options.width * options.height, 1);
  // Never below one sample per page unit, whatever the ceiling says: sparser than
  // the pixels the page will be shown at, and the test stops being about what is
  // visible. A page big enough to reach that floor is the one place this may
  // exceed `MAX_SAMPLES`.
  const scale = Math.max(1, Math.min(requested, Math.sqrt(MAX_SAMPLES / area)));
  const cols = Math.max(1, Math.floor(options.width * scale));
  const rows = Math.max(1, Math.floor(options.height * scale));
  const covered = new Uint8Array(cols * rows);

  // Backwards, so `covered` always holds precisely what is drawn over this piece.
  for (let index = pieces.length - 1; index >= 0; index -= 1) {
    const piece = pieces[index]!;
    const points = piece.points.map(
      ([x, y]) => [(x - options.minX) * scale, (y - options.minY) * scale] as [number, number],
    );
    let shows = false;
    const claim: SpanSink = (row, from, to) => {
      if (row < 0 || row >= rows) return;
      const first = Math.max(0, Math.ceil(from - 0.5));
      const last = Math.min(cols - 1, Math.floor(to - 0.5));
      const base = row * cols;
      for (let col = first; col <= last; col += 1) {
        const at = base + col;
        if (!covered[at]) {
          covered[at] = 1;
          shows = true;
        }
      }
    };
    if (piece.strokeWidth > 0) {
      const [a, b] = points;
      if (a && b) capsuleSpans(a, b, (piece.strokeWidth * scale) / 2, rows, claim);
    } else {
      polygonSpans(points, rows, claim);
    }
    visible[index] = shows;
  }
  return visible;
}

/** The runs whose sample centres fall inside `points`, by the even-odd rule. */
function polygonSpans(
  points: ReadonlyArray<readonly [number, number]>,
  rows: number,
  emit: SpanSink,
): void {
  if (points.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const first = Math.max(0, Math.ceil(minY - 0.5));
  const last = Math.min(rows - 1, Math.floor(maxY - 0.5));
  const crossings: number[] = [];

  for (let row = first; row <= last; row += 1) {
    const y = row + 0.5;
    crossings.length = 0;
    for (let i = 0; i < points.length; i += 1) {
      const [x1, y1] = points[i]!;
      const [x2, y2] = points[(i + 1) % points.length]!;
      // Half-open in y, so a vertex shared by two edges is counted once.
      if (y1 <= y === y2 <= y) continue;
      crossings.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    if (crossings.length < 2) continue;
    crossings.sort((l, r) => l - r);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      emit(row, crossings[i]!, crossings[i + 1]!);
    }
  }
}

/** A stroked segment: the band along it, plus the round cap at each end. */
function capsuleSpans(
  a: readonly [number, number],
  b: readonly [number, number],
  radius: number,
  rows: number,
  emit: SpanSink,
): void {
  if (!(radius > 0)) return;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length > 0) {
    const nx = (-dy / length) * radius;
    const ny = (dx / length) * radius;
    polygonSpans(
      [
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
        [a[0] - nx, a[1] - ny],
      ],
      rows,
      emit,
    );
  }
  discSpans(a, radius, rows, emit);
  discSpans(b, radius, rows, emit);
}

function discSpans(
  centre: readonly [number, number],
  radius: number,
  rows: number,
  emit: SpanSink,
): void {
  const first = Math.max(0, Math.ceil(centre[1] - radius - 0.5));
  const last = Math.min(rows - 1, Math.floor(centre[1] + radius - 0.5));
  for (let row = first; row <= last; row += 1) {
    const dy = row + 0.5 - centre[1];
    const half = Math.sqrt(Math.max(radius * radius - dy * dy, 0));
    emit(row, centre[0] - half, centre[0] + half);
  }
}
