/**
 * The preset list as every picker shows it, and which preset a slot is
 * showing.
 *
 * Settings ▸ Paper's cards and the export dialog's style picker list the same
 * presets in the same order and name a slot's style the same way — "Default",
 * "Default · modified", "Custom", "Default, from display" — so the reading
 * lives here once, free of React and of the store, and both hand it the
 * settings they hold and their `t`.
 */
import type { TFunction } from 'i18next';
import type { PaperExportStyleName } from '../analytics/events';
import { paperPresetLabel } from '../i18n/enumLabels';
import { PAPER_EXPORT_STYLE_SLOT, type PaperExportStyleChoice } from './paperExportSettings';
import {
  BUILT_IN_PAPER_PRESETS,
  paperPresetKey,
  type BuiltInPaperPresetId,
  type PaperStylePreset,
} from './paper/paperPresets';
import { paperStyleEquals, type PaperStyle } from './paper/paperStyle';
import type { PaperStyleSettings, PaperStyleSlot } from './paperStyleSettings';

/** One row of the preset list: a built-in, named by its id through i18n, or a user's, named by them. */
export interface PaperPresetRow {
  /** Stable across renders and unique in the list, for React keys and tests. */
  key: string;
  preset: PaperStylePreset;
  /** The built-in's id, or null for a preset the user saved or imported. */
  builtIn: BuiltInPaperPresetId | null;
}

/** The built-ins first, then the user's presets in the order they were saved. */
export function paperPresetRows(saved: readonly PaperStylePreset[]): PaperPresetRow[] {
  return [
    ...BUILT_IN_PAPER_PRESETS.map((preset) => ({
      key: paperPresetKey(preset),
      preset,
      builtIn: preset.id,
    })),
    ...saved.map((preset) => ({ key: paperPresetKey(preset), preset, builtIn: null })),
  ];
}

/** The preset a slot is showing, and whether its style has been edited since. */
export interface PaperSlotPreset {
  applied: PaperPresetRow | null;
  modified: boolean;
}

/**
 * The preset `slot` is showing: the one it was last set from, while that
 * preset still exists; otherwise the one its style *is*, field for field —
 * which is what a first run shows, since the default style is the first
 * built-in. The export slot while it follows display is display's.
 */
export function paperSlotPreset(
  settings: Pick<PaperStyleSettings, 'display' | 'export' | 'appliedPreset'>,
  slot: PaperStyleSlot,
  rows: readonly PaperPresetRow[]
): PaperSlotPreset {
  const chipSlot: PaperStyleSlot = slot === 'export' && settings.export !== null ? 'export' : 'display';
  const style: PaperStyle = chipSlot === 'export' ? (settings.export ?? settings.display) : settings.display;
  const key = settings.appliedPreset[chipSlot];
  const recorded = key === null ? null : (rows.find((row) => row.key === key) ?? null);
  const applied = recorded ?? rows.find((row) => paperStyleEquals(row.preset.style, style)) ?? null;
  return { applied, modified: applied !== null && !paperStyleEquals(style, applied.preset.style) };
}

/**
 * A style choice as the analytics name it: the export slot, a built-in preset
 * by its id, or `custom` for a preset the user saved or imported — never its
 * name. A choice that names no preset any more reads as the export slot.
 */
export function paperStyleChoiceName(
  choice: PaperExportStyleChoice,
  rows: readonly PaperPresetRow[]
): PaperExportStyleName {
  if (choice === PAPER_EXPORT_STYLE_SLOT) return 'export-style';
  const row = rows.find((entry) => entry.key === choice);
  return row ? (row.builtIn ?? 'custom') : 'export-style';
}

/** A preset's name: a built-in's is translated from its id, a saved one's is the user's. */
export function paperPresetRowLabel(t: TFunction, row: PaperPresetRow): string {
  return row.builtIn ? paperPresetLabel(t, row.builtIn) : row.preset.name;
}

/**
 * What a slot is showing, in words built up rather than written out: the
 * preset's name, then whether it has been edited, then — on the export slot
 * while it follows — that this is display's style being shown, not the export
 * slot's own.
 */
export function paperSlotChipLabel(
  t: TFunction,
  slot: PaperSlotPreset,
  { fromDisplay }: { fromDisplay: boolean }
): string {
  const name = slot.applied
    ? paperPresetRowLabel(t, slot.applied)
    : t('dialogs:settings.paper.presetChip.custom', 'Custom');
  const preset = slot.modified
    ? t('dialogs:settings.paper.presetChip.modified', '{{preset}} · modified', { preset: name })
    : name;
  return fromDisplay
    ? t('dialogs:settings.paper.presetChip.fromDisplay', '{{preset}}, from display', { preset })
    : preset;
}
