import {
  applyCreaseStyle,
  cssPxToPt,
  DEFAULT_PAPER_STYLE,
  effectivePaperStyle,
  normalizePaperStyle,
  parseHex,
  PEN_WIDTH_RANGE,
  type PaperStyle,
  type PaperStyleOverrides,
} from './paper/paperStyle';
import { normalizePaperStylePreset, type PaperStylePreset } from './paper/paperPresets';

/**
 * The app-wide paper style as it is persisted: a display style, an export
 * style that is `null` while it follows display, and the user's own presets.
 *
 * Pure data plus a normaliser, with no React or store dependency, in the
 * `simulatorSettings` pattern: the settings store reads and writes this shape
 * and nothing else interprets the stored JSON. The first read seeds it from
 * the simulator settings that held these values before there was a style —
 * see {@link paperStyleFromSimulatorSettings}.
 */
export interface PaperStyleSettings {
  display: PaperStyle;
  /** `null` = the export style is the display style until the user changes it. */
  export: PaperStyle | null;
  /** The user's saved presets; the built-ins are not stored. */
  presets: PaperStylePreset[];
  /**
   * The preset each slot was last set from, keyed as `paperPresetKey` writes
   * it, or `null` where the slot has never been handed one.
   *
   * A record of *where the style came from*, not of whether it still matches:
   * an edit afterwards leaves this alone, and the UI says "modified" by
   * comparing the live style with the named preset's. A stored dirty flag
   * would have to be cleared by every path that happens to undo an edit, and
   * the comparison is free.
   */
  appliedPreset: AppliedPaperPresets;
}

/** Which preset each slot is showing; see {@link PaperStyleSettings.appliedPreset}. */
export interface AppliedPaperPresets {
  display: string | null;
  export: string | null;
}

export type PaperStyleSlot = 'display' | 'export';

export const PAPER_STYLE_SETTINGS_VERSION = 1;

export const DEFAULT_PAPER_STYLE_SETTINGS: PaperStyleSettings = {
  display: DEFAULT_PAPER_STYLE,
  export: null,
  presets: [],
  appliedPreset: { display: null, export: null },
};

/**
 * The style an export paints with: the export slot while the user has set one
 * apart, the display style otherwise, with an object's own pins on top. Every
 * surface that exports through the shared painter resolves its style here, so
 * the export slot cannot be honoured on one surface and missed on another.
 */
export function exportPaperStyle(
  settings: Pick<PaperStyleSettings, 'display' | 'export'>,
  overrides?: PaperStyleOverrides
): PaperStyle {
  return effectivePaperStyle(settings.export ?? settings.display, overrides);
}

/** The persisted form. `version` is written so a later shape can be told apart. */
export interface PersistedPaperStyleSettings extends PaperStyleSettings {
  version: typeof PAPER_STYLE_SETTINGS_VERSION;
}

export function persistedPaperStyleSettings(
  settings: PaperStyleSettings
): PersistedPaperStyleSettings {
  return {
    version: PAPER_STYLE_SETTINGS_VERSION,
    display: settings.display,
    export: settings.export,
    presets: settings.presets,
    appliedPreset: settings.appliedPreset,
  };
}

/**
 * Normalise an untrusted (persisted) settings object. Each style is normalised
 * field by field, so a corrupt value never reaches a renderer; a preset that is
 * not one is dropped rather than defaulted, since a default under the user's
 * name would be a preset they never saved.
 */
export function normalizePaperStyleSettings(source: unknown): PaperStyleSettings {
  if (!source || typeof source !== 'object') return DEFAULT_PAPER_STYLE_SETTINGS;
  const raw = source as Record<string, unknown>;
  const presets: PaperStylePreset[] = [];
  if (Array.isArray(raw.presets)) {
    for (const entry of raw.presets) {
      const preset = normalizePaperStylePreset(entry);
      // Names are the identity a preset is applied and removed by.
      if (preset && !presets.some((existing) => existing.name === preset.name)) {
        presets.push(preset);
      }
    }
  }
  return {
    display: normalizePaperStyle(raw.display),
    // Absent reads as following display, which is also what a build before
    // the export slot existed would have written.
    export: raw.export === null || raw.export === undefined ? null : normalizePaperStyle(raw.export),
    presets,
    appliedPreset: normalizeAppliedPaperPresets(raw.appliedPreset),
  };
}

/**
 * The remembered preset keys from untrusted data. A key is only ever compared
 * against the list the UI builds, so an unknown one reads as "no preset" there
 * rather than needing to be validated against the built-ins here.
 */
function normalizeAppliedPaperPresets(source: unknown): AppliedPaperPresets {
  if (!source || typeof source !== 'object') return { display: null, export: null };
  const raw = source as Record<string, unknown>;
  const key = (value: unknown) => (typeof value === 'string' && value ? value : null);
  return { display: key(raw.display), export: key(raw.export) };
}

/**
 * The display style a user's old simulator settings amount to.
 *
 * Before there was a paper style, the simulator held its own paper and crease
 * colours (nullable, null meaning "follow the theme"), a crease weight in CSS
 * px and a colour / mono / mono-dashed switch. A user who had set any of them
 * should open the next build looking at the same simulator, so the first read
 * of the style — and only the first — maps them across:
 *
 * - `paperFront` / `paperBack` → the paper; a null (theme) colour takes the
 *   style's default, which is the paper every theme showed.
 * - `mountainColor` / `valleyColor` / `borderColor` → the mountain, valley and
 *   edge pens' colours.
 * - `creaseWidth` (CSS px) → the mountain and valley pens' width in pt
 *   (`px × 3/4`). Not the edge pen: the simulator draws its edges at the fold
 *   pens' width, so its look is kept, while the folded figures' 0.9 pt edge
 *   was never the simulator's to move.
 * - `creaseStyle` → the switch, written after the colours so `mono` takes the
 *   edge colour the user chose. `color` is left alone, since applying it would
 *   put the convention inks over the user's own.
 * - `lighting` → `light.enabled`.
 *
 * Anything absent or malformed leaves the default in place.
 */
export function paperStyleFromSimulatorSettings(source: unknown): PaperStyle {
  if (!source || typeof source !== 'object') return DEFAULT_PAPER_STYLE;
  const raw = source as Record<string, unknown>;
  const style: PaperStyle = {
    ...DEFAULT_PAPER_STYLE,
    paper: {
      front: parseHex(raw.paperFront) ?? DEFAULT_PAPER_STYLE.paper.front,
      back: parseHex(raw.paperBack) ?? DEFAULT_PAPER_STYLE.paper.back,
    },
    edges: {
      ...DEFAULT_PAPER_STYLE.edges,
      color: parseHex(raw.borderColor) ?? DEFAULT_PAPER_STYLE.edges.color,
    },
    mountainFolds: {
      ...DEFAULT_PAPER_STYLE.mountainFolds,
      color: parseHex(raw.mountainColor) ?? DEFAULT_PAPER_STYLE.mountainFolds.color,
    },
    valleyFolds: {
      ...DEFAULT_PAPER_STYLE.valleyFolds,
      color: parseHex(raw.valleyColor) ?? DEFAULT_PAPER_STYLE.valleyFolds.color,
    },
    light: {
      ...DEFAULT_PAPER_STYLE.light,
      enabled: typeof raw.lighting === 'boolean' ? raw.lighting : DEFAULT_PAPER_STYLE.light.enabled,
    },
  };
  if (typeof raw.creaseWidth === 'number' && Number.isFinite(raw.creaseWidth)) {
    // Rounded so the old default of 1.1 px lands on the pen's 0.825 pt exactly,
    // not a float noise away from it: a seed that is the default has to compare
    // equal to it, or the settings store pins every untouched user to it.
    const width = Math.min(
      PEN_WIDTH_RANGE.max,
      Math.max(PEN_WIDTH_RANGE.min, Math.round(cssPxToPt(raw.creaseWidth) * 1e6) / 1e6)
    );
    style.mountainFolds = { ...style.mountainFolds, width };
    style.valleyFolds = { ...style.valleyFolds, width };
  }
  const creaseStyle = raw.creaseStyle;
  if (creaseStyle === 'mono' || creaseStyle === 'mono-dashed') {
    return applyCreaseStyle(style, creaseStyle);
  }
  return style;
}
