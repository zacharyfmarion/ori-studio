/**
 * The paper style each person runs, as two super properties on every event.
 *
 * The `paper *` events count who went looking for a setting; they cannot say
 * what everyone else is drawing with. That is a question about the population,
 * so — like `locale` — it rides on every event instead.
 */
import { useLayoutEffect } from 'react';
import { paperPresetRows, paperSlotPreset } from '../lib/paperPresetRows';
import type { PaperStyleSettings, PaperStyleSlot } from '../lib/paperStyleSettings';
import { useSettingsStore } from '../store/settingsStore';
import type { PostHogClientLike } from './bootstrap';
import type { PaperExportSlotStyleName, PaperSlotStyleName } from './events';

/**
 * What `slot` runs, as the analytics name it: the preset it shows, a built-in
 * by id or `custom` for the user's own, or `unsaved` once it has been edited
 * since — or when no preset holds it at all. Never a preset's name.
 */
function slotStyleName(settings: PaperStyleSettings, slot: PaperStyleSlot): PaperSlotStyleName {
  const { applied, modified } = paperSlotPreset(settings, slot, paperPresetRows(settings.presets));
  if (!applied || modified) return 'unsaved';
  return applied.builtIn ?? 'custom';
}

/** The display style, for `paper_display_style`. */
export function paperDisplayStyleName(settings: PaperStyleSettings): PaperSlotStyleName {
  return slotStyleName(settings, 'display');
}

/** The export style, for `paper_export_style`: `linked` while it follows display. */
export function paperExportStyleName(settings: PaperStyleSettings): PaperExportSlotStyleName {
  return settings.export === null ? 'linked' : slotStyleName(settings, 'export');
}

/**
 * Keep both registered on `client` as the style changes. A colour drag writes
 * the store on every pointer move; the selectors return the names, so this
 * registers only when one of them changes.
 */
export function usePaperStyleSuperProperties(client: PostHogClientLike | null): void {
  const display = useSettingsStore((state) => paperDisplayStyleName(state.paperStyle));
  const exported = useSettingsStore((state) => paperExportStyleName(state.paperStyle));
  useLayoutEffect(() => {
    client?.register({ paper_display_style: display, paper_export_style: exported });
  }, [client, display, exported]);
}
