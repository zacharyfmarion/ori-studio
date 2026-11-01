/**
 * Edit's folded figures' layer spreads in the project file: in the crease
 * pattern's `extensions` bag, under one key, as their layer orders are
 * (`foldedFigureLayerOrders.ts`, D15), rather than on each figure. Every
 * build since v0.2.0 reads that bag, holds it and writes it back as it came,
 * so an older build carries a spread instead of dropping it, and the reader
 * version does not move (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`).
 *
 * ```json
 * "extensions": {
 *   "oristudio.foldedFigureSpreads": {
 *     "figures": {
 *       "<figure id>": {
 *         "figureKey": "fs1:…", "refoldKey": "fr1:…",
 *         "spread": { "kind": "connected", "version": 1, "amount": 0.5, "reveal": [0.8, 0.6] },
 *         "scene": "{\"schema_version\":3,…}"
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * **The spread and the scene.** A spread names no faces, so it means the same
 * on any fold of its figure. A reopened flat figure has no live fold, though,
 * and a spread is drawn from the fold's paper scene; so a spread figure also
 * saves the kernel's paper scene of the fold it shows (decision 2), as one
 * string, so the file's indentation never multiplies it. Above
 * {@link FOLDED_FIGURE_SPREAD_SCENE_BUDGET_BYTES} the scene is left out, and
 * the figure draws flat until it is folded again.
 *
 * **Linking.** An entry attaches to the figure of its id when that figure is
 * recognisably the one it was saved on: the same fold — its figure key, a
 * hash of its source, its case, its side and whether its order was given — or
 * the same figure as a Refold leaves it — its refold key, the layer orders'
 * (`foldedFigureRefoldKey`). Its scene attaches only with the figure key:
 *
 * - a figure an older build refolded (after an edit, to another solution, to
 *   the other side, or in Oriedita's own order where one was given) keeps its
 *   spread and loses its scene, so it draws flat until it folds here;
 * - one an older build moved or renamed keeps both;
 * - a new figure on a reused `generated-N` id — another fold, another title
 *   or place — is given nothing. One folded from the same creases and laid
 *   where the first was is the older build's blind spot, as for layer
 *   orders: it is shown the first one's spread, of the same picture.
 *
 * An entry that does not attach is written back as it came, never dropped,
 * and this build never hands out an id the bag names
 * (`figureIdsInFoldedFigureSpreads`). Only damage — an entry that is not one,
 * or a spread that does not read — is dropped; a newer build's (a field, a
 * kind or a value past this build's) is held on its figure as it came and
 * written back so (`FoldedFigureSpread`'s `newer`).
 *
 * **Zero bytes by default.** With no figure spread and nothing carried, the
 * key is left out, and a bag the writer was handed is written as it came, so
 * a project without spreads saves the bytes it always did.
 *
 * Pure.
 */
import type { OristudioCpFoldedFigureEntry, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { NEWER, hasNewerKey, isRecord } from '../../lib/documentFile';
import { keyDigest } from '../../lib/keyDigest';
import { foldedFigureSavesLiveSpreadScene, type FoldedFigureSpread } from './foldedFigureSpread';
import { foldedFigureRefoldKey } from './foldedFigureLayerOrders';
import { foldedFigureCurrentCase } from './foldedFigureState';
import { readLayerSpread, writeLayerSpread } from './layerSpreadSettings';

/** The crease pattern's extensions key the figures' spreads are saved under. */
export const FOLDED_FIGURE_SPREADS_KEY = 'oristudio.foldedFigureSpreads';

/**
 * The most a saved scene may be, as its JSON: the Diagram's stored-scene
 * budget (2 MB, `diagram/capture/captureFolded.ts`). C0 measured the kernel
 * scene of 54 cpoogle designs folded whole: 116 KB at the median, 619 KB at
 * p95, and one past the budget, at 3.9 MB and 4,722 faces — about the size of
 * the render snapshot every flat figure already saves.
 */
export const FOLDED_FIGURE_SPREAD_SCENE_BUDGET_BYTES = 2 * 1024 * 1024;

/** Names the algorithm in the key itself, so a later one can be told apart. */
const FIGURE_KEY_PREFIX = 'fs1:';

/** The fields of a saved entry; another makes it a newer build's. */
const SAVED_KEYS: ReadonlySet<string> = new Set(['figureKey', 'refoldKey', 'spread', 'scene']);

/** The figures with their spreads attached, and the bag that is left. */
export interface LinkedFoldedFigureSpreads {
  figures: OristudioCpFoldedFigureEntry[];
  extensions: Record<string, unknown>;
}

/**
 * Which fold a figure shows, for its saved scene to recognise: a hash of its
 * source fingerprint, its kind, the face it was folded from, the case it
 * shows, the side it shows and whether its order was given. Everything the
 * kernel's paper scene of the fold depends on that an older build can change.
 */
export function foldedFigureSpreadFigureKey(figure: OristudioCpFoldedFigureEntry): string {
  return keyDigest(
    [
      figure.sourceFingerprint ?? '',
      figure.folded3d ? '3d' : 'flat',
      String(figure.startingFaceId ?? 1),
      String(foldedFigureCurrentCase(figure)),
      figure.snapshot?.model.state ?? '',
      figure.snapshot?.shown_order ?? 'searched',
    ],
    FIGURE_KEY_PREFIX
  );
}

/** The scene's saved form for each scene object, worked out once: a save reads a figure's scene again on every save. */
const sceneJson = new WeakMap<OristudioCpFoldedPaperScene, string | null>();

/**
 * A scene as the bag saves it: its JSON, or null past the budget. One string,
 * so a figure reopened and saved again writes the bytes it read.
 */
export function foldedFigureSpreadSceneJson(scene: OristudioCpFoldedPaperScene): string | null {
  const known = sceneJson.get(scene);
  if (known !== undefined) return known;
  const json = JSON.stringify(scene);
  const kept = json.length <= FOLDED_FIGURE_SPREAD_SCENE_BUDGET_BYTES ? json : null;
  sceneJson.set(scene, kept);
  return kept;
}

/**
 * A saved scene as a figure holds it, or null for none or for damage: a
 * string that does not parse, or not to a scene's shape. Checked down to each
 * face's and subface's lists; the drawing side refuses what is wrong past that.
 */
export function readFoldedFigureSpreadScene(value: unknown): OristudioCpFoldedPaperScene | null {
  if (typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.schema_version !== 'number' || typeof parsed.flipped !== 'boolean') return null;
  if (typeof parsed.sheet !== 'number' || !Number.isFinite(parsed.sheet)) return null;
  if (![parsed.faces, parsed.subfaces, parsed.aux_lines, parsed.sheet_points].every(Array.isArray)) return null;
  const faces = (parsed.faces as unknown[]).every(
    (face) => isRecord(face) && Array.isArray(face.outline) && Array.isArray(face.points) && Array.isArray(face.edges)
  );
  const subfaces = (parsed.subfaces as unknown[]).every(
    (subface) => isRecord(subface) && Array.isArray(subface.polygon) && Array.isArray(subface.faces_top_to_bottom)
  );
  if (!faces || !subfaces) return null;
  const read = parsed as unknown as OristudioCpFoldedPaperScene;
  // The string it came as is the string it saves: no second stringify on save.
  sceneJson.set(read, value.length <= FOLDED_FIGURE_SPREAD_SCENE_BUDGET_BYTES ? value : null);
  return read;
}

/**
 * Attach each saved spread to its figure, at install, by the rule above, and
 * its scene with it when the figure still shows that fold
 * (`spreadScene`). An entry that does not attach stays in the bag as it came;
 * the bag keeps the key where it was, holding what is left, so a project
 * opened and saved again writes it in the same place.
 */
export function linkFoldedFigureSpreads(
  extensions: Record<string, unknown>,
  figures: OristudioCpFoldedFigureEntry[]
): LinkedFoldedFigureSpreads {
  const value = extensions[FOLDED_FIGURE_SPREADS_KEY];
  // None, or a value this build cannot read: left as it is, attaching nothing.
  if (!isRecord(value)) return { figures, extensions };
  const { figures: saved, ...rest } = value;
  const byId = new Map(figures.map((figure) => [figure.id, figure]));
  const attached = new Map<string, { spread: FoldedFigureSpread; scene: OristudioCpFoldedPaperScene | null }>();
  const left: [string, unknown][] = [];
  for (const [figureId, entry] of Object.entries(isRecord(saved) ? saved : {})) {
    // Damage: not an entry at all.
    if (!isRecord(entry) || typeof entry.figureKey !== 'string' || typeof entry.refoldKey !== 'string') continue;
    const held = heldSpread(entry);
    if (!held) continue;
    const figure = byId.get(figureId);
    const sameFold = figure !== undefined && foldedFigureSpreadFigureKey(figure) === entry.figureKey;
    const sameFigure = figure !== undefined && foldedFigureRefoldKey(figure) === entry.refoldKey;
    if (!figure || (!sameFold && !sameFigure)) {
      left.push([figureId, entry]);
      continue;
    }
    // A newer build's spread is that build's to draw: its scene stays in the entry it carries.
    const scene = held.kind === 'record' && sameFold && figure.folded3d == null ? readFoldedFigureSpreadScene(entry.scene) : null;
    attached.set(figureId, { spread: held, scene });
  }
  return {
    figures: figures.map((figure) => {
      const link = attached.get(figure.id);
      if (!link) return figure;
      return { ...figure, spread: link.spread, ...(link.scene ? { spreadScene: link.scene } : {}) };
    }),
    extensions: {
      ...extensions,
      [FOLDED_FIGURE_SPREADS_KEY]: { ...(left.length > 0 ? { figures: Object.fromEntries(left) } : {}), ...rest },
    },
  };
}

/**
 * The bag to write: `extensions` with every spread figure's entry in it. Each
 * figure's own replaces one of its id the bag still holds; what the bag holds
 * that no figure claims is written as it came. A figure's scene is its
 * `spreadScene` — a live figure's read from the kernel by the caller for the
 * save, a reopened one's as it was read — when it is within the budget. With
 * nothing to write the key is left out, and a bag with no key and no spread
 * figure is returned as it came, the very object.
 */
export function withFoldedFigureSpreads(
  extensions: Record<string, unknown>,
  figures: readonly OristudioCpFoldedFigureEntry[]
): Record<string, unknown> {
  const live = figures.flatMap((figure) =>
    figure.spread ? [[figure.id, savedSpreadEntry(figure, figure.spread)] as const] : []
  );
  const value = extensions[FOLDED_FIGURE_SPREADS_KEY];
  if (!isRecord(value)) {
    if (live.length === 0) return extensions;
    // A value this build cannot read gives way to the spreads it holds.
    return { ...extensions, [FOLDED_FIGURE_SPREADS_KEY]: { figures: Object.fromEntries(live) } };
  }
  const { figures: saved, ...rest } = value;
  const claimed = new Set(live.map(([figureId]) => figureId));
  const unclaimed = Object.entries(isRecord(saved) ? saved : {}).filter(([figureId]) => !claimed.has(figureId));
  const written = [...live, ...unclaimed];
  const ours = { ...(written.length > 0 ? { figures: Object.fromEntries(written) } : {}), ...rest };
  if (Object.keys(ours).length > 0) return { ...extensions, [FOLDED_FIGURE_SPREADS_KEY]: ours };
  return Object.fromEntries(Object.entries(extensions).filter(([key]) => key !== FOLDED_FIGURE_SPREADS_KEY));
}

/**
 * The bag a session holds once a save has written `extensions` with
 * `figures`: what the save wrote, less the entries the figures hold
 * themselves (as after {@link linkFoldedFigureSpreads}). So an entry the save
 * dropped stays dropped, whatever happens to the figures after.
 */
export function foldedFigureSpreadsAfterSave(
  extensions: Record<string, unknown>,
  figures: readonly OristudioCpFoldedFigureEntry[]
): Record<string, unknown> {
  const written = withFoldedFigureSpreads(extensions, figures);
  const value = written[FOLDED_FIGURE_SPREADS_KEY];
  if (!isRecord(value)) return written;
  const own = new Set(figures.flatMap((figure) => (figure.spread ? [figure.id] : [])));
  const { figures: saved, ...rest } = value;
  const left = Object.entries(isRecord(saved) ? saved : {}).filter(([figureId]) => !own.has(figureId));
  return {
    ...written,
    [FOLDED_FIGURE_SPREADS_KEY]: { ...(left.length > 0 ? { figures: Object.fromEntries(left) } : {}), ...rest },
  };
}

/**
 * The figures as a save writes their spreads: each one whose live fold a save
 * reads (`foldedFigureSavesLiveSpreadScene`) holding the scene its fold has
 * now, as the kernel answers it (`read`), in place of any it held; every other
 * as it is — a reopened figure with the scene its file carried. A read that
 * fails leaves its figure without one, and saving goes on: the figure then
 * reopens flat until it is folded again. `failed` hears of each failure.
 */
export async function foldedFiguresWithLiveSpreadScenes(
  figures: readonly OristudioCpFoldedFigureEntry[],
  read: (handle: number) => Promise<OristudioCpFoldedPaperScene | null>,
  failed: (error: unknown) => void = () => {}
): Promise<OristudioCpFoldedFigureEntry[]> {
  return Promise.all(
    figures.map(async (figure) => {
      if (!foldedFigureSavesLiveSpreadScene(figure)) return figure;
      let scene: OristudioCpFoldedPaperScene | null = null;
      try {
        scene = await read(figure.handle);
      } catch (error) {
        failed(error);
      }
      const { spreadScene: _replaced, ...rest } = figure;
      return scene ? { ...rest, spreadScene: scene } : rest;
    })
  );
}

/**
 * Every figure id the bag names, for the id allocator to pass, so no figure
 * this session folds takes one (`foldedFigureIds.ts`).
 */
export function figureIdsInFoldedFigureSpreads(extensions: Record<string, unknown>): string[] {
  const value = extensions[FOLDED_FIGURE_SPREADS_KEY];
  if (!isRecord(value) || !isRecord(value.figures)) return [];
  return Object.keys(value.figures);
}

/** A saved entry as a figure holds it: null for damage, which is dropped. */
function heldSpread(entry: Record<string, unknown>): FoldedFigureSpread | null {
  if (hasNewerKey(entry, SAVED_KEYS)) return { kind: 'newer', saved: entry };
  const read = readLayerSpread(entry.spread);
  if (read === NEWER) return { kind: 'newer', saved: entry };
  return read ? { kind: 'record', spread: read } : null;
}

/**
 * A figure's spread as the bag saves it: this build's keyed to the figure as
 * it is now, with its scene when it has one within the budget; a newer
 * build's entry as it came.
 */
function savedSpreadEntry(
  figure: OristudioCpFoldedFigureEntry,
  spread: FoldedFigureSpread
): Readonly<Record<string, unknown>> {
  if (spread.kind === 'newer') return isRecord(spread.saved) ? spread.saved : {};
  const scene = figure.spreadScene && figure.folded3d == null ? foldedFigureSpreadSceneJson(figure.spreadScene) : null;
  return {
    figureKey: foldedFigureSpreadFigureKey(figure),
    refoldKey: foldedFigureRefoldKey(figure),
    spread: writeLayerSpread(spread.spread),
    ...(scene !== null ? { scene } : {}),
  };
}
