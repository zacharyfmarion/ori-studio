/**
 * Settings ▸ Paper's binding to the settings store: which slot is being
 * edited, the style it shows, the preset list with its verbs, and the field
 * writes — counted for analytics once per adjustment, the way the Simulate
 * pane's rows are (`useSimulatorPaperStyle`). Preferences, not document
 * edits: nothing here opens a bracket or records undo.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { ANALYTICS_EVENTS, track, type PaperPresetName } from '../../analytics';
import {
  BUILT_IN_PAPER_PRESETS,
  PAPER_PRESET_FILE_EXTENSION,
  paperPresetKey,
  serializePaperStylePreset,
  type BuiltInPaperPresetId,
  type PaperPresetParseFailure,
  type PaperStylePreset,
} from '../../lib/paper/paperPresets';
import {
  paperStyleEquals,
  type PaperStyle,
  type PaperStyleField,
  type PaperStyleValue,
} from '../../lib/paper/paperStyle';
import type { PaperStyleSlot } from '../../lib/paperStyleSettings';
import { exportFilename } from '../../platform/exportFilename';
import { getFileService, type FileService } from '../../platform/fileService';
import { useSettingsStore } from '../../store/settingsStore';

/** One row of the preset list: a built-in, named by its id through i18n, or a user's, named by them. */
export interface PaperPresetRow {
  /** Stable across renders and unique in the list, for React keys and tests. */
  key: string;
  preset: PaperStylePreset;
  /** The built-in's id, or null for a preset the user saved or imported. */
  builtIn: BuiltInPaperPresetId | null;
}

export interface PaperSettingsBinding {
  slot: PaperStyleSlot;
  setSlot: (slot: PaperStyleSlot) => void;
  /** Whether the export slot is the display style until the user changes it. */
  exportFollowsDisplay: boolean;
  setExportFollowsDisplay: (follows: boolean) => void;
  /** The slot's style — the display style when the export slot follows it. */
  style: PaperStyle;
  /** False on the export slot while it follows display: the editors show, and do nothing. */
  editable: boolean;
  /** Built-ins first, then the user's, in the order they were saved. */
  presets: PaperPresetRow[];
  /**
   * The preset the slot is showing, or null when its style is nobody's. While
   * the export slot follows display this is display's, because that is the
   * style on show.
   */
  appliedPreset: PaperPresetRow | null;
  /** Whether the style has been edited since {@link appliedPreset} was applied. */
  modified: boolean;
  /** Put the slot back to {@link appliedPreset}; a no-op when there is none. */
  revert: () => void;
  applyPreset: (row: PaperPresetRow) => void;
  /** Save the slot's style under a name; replaces a user preset of that name. */
  savePreset: (name: string) => void;
  removePreset: (name: string) => void;
  /** Pick a `.json` file, add it to the list and apply it to the slot. */
  importPreset: () => Promise<void>;
  /** Write a preset to a `.json` file. */
  exportPreset: (row: PaperPresetRow) => Promise<void>;
  /** A discrete control's write: a number committed, a switch flipped, a cap picked. */
  setField: <F extends PaperStyleField>(field: F, value: PaperStyleValue<F>) => void;
  /**
   * A continuous control's write — a colour picker firing per pointer move.
   * The first of a run is counted; {@link endAdjustment} settles it.
   */
  adjustField: <F extends PaperStyleField>(field: F, value: PaperStyleValue<F>) => void;
  endAdjustment: () => void;
}

export interface PaperSettingsDeps {
  fileService?: FileService;
}

/** The analytics name for a preset: a built-in's id, `custom` for anything the user named. */
function presetName(row: PaperPresetRow): PaperPresetName {
  return row.builtIn ?? 'custom';
}

export function usePaperSettings({ fileService }: PaperSettingsDeps = {}): PaperSettingsBinding {
  const { t } = useTranslation();
  const [slot, setSlot] = useState<PaperStyleSlot>('display');
  const paperStyle = useSettingsStore((state) => state.paperStyle);
  const setPaperStyleField = useSettingsStore((state) => state.setPaperStyleField);
  const applyPaperPreset = useSettingsStore((state) => state.applyPaperPreset);
  const setExportPaperStyleFollowsDisplay = useSettingsStore(
    (state) => state.setExportPaperStyleFollowsDisplay
  );
  const savePaperPreset = useSettingsStore((state) => state.savePaperPreset);
  const removePaperPreset = useSettingsStore((state) => state.removePaperPreset);
  const importPaperPreset = useSettingsStore((state) => state.importPaperPreset);
  // The fields counted in the adjustment under way; a ref so a per-move write
  // re-renders nothing.
  const adjusting = useRef(new Set<PaperStyleField>());

  const exportFollowsDisplay = paperStyle.export === null;
  const style = slot === 'export' ? (paperStyle.export ?? paperStyle.display) : paperStyle.display;
  const editable = slot === 'display' || !exportFollowsDisplay;

  const presets = useMemo<PaperPresetRow[]>(
    () => [
      ...BUILT_IN_PAPER_PRESETS.map((preset) => ({
        key: paperPresetKey(preset),
        preset,
        builtIn: preset.id,
      })),
      ...paperStyle.presets.map((preset) => ({
        key: paperPresetKey(preset),
        preset,
        builtIn: null,
      })),
    ],
    [paperStyle.presets]
  );

  // The slot the chip speaks for: the export slot shows display's style while
  // it follows it, so it shows display's preset too.
  const chipSlot: PaperStyleSlot = editable ? slot : 'display';
  const appliedPreset = useMemo(() => {
    const key = paperStyle.appliedPreset[chipSlot];
    const recorded = key === null ? null : (presets.find((row) => row.key === key) ?? null);
    if (recorded) return recorded;
    // Nothing recorded: a fresh install, or a style carried over from before
    // the slot remembered where it came from. A style that *is* a preset,
    // field for field, is that preset — which is what a first run shows, since
    // the default style is the first built-in.
    return presets.find((row) => paperStyleEquals(row.preset.style, style)) ?? null;
  }, [chipSlot, paperStyle.appliedPreset, presets, style]);
  const modified = appliedPreset !== null && !paperStyleEquals(style, appliedPreset.preset.style);

  const applyPreset = useCallback(
    (row: PaperPresetRow) => {
      adjusting.current.clear();
      track(ANALYTICS_EVENTS.paperPresetApplied, { slot, preset: presetName(row) });
      applyPaperPreset(slot, row.preset);
    },
    [applyPaperPreset, slot]
  );

  const importPreset = useCallback(async () => {
    const file = await (fileService ?? getFileService()).openTextFile({
      title: t('dialogs:settings.paper.importTitle', 'Import Paper Style'),
      extensions: [PAPER_PRESET_FILE_EXTENSION.slice(1)],
    });
    if (!file) return;
    const result = importPaperPreset(file.text);
    if (!result.ok) {
      toast.error(importFailureMessage(t, result.reason));
      return;
    }
    applyPreset({ key: `user:${result.preset.name}`, preset: result.preset, builtIn: null });
  }, [applyPreset, fileService, importPaperPreset, t]);

  const exportPreset = useCallback(
    async (row: PaperPresetRow) => {
      const saved = await (fileService ?? getFileService()).saveTextFile({
        title: t('dialogs:settings.paper.exportTitle', 'Export Paper Style'),
        contents: serializePaperStylePreset(row.preset),
        suggestedName: exportFilename(row.preset.name, PAPER_PRESET_FILE_EXTENSION.slice(1)),
        path: null,
        extensions: [PAPER_PRESET_FILE_EXTENSION.slice(1)],
      });
      if (saved) {
        toast.success(t('toasts:paperPreset.exported', 'Exported {{name}}', { name: saved.name }));
      }
    },
    [fileService, t]
  );

  const revert = useCallback(() => {
    if (appliedPreset && editable) applyPreset(appliedPreset);
  }, [appliedPreset, applyPreset, editable]);

  return useMemo(() => {
    const changed = (field: PaperStyleField) =>
      track(ANALYTICS_EVENTS.paperStyleChanged, { slot, field });
    const endAdjustment = () => {
      adjusting.current.clear();
    };
    return {
      slot,
      setSlot,
      exportFollowsDisplay,
      setExportFollowsDisplay: setExportPaperStyleFollowsDisplay,
      style,
      editable,
      presets,
      appliedPreset,
      modified,
      revert,
      applyPreset,
      savePreset: (name) => savePaperPreset(name, slot),
      removePreset: removePaperPreset,
      importPreset,
      exportPreset,
      setField: (field, value) => {
        endAdjustment();
        changed(field);
        setPaperStyleField(slot, field, value);
      },
      adjustField: (field, value) => {
        if (!adjusting.current.has(field)) {
          adjusting.current.add(field);
          changed(field);
        }
        setPaperStyleField(slot, field, value);
      },
      endAdjustment,
    };
  }, [
    appliedPreset,
    applyPreset,
    editable,
    exportFollowsDisplay,
    exportPreset,
    importPreset,
    modified,
    presets,
    removePaperPreset,
    revert,
    savePaperPreset,
    setExportPaperStyleFollowsDisplay,
    setPaperStyleField,
    slot,
    style,
  ]);
}

function importFailureMessage(t: TFunction, reason: PaperPresetParseFailure): string {
  switch (reason) {
    case 'invalid-json':
      return t('toasts:paperPreset.invalidJson', 'That file is not JSON');
    case 'not-a-preset':
      return t(
        'toasts:paperPreset.notAPreset',
        'That file is not a paper style: it needs a name and a style'
      );
  }
}
