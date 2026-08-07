/**
 * The ExplOri query protocol, as we consume it.
 *
 * ExplOri (`225.designorigami.net`, built on `theplantpsychologist/SEARCH-22.5`)
 * embeds a drawn tree spectrally and returns the nearest crease patterns from a
 * precomputed archive of 22.5° tilings. There is no optimizer in the loop — this
 * is lookup, not solve, which is why a query answers in under a second and why
 * the results are exact rather than something we would have to clean up.
 *
 * Everything here mirrors what the upstream server actually sends, minus the two
 * fields our proxy strips. The API carries no version, so nothing may be trusted
 * without checking; see `exploriService.ts` for the parsing.
 */

/** How the paper is folded onto itself in a database of tilings. */
export type ExploriSymmetry = 'diag' | 'book' | 'none';

export const EXPLORI_SYMMETRIES: readonly ExploriSymmetry[] = ['diag', 'book', 'none'];

/**
 * Tiling sizes the archive holds.
 *
 * `6 book` exists but is not offered on its own: upstream folds it into the
 * `5 book` selection, and a query for one is a query for both.
 */
export const EXPLORI_SIZES: readonly number[] = [2, 3, 4, 5];

export interface ExploriDbConfig {
  N: number;
  symmetry: ExploriSymmetry;
}

/** One-letter abbreviation, as upstream writes a tiling id (`4b.61865`). */
export function exploriSymmetryAbbreviation(symmetry: ExploriSymmetry): string {
  if (symmetry === 'diag') return 'd';
  if (symmetry === 'book') return 'b';
  return 'n';
}

/** How a result is named in the UI, matching upstream. */
export function exploriTilingLabel(result: Pick<ExploriResult, 'N' | 'symmetry' | 'tilingId'>): string {
  return `${result.N}${exploriSymmetryAbbreviation(result.symmetry)}.${result.tilingId}`;
}

/**
 * The result's own page on ExplOri.
 *
 * Upstream has no route per result, but its viewer takes one: `view.js` reads
 * `?id=` and parses it as `^(\d)([nbd])(\d+)$` — the size, the symmetry letter,
 * the tiling id. Which is {@link exploriTilingLabel} without its dot, so the two
 * are built from the same parts here rather than composed twice.
 */
export function exploriResultUrl(
  result: Pick<ExploriResult, 'N' | 'symmetry' | 'tilingId'>,
  origin = 'https://225.designorigami.net'
): string {
  return `${origin}/view?id=${result.N}${exploriSymmetryAbbreviation(result.symmetry)}${result.tilingId}`;
}

/**
 * A crease pattern in exact ℚ(√2) coordinates.
 *
 * Each vertex is eight integers — the numerator and denominator of the four
 * rational components — which map to the plane by
 * `(x + (√2/2)(y − w), z + (√2/2)(y + w))`. Keeping them exact is what makes
 * two coincident vertices produce *bit-identical* doubles rather than two points
 * a tolerance has to reconcile.
 */
export interface ExploriCp {
  /** `[x.num, x.den, y.num, y.den, z.num, z.den, w.num, w.den]` per vertex. */
  vertices: number[][];
  /** `[fromIndex, toIndex, lineType]`. */
  edges: [number, number, ExploriLineType][];
}

/**
 * Crease types upstream emits.
 *
 * `h` is its "unknown/flat hinge" — a real crease whose mountain/valley
 * assignment the tiling does not determine — and `aux` is a construction line.
 * Both read as auxiliary creases here.
 */
export type ExploriLineType = 'm' | 'v' | 'b' | 'h' | 'aux';

/** The folded form, as polygons with a layer count each. */
export interface ExploriFold {
  faces: [number, number][][];
  /** Layers stacked at each face, which the render turns into opacity. */
  multiplicities: number[];
}

/** A tree or topology graph, in whatever space its producer used. */
export interface ExploriGraph {
  nodes: { id: number | string; pos?: [number, number] }[];
  edges: { u: number | string; v: number | string; length?: number; weight?: number }[];
}

export interface ExploriResult {
  rank: number;
  /** Distance in the embedding. Smaller is closer; see `matchQuality.ts`. */
  distance: number;
  N: number;
  symmetry: ExploriSymmetry;
  topologyId: number;
  tilingId: number;
  cp: ExploriCp;
  packing: ExploriCp;
  fold: ExploriFold | null;
  tree: ExploriGraph | null;
  /**
   * Folding references for the CP's vertices.
   *
   * Only ever populated by the single-tiling endpoint — the query endpoint sends
   * an empty object — so the detail view fetches them when a result is opened.
   */
  refs: Record<string, unknown>;
}

export interface ExploriQueryResponse {
  queryId: string;
  results: ExploriResult[];
}

/** A tiling, addressed exactly. Durable: it survives a save and a reload. */
export interface ExploriTilingRef {
  N: number;
  symmetry: ExploriSymmetry;
  tilingId: number;
}

export function sameTiling(a: ExploriTilingRef, b: ExploriTilingRef): boolean {
  return a.N === b.N && a.symmetry === b.symmetry && a.tilingId === b.tilingId;
}
