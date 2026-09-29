/**
 * The export dialog's model, free of React: which style an export paints with,
 * the page it paints onto, and the scenes it has already built.
 *
 * A scene carries geometry and roles, and bakes in only what its target's
 * `sceneKey` names (the light, the widest pen, the ground for References'
 * marks, and a References step's sheet size, since its marks keep their size
 * at any). So an option that changes the key rebuilds the scene from the
 * target's capture, and every other option — the sheet size of every other
 * surface, the margin, the background of a surface that does not draw against
 * it — only repaints, which is a string built from the scene already in hand.
 */
import type { PaperPage } from '../lib/paper/paperPage';
import type { PaperScene } from '../lib/paper/paperScene';
import { effectivePaperStyle, type PaperStyle } from '../lib/paper/paperStyle';
import { paperSceneToSvg, type PaperSvgResult } from '../lib/paper/paperSvg';
import {
  DEFAULT_PAPER_EXPORT_MARKS,
  PAPER_EXPORT_STYLE_SLOT,
  paperPageOf,
  type PaperExportSettings,
  type PaperExportStyleChoice,
} from '../lib/paperExportSettings';
import type { PaperPresetRow } from '../lib/paperPresetRows';
import type { PaperExportTarget, PaperSceneInput } from './paperExportTarget';

/**
 * The choice as the picker can honour it: a preset key that names no preset
 * any more — deleted, or a saved preset renamed — reads as the export slot.
 */
export function resolvePaperExportStyleChoice(
  choice: PaperExportStyleChoice,
  rows: readonly PaperPresetRow[]
): PaperExportStyleChoice {
  if (choice === PAPER_EXPORT_STYLE_SLOT) return choice;
  return rows.some((row) => row.key === choice) ? choice : PAPER_EXPORT_STYLE_SLOT;
}

/**
 * The style an export paints with: the target's export style (the Settings
 * slot with the object's pins), or the picked preset with the same pins on
 * top — a figure pinned to red paper stays red whichever preset it is
 * exported in.
 */
export function paperExportStyle(
  target: Pick<PaperExportTarget, 'exportStyle' | 'pins'>,
  choice: PaperExportStyleChoice,
  rows: readonly PaperPresetRow[]
): PaperStyle {
  const resolved = resolvePaperExportStyleChoice(choice, rows);
  if (resolved === PAPER_EXPORT_STYLE_SLOT) return target.exportStyle;
  const row = rows.find((entry) => entry.key === resolved);
  return row ? effectivePaperStyle(row.preset.style, target.pins ?? undefined) : target.exportStyle;
}

/**
 * Whether the page keeps the faces no pixel of it shows. Only an SVG has faces
 * to delete, and only a surface whose picture can bury one has any to keep;
 * everywhere else they are kept, which is the cheaper page — no hidden test.
 */
export function paperExportKeepsHiddenFaces(
  target: Pick<PaperExportTarget, 'buriesFaces'>,
  options: Pick<PaperExportSettings, 'format' | 'keepHiddenFaces'>
): boolean {
  if (options.format !== 'svg' || !target.buriesFaces) return true;
  return options.keepHiddenFaces;
}

/** The page the painter draws on, from the dialog's options. */
export function paperExportPage(
  target: Pick<PaperExportTarget, 'buriesFaces'>,
  options: Pick<PaperExportSettings, keyof PaperPage | 'format'>
): PaperPage {
  return { ...paperPageOf(options), keepHiddenFaces: paperExportKeepsHiddenFaces(target, options) };
}

/**
 * What a scene of `page` for these options is built from. Options without
 * marks — a page's alone — carry every mark.
 */
export function paperExportSceneInput(
  target: Pick<PaperExportTarget, 'buriesFaces'>,
  style: PaperStyle,
  options: Pick<PaperExportSettings, 'format' | 'keepHiddenFaces' | 'background' | 'sheet'> &
    Partial<Pick<PaperExportSettings, 'marks'>>,
  page = 0
): PaperSceneInput {
  return {
    page,
    style,
    markHidden: !paperExportKeepsHiddenFaces(target, options),
    background: options.background,
    marks: options.marks ?? DEFAULT_PAPER_EXPORT_MARKS,
    sheet: options.sheet,
  };
}

/** The page, painted: the painter's reading of the scene through the target's style. */
export function paintPaperExport(
  target: Pick<PaperExportTarget, 'paintStyle'>,
  scene: PaperScene,
  style: PaperStyle,
  page: PaperPage
): PaperSvgResult {
  return paperSceneToSvg(scene, target.paintStyle(style), page);
}

/**
 * Every scene cropped alike — to the union of their bounds — so a set of pages
 * puts the sheet at the same place and size on each, and lines up when flipped
 * through or laid side by side. The painter crops to a scene's bounds, so this
 * is all it takes.
 */
export function paperScenesOnOneCrop(scenes: readonly PaperScene[]): PaperScene[] {
  if (scenes.length < 2) return [...scenes];
  const bounds = { ...scenes[0]!.bounds };
  for (const { bounds: next } of scenes) {
    bounds.minX = Math.min(bounds.minX, next.minX);
    bounds.minY = Math.min(bounds.minY, next.minY);
    bounds.maxX = Math.max(bounds.maxX, next.maxX);
    bounds.maxY = Math.max(bounds.maxY, next.maxY);
  }
  return scenes.map((scene) => ({ ...scene, bounds }));
}

/** How many faces a page has that no pixel of it shows; the preview says so when it keeps them. */
export function paperSceneHiddenFaces(scene: PaperScene): number {
  let count = 0;
  for (const item of scene.items) if (item.kind === 'face' && item.hidden) count += 1;
  return count;
}

export interface PaperExportSession {
  /** The scene for `input`, built once per key and shared by every caller that asks while it builds. */
  scene(input: PaperSceneInput): Promise<PaperScene | null>;
}

/**
 * How many scenes a session keeps: enough to toggle between a few styles and
 * back without a rebuild, few enough that dragging a colour through a picker —
 * a new key per colour on References — does not keep a scene per colour.
 */
export const PAPER_EXPORT_SCENE_CACHE_SIZE = 8;

/**
 * Scenes by key, for one target, for as long as its dialog is open: the most
 * recently asked-for {@link PAPER_EXPORT_SCENE_CACHE_SIZE}. A failed build is
 * not remembered, so asking again tries again.
 */
export function createPaperExportSession(
  target: Pick<PaperExportTarget, 'sceneKey' | 'buildScene'>,
  limit = PAPER_EXPORT_SCENE_CACHE_SIZE
): PaperExportSession {
  // A Map iterates in insertion order, so re-inserting on use keeps the least
  // recently used first, where eviction takes it from.
  const scenes = new Map<string, Promise<PaperScene | null>>();
  return {
    scene(input) {
      const key = target.sceneKey(input);
      const cached = scenes.get(key);
      if (cached) {
        scenes.delete(key);
        scenes.set(key, cached);
        return cached;
      }
      const built = target.buildScene(input);
      scenes.set(key, built);
      for (const oldest of scenes.keys()) {
        if (scenes.size <= limit) break;
        scenes.delete(oldest);
      }
      built.catch(() => {
        if (scenes.get(key) === built) scenes.delete(key);
      });
      return built;
    },
  };
}
