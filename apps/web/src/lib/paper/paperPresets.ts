/**
 * Named paper styles: the built-ins, and the `.json` file a user shares one as.
 *
 * A preset carries a whole style, normalised on import, so a file written by a
 * later build still applies what this one understands and a hand-edited value
 * that does not parse falls back rather than reaching a renderer.
 */
import {
  DEFAULT_PAPER_STYLE,
  ORIEDITA_LINE_COLOR,
  ORIEDITA_PAPER_BACK,
  ORIEDITA_PAPER_FRONT,
  applyCreaseStyle,
  normalizePaperStyle,
  type PaperStyle,
  type Pen,
} from './paperStyle';

export interface PaperStylePreset {
  version: 1;
  name: string;
  author?: string;
  style: PaperStyle;
}

export type BuiltInPaperPresetId = 'ori-default' | 'oriedita' | 'black-and-white' | 'origami-house';

export interface BuiltInPaperPreset extends PaperStylePreset {
  id: BuiltInPaperPresetId;
}

const UNLIT: PaperStyle['light'] = { ...DEFAULT_PAPER_STYLE.light, enabled: false };

/** Oriedita draws its CP creases in Java's `Color.red` / `Color.blue` / `Color.cyan`, 1 px, and its figure unlit. */
const ORIEDITA_STYLE: PaperStyle = {
  ...DEFAULT_PAPER_STYLE,
  paper: { front: ORIEDITA_PAPER_FRONT, back: ORIEDITA_PAPER_BACK },
  edges: { width: 0.9, color: ORIEDITA_LINE_COLOR, dash: null, cap: 'butt' },
  mountainFolds: { width: 0.75, color: '#ff0000', dash: null, cap: 'butt' },
  valleyFolds: { width: 0.75, color: '#0000ff', dash: null, cap: 'butt' },
  auxCreases: {
    visible: false,
    pen: { width: 0.75, color: '#00ffff', dash: null, cap: 'butt' },
  },
  arrows: { width: 1.05, color: ORIEDITA_LINE_COLOR, dash: null, cap: 'round' },
  light: UNLIT,
};

/** White paper, one black ink, Oriedita's dashes telling mountain from valley. */
const BLACK_AND_WHITE_STYLE: PaperStyle = applyCreaseStyle(
  {
    ...DEFAULT_PAPER_STYLE,
    paper: { front: '#ffffff', back: '#d9d9d9' },
    edges: { width: 0.9, color: '#000000', dash: null, cap: 'butt' },
    auxCreases: {
      visible: false,
      pen: { width: 0.5, color: '#808080', dash: null, cap: 'butt' },
    },
    arrows: { width: 1.05, color: '#000000', dash: null, cap: 'round' },
    light: UNLIT,
  },
  'mono-dashed'
);

/**
 * The Origami House diagramming template, transcribed from its own labels and
 * dash arrays (A4 in mm, every line in pt): paper white with a 30% grey colour
 * side, one `#231f20` ink, edge 0.5 pt, mountain 0.75 pt dash-dot 8:2:1:2,
 * valley 0.75 pt dashed 4:2, "crease lines" 0.25 pt, arrows 0.75 pt. Its
 * hidden fold and hidden edge pens have nothing to drive and are not here.
 */
const ORIGAMI_HOUSE_INK = '#231f20';
const ORIGAMI_HOUSE_PEN: Pen = { width: 0.75, color: ORIGAMI_HOUSE_INK, dash: null, cap: 'butt' };
const ORIGAMI_HOUSE_STYLE: PaperStyle = {
  ...DEFAULT_PAPER_STYLE,
  paper: { front: '#ffffff', back: '#b3b3b3' },
  edges: { ...ORIGAMI_HOUSE_PEN, width: 0.5 },
  mountainFolds: { ...ORIGAMI_HOUSE_PEN, dash: [8, 2, 1, 2] },
  valleyFolds: { ...ORIGAMI_HOUSE_PEN, dash: [4, 2] },
  auxCreases: { visible: true, pen: { ...ORIGAMI_HOUSE_PEN, width: 0.25 } },
  arrows: { ...ORIGAMI_HOUSE_PEN, cap: 'round' },
  light: UNLIT,
};

/**
 * The built-ins. Names are the ids' English forms; the settings UI labels a
 * built-in by its id through i18n rather than showing this string.
 */
export const BUILT_IN_PAPER_PRESETS: readonly BuiltInPaperPreset[] = [
  { id: 'ori-default', version: 1, name: 'Ori default', style: DEFAULT_PAPER_STYLE },
  { id: 'oriedita', version: 1, name: 'Oriedita', style: ORIEDITA_STYLE },
  { id: 'black-and-white', version: 1, name: 'Black & white', style: BLACK_AND_WHITE_STYLE },
  { id: 'origami-house', version: 1, name: 'Origami House', style: ORIGAMI_HOUSE_STYLE },
];

export function builtInPaperPreset(id: BuiltInPaperPresetId): BuiltInPaperPreset {
  return BUILT_IN_PAPER_PRESETS.find((preset) => preset.id === id) ?? BUILT_IN_PAPER_PRESETS[0]!;
}

export function isBuiltInPaperPresetId(value: unknown): value is BuiltInPaperPresetId {
  return BUILT_IN_PAPER_PRESETS.some((preset) => preset.id === value);
}

/**
 * The identity a preset is remembered by — which one a slot is showing, and
 * which row in the list that is.
 *
 * Two namespaces, kept apart by the prefix: a built-in is its id, because its
 * name is translated and a French user's "Ori default" is not the string an
 * English one saved; a user's preset is its name, because that is what the
 * store applies, replaces and removes it by. Prefixing is what lets a preset
 * the user names "Oriedita" be a different thing from the built-in.
 */
export function paperPresetKey(preset: PaperStylePreset): string {
  const id = (preset as Partial<BuiltInPaperPreset>).id;
  return isBuiltInPaperPresetId(id) ? `builtin:${id}` : userPaperPresetKey(preset.name);
}

/** {@link paperPresetKey} for a preset the user saved, from its name alone. */
export function userPaperPresetKey(name: string): string {
  return `user:${name}`;
}

/** Why a file did not parse, as a code the UI can put words to. */
export type PaperPresetParseFailure = 'invalid-json' | 'not-a-preset';

export type PaperPresetParseResult =
  | { ok: true; preset: PaperStylePreset }
  | { ok: false; reason: PaperPresetParseFailure };

/** The file extension and media type a preset is written and picked as. */
export const PAPER_PRESET_FILE_EXTENSION = '.json';
export const PAPER_PRESET_MEDIA_TYPE = 'application/json';

const PRESET_NAME_MAX_LENGTH = 80;

/**
 * Read a preset file. A preset needs a name and a style-shaped object; the
 * style itself is normalised field by field, so a partial or slightly wrong
 * one still yields a usable preset. A missing or non-object `style` is not a
 * preset at all — normalising `{}` would silently hand back the defaults under
 * the file's name.
 */
export function parsePaperStylePreset(text: string): PaperPresetParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  const preset = normalizePaperStylePreset(parsed);
  return preset ? { ok: true, preset } : { ok: false, reason: 'not-a-preset' };
}

/**
 * A preset from an already-parsed value — a file's JSON, or one entry of the
 * persisted preset list — or null when it is not a preset. The rules are
 * {@link parsePaperStylePreset}'s; this is the half that does not read text.
 */
export function normalizePaperStylePreset(value: unknown): PaperStylePreset | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, PRESET_NAME_MAX_LENGTH) : '';
  if (!name) return null;
  if (!raw.style || typeof raw.style !== 'object') return null;
  const author =
    typeof raw.author === 'string' && raw.author.trim()
      ? raw.author.trim().slice(0, PRESET_NAME_MAX_LENGTH)
      : undefined;
  return {
    version: 1,
    name,
    ...(author ? { author } : {}),
    style: normalizePaperStyle(raw.style),
  };
}

/** The file for a preset, pretty-printed so it can be edited by hand. */
export function serializePaperStylePreset(preset: PaperStylePreset): string {
  const { version, name, author, style } = preset;
  return `${JSON.stringify({ version, name, ...(author ? { author } : {}), style }, null, 2)}\n`;
}
