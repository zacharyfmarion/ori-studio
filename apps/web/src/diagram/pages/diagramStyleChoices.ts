/**
 * What the Page pane's style control offers (D9): the two built-ins, the
 * export style from Settings, and each preset saved there. A built-in is kept
 * by its id; anything from Settings is resolved to its style when chosen and
 * kept with the diagram, so a printed diagram never depends on whose machine
 * opens it.
 *
 * Pure: the caller hands in the settings it holds.
 */
import type { DiagramStyleChoiceName } from '../../analytics';
import { BUILT_IN_PAPER_PRESETS, paperPresetKey, type BuiltInPaperPresetId } from '../../lib/paper/paperPresets';
import { paperStyleEquals } from '../../lib/paper/paperStyle';
import type { PaperStyleSettings } from '../../lib/paperStyleSettings';
import type { DiagramStyle } from '../document/diagramDocument';

export interface DiagramStyleChoice {
  /** Unique in the list, for the select and for tests. */
  id: string;
  /** What choosing it stores. */
  style: DiagramStyle;
  /** The built-in it is, named through i18n; null for one from Settings. */
  builtIn: BuiltInPaperPresetId | null;
  /** A saved preset's own name; null for the built-ins and the export style. */
  presetName: string | null;
  analytics: DiagramStyleChoiceName;
}

/** The built-in Diagram first: it is what a new diagram is drawn in. */
const BUILT_IN_ORDER: readonly BuiltInPaperPresetId[] = ['diagram', 'default'];

export const EXPORT_STYLE_CHOICE = 'export-style';

export function diagramStyleChoices(
  settings: Pick<PaperStyleSettings, 'display' | 'export' | 'presets'>
): DiagramStyleChoice[] {
  return [
    ...BUILT_IN_ORDER.filter((id) => BUILT_IN_PAPER_PRESETS.some((preset) => preset.id === id)).map(
      (id): DiagramStyleChoice => ({
        id: `builtin:${id}`,
        style: { preset: id },
        builtIn: id,
        presetName: null,
        analytics: id,
      })
    ),
    {
      id: EXPORT_STYLE_CHOICE,
      style: { style: settings.export ?? settings.display },
      builtIn: null,
      presetName: null,
      analytics: 'export-style',
    },
    ...settings.presets.map(
      (preset): DiagramStyleChoice => ({
        id: paperPresetKey(preset),
        style: { style: preset.style },
        builtIn: null,
        presetName: preset.name,
        analytics: 'custom',
      })
    ),
  ];
}

/**
 * The choice the diagram's style is: a built-in by its id, a resolved style by
 * the first choice drawn the same. Null for a style none of them holds now — a
 * preset since edited, or one saved on another machine — which the diagram
 * keeps as it is.
 */
export function chosenDiagramStyle(
  style: DiagramStyle,
  choices: readonly DiagramStyleChoice[]
): DiagramStyleChoice | null {
  if ('preset' in style) return choices.find((choice) => choice.builtIn === style.preset) ?? null;
  return (
    choices.find((choice) => 'style' in choice.style && paperStyleEquals(choice.style.style, style.style)) ?? null
  );
}
