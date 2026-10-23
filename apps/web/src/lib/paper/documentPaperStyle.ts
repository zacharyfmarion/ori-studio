/**
 * A paper style a document keeps as its own: the Diagram's (D9) and a Fold
 * sequence's. One rule for both, so a style chosen in either reads, stores
 * and resolves alike:
 *
 * - **What is stored** is a built-in with its values, or a style resolved
 *   when it was chosen — a preset saved in Settings, or the Settings export
 *   style — so a document never depends on whose machine opens it.
 * - **What is offered** is the two built-ins, the export style from
 *   Settings, and each preset saved there ({@link documentPaperStyleChoices}).
 * - **A style none of those holds now** (a preset since edited, or one saved
 *   on another machine) is the document's own, kept as it is
 *   ({@link chosenDocumentPaperStyle} answers null for it).
 *
 * Pure: the caller hands in the settings it holds.
 */
import type { DiagramStyleChoiceName } from '../../analytics';
import { hasNewerKey, isRecord, sameJson } from '../documentFile';
import type { PaperStyleSettings } from '../paperStyleSettings';
import {
  BUILT_IN_PAPER_PRESETS,
  builtInPaperPreset,
  isBuiltInPaperPresetId,
  paperPresetKey,
  type BuiltInPaperPresetId,
} from './paperPresets';
import { normalizePaperStyle, paperStyleEquals, type PaperStyle } from './paperStyle';

/** A style as a document stores it: a built-in by its id with its values, or a resolved style. */
export type ResolvedDocumentPaperStyle = { preset: string; style: PaperStyle } | { style: PaperStyle };
/** The id-only form is accepted from pre-launch files and callers. */
export type DocumentPaperStyle = ResolvedDocumentPaperStyle | { preset: BuiltInPaperPresetId; style?: never };

/** Freeze an id-only style when saving or explicitly choosing it. */
export function snapshotDocumentPaperStyle(style: DocumentPaperStyle): ResolvedDocumentPaperStyle {
  if (style.style) return style;
  return { preset: style.preset, style: builtInPaperPreset(style.preset).style };
}

/** What a new document draws in: the built-in Diagram style. */
export const DEFAULT_DOCUMENT_PAPER_STYLE: ResolvedDocumentPaperStyle = snapshotDocumentPaperStyle({ preset: 'diagram' });

/**
 * The style a document stores, as a whole style: a stored snapshot first, with
 * the built-ins as the fallback for id-only files.
 */
export function documentPaperStyleOf(style: DocumentPaperStyle): PaperStyle {
  return style.style ?? builtInPaperPreset(style.preset).style;
}

const STYLE_KEYS: ReadonlySet<string> = new Set(['preset', 'style']);

/**
 * A stored style, leniently: a snapshot's style normalised field by field, an
 * id-only built-in snapshotted, `fallback` for anything else (absent, or
 * damaged).
 */
export function readDocumentPaperStyle(value: unknown, fallback: ResolvedDocumentPaperStyle): ResolvedDocumentPaperStyle {
  if (!isRecord(value)) return fallback;
  if (isRecord(value.style)) {
    const style = normalizePaperStyle(value.style);
    return typeof value.preset === 'string' ? { preset: value.preset, style } : { style };
  }
  if (isBuiltInPaperPresetId(value.preset)) return snapshotDocumentPaperStyle({ preset: value.preset });
  return fallback;
}

/**
 * A style a newer build wrote: with a field this build has no name for, a
 * preset it does not have, or a paper style it would write back other than
 * it came — a field, a pen or a light it does not read. Such a style is
 * written back as it came until it is changed here.
 */
export function isNewerDocumentPaperStyle(value: Record<string, unknown>): boolean {
  if (hasNewerKey(value, STYLE_KEYS)) return true;
  // A complete snapshot is drawable even when its built-in name is from a newer build.
  if (!isRecord(value.style)) return typeof value.preset === 'string' && !isBuiltInPaperPresetId(value.preset);
  return !sameJson(JSON.parse(JSON.stringify(normalizePaperStyle(value.style))), value.style);
}

/** One entry of the style picker. */
export interface DocumentPaperStyleChoice {
  /** Unique in the list, for the select and for tests. */
  id: string;
  /** What choosing it stores. */
  style: DocumentPaperStyle;
  /** The built-in it is, named through i18n; null for one from Settings. */
  builtIn: BuiltInPaperPresetId | null;
  /** A saved preset's own name; null for the built-ins and the export style. */
  presetName: string | null;
  analytics: DiagramStyleChoiceName;
}

/** The built-in Diagram first: it is what a new document is drawn in. */
const BUILT_IN_ORDER: readonly BuiltInPaperPresetId[] = ['diagram', 'default'];

export const EXPORT_STYLE_CHOICE = 'export-style';

/** The picker's entries: the built-ins, the export style from Settings, and each saved preset. */
export function documentPaperStyleChoices(
  settings: Pick<PaperStyleSettings, 'display' | 'export' | 'presets'>
): DocumentPaperStyleChoice[] {
  return [
    ...BUILT_IN_ORDER.filter((id) => BUILT_IN_PAPER_PRESETS.some((preset) => preset.id === id)).map(
      (id): DocumentPaperStyleChoice => ({
        id: `builtin:${id}`,
        style: snapshotDocumentPaperStyle({ preset: id }),
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
      (preset): DocumentPaperStyleChoice => ({
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
 * The choice a stored style is: a built-in by its id and saved values, a
 * resolved style by the first choice drawn the same. Null for a style none of
 * them holds now, which the document keeps as it is.
 */
export function chosenDocumentPaperStyle(
  style: DocumentPaperStyle,
  choices: readonly DocumentPaperStyleChoice[]
): DocumentPaperStyleChoice | null {
  if ('preset' in style) {
    return (
      choices.find(
        (choice) =>
          choice.builtIn === style.preset &&
          paperStyleEquals(snapshotDocumentPaperStyle(choice.style).style, snapshotDocumentPaperStyle(style).style)
      ) ?? null
    );
  }
  return (
    choices.find(
      (choice) => choice.builtIn === null && choice.style.style && paperStyleEquals(choice.style.style, style.style)
    ) ?? null
  );
}
