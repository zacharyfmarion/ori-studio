import type { OristudioCpFolded3dRenderModel } from '../../engine/oristudioCpTypes';

/**
 * The frozen 3D figure the start screen turns.
 *
 * Produced by `scripts/generate-start-figure.mjs`, which drives the kernel's
 * `Fold3dSession` — the exact folded state the `G` key computes — and stores
 * what it returns. The payload is a `Folded3dRenderModel`, the same thing an
 * in-app folded figure is built from, so the start screen reuses `folded3dMesh`
 * rather than carrying a private geometry format.
 *
 * Served from `public/` rather than imported, so it stays out of the JS bundle
 * and a missing or malformed file degrades to the static image instead of
 * failing the build.
 *
 * **To swap the figure**, run the generator against a different crease pattern
 * and point {@link START_FIGURE} at what it wrote. Nothing else here knows which
 * model it is drawing — the pose and the sweep travel with the geometry.
 */

const publicAssetBase = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

/** The shipped figure, relative to the public asset base. */
export const START_FIGURE = {
  /** The kernel's folded render model, plus the pose it is shown at. */
  url: `${publicAssetBase}start/penguin-figure.json`,
  /** Shown until the 3D figure is ready, and permanently when it cannot be. */
  fallbackUrl: `${publicAssetBase}start/crease-pattern-preview.png`,
} as const;

/** What `generate-start-figure.mjs` writes. */
export interface StartFigureAsset {
  version: number;
  source: string;
  solution: number;
  view: { yaw: number; pitch: number; sweep: number };
  model: OristudioCpFolded3dRenderModel;
}

/** The schema this reader understands. Bumped when the shape changes. */
const ASSET_VERSION = 2;

/**
 * Parse and shape-check an asset.
 *
 * Deliberately shallow. The render model's own invariants — every offset, every
 * face id — were re-derived and checked by `Folded3dRenderModel::validate` in
 * the kernel before it was ever written out, and `folded3dMesh` re-reads the
 * arrays defensively on the way to the GPU. Repeating that here would be a third
 * implementation of the same checks with no third opinion behind it. What this
 * catches is the failure those cannot: a file that is not this asset at all —
 * truncated, a stale schema, or an HTML error page a dev server served with a
 * 200. See `pages-spa-fallback`.
 */
export function parseStartFigureAsset(value: unknown): StartFigureAsset | null {
  if (typeof value !== 'object' || value === null) return null;
  const asset = value as Partial<StartFigureAsset>;
  if (asset.version !== ASSET_VERSION) return null;

  const { view, model } = asset;
  if (typeof view !== 'object' || view === null) return null;
  if (
    typeof view.yaw !== 'number' ||
    typeof view.pitch !== 'number' ||
    typeof view.sweep !== 'number'
  ) {
    return null;
  }
  if (typeof model !== 'object' || model === null) return null;
  if (
    typeof model.face_count !== 'number' ||
    typeof model.edge_count !== 'number' ||
    typeof model.cell_count !== 'number' ||
    !Array.isArray(model.ring_points) ||
    !Array.isArray(model.cell_attr) ||
    !Array.isArray(model.edge_points)
  ) {
    return null;
  }
  if (model.face_count < 1 || model.cell_count < 1) return null;

  return asset as StartFigureAsset;
}

export async function loadStartFigureAsset(
  url: string,
  signal?: AbortSignal
): Promise<StartFigureAsset | null> {
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  return parseStartFigureAsset(await response.json());
}
