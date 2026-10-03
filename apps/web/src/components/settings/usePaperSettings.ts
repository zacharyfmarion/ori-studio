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
import {
  ANALYTICS_EVENTS,
  track,
  type PaperPresetExportSource,
  type PaperPresetName,
  type PaperPresetUnsavedChoice,
} from '../../analytics';
import {
  normalizePaperStylePreset,
  PAPER_PRESET_FILE_EXTENSION,
  paperPresetKey,
  serializePaperStylePreset,
  type PaperPresetParseFailure,
  type PaperStylePreset,
} from '../../lib/paper/paperPresets';
import type { PaperStyle, PaperStyleField, PaperStyleValue } from '../../lib/paper/paperStyle';
import {
  paperPresetRowLabel,
  paperPresetRows,
  paperSlotPreset,
  type PaperPresetRow,
} from '../../lib/paperPresetRows';
import type { PaperStyleSlot } from '../../lib/paperStyleSettings';
import { exportFilename } from '../../platform/exportFilename';
import { getFileService, type FileService } from '../../platform/fileService';
import { requestChoice, type ChoiceDialogOptions } from '../../store/commandDialogStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useSettingsNestedDialog } from './settingsNestedDialog';

/**
 * What became of a preset the user picked: `applied`, with or without asking;
 * `save`, the changes it would replace are to be kept as a preset first — the
 * caller asks for a name, saves, then applies it; or `cancelled`.
 */
export type PaperPresetChoice = 'applied' | 'save' | 'cancelled';


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
  /**
   * Whether applying a preset now would throw away edits no preset holds: the
   * style has been changed since its preset was applied, or it is nobody's.
   */
  unsaved: boolean;
  /** Put the slot back to {@link appliedPreset}; a no-op when there is none. */
  revert: () => void;
  /**
   * Write the slot's edits into {@link appliedPreset}, which then shows them
   * unmodified. Null unless that preset is one the user saved — a built-in is
   * never overwritten, only saved as a new preset — and has been edited.
   */
  update: (() => void) | null;
  applyPreset: (row: PaperPresetRow) => void;
  /**
   * Apply a preset the user picked, asking first when that would throw away
   * {@link unsaved} edits: keep them as a preset of their own, discard them,
   * or stay put. Resolves what the user chose (`PaperPresetChoice`).
   */
  choosePreset: (row: PaperPresetRow) => Promise<PaperPresetChoice>;
  /** Save the slot's style under a name; replaces a user preset of that name. */
  savePreset: (name: string) => void;
  removePreset: (name: string) => void;
  /**
   * Pick a `.json` file, add it to the list and apply it to the slot — through
   * {@link choosePreset}, so unsaved edits are asked about first. Resolves the
   * imported row and what became of it, or null when nothing was imported.
   */
  importPreset: () => Promise<{ row: PaperPresetRow; choice: PaperPresetChoice } | null>;
  /**
   * Write a preset to a `.json` file: from its card, or from Export… while the
   * slot shows it unedited.
   */
  exportPreset: (row: PaperPresetRow, source: PaperPresetExportSource) => Promise<void>;
  /**
   * Export… for a style no preset holds as it stands — {@link modified} since
   * its preset was applied, or nobody's: the slot's style is written as a
   * preset called `name`. The list is left alone; exporting is not saving.
   */
  exportStyle: (name: string) => Promise<void>;
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
  const setNestedDialogOpen = useSettingsNestedDialog();
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

  const presets = useMemo(() => paperPresetRows(paperStyle.presets), [paperStyle.presets]);

  // The slot the chip speaks for: the export slot shows display's style while
  // it follows it, so it shows display's preset too (`paperSlotPreset`).
  const { applied: appliedPreset, modified } = useMemo(
    () => paperSlotPreset(paperStyle, slot, presets),
    [paperStyle, slot, presets]
  );
  const unsaved = editable && (modified || appliedPreset === null);

  const applyPreset = useCallback(
    (row: PaperPresetRow) => {
      adjusting.current.clear();
      track(ANALYTICS_EVENTS.paperPresetApplied, { slot, preset: presetName(row) });
      applyPaperPreset(slot, row.preset);
    },
    [applyPaperPreset, slot]
  );

  const choosePreset = useCallback(
    async (row: PaperPresetRow): Promise<PaperPresetChoice> => {
      if (!unsaved) {
        applyPreset(row);
        return 'applied';
      }
      // The dialog opens over Settings, whose Escape would otherwise close
      // both: while it is up, Escape is the dialog's (`settingsNestedDialog`).
      setNestedDialogOpen(true);
      let picked: string | null;
      try {
        picked = await requestChoice(unsavedChangesPrompt(t, appliedPreset, row));
      } finally {
        setNestedDialogOpen(false);
      }
      const choice: PaperPresetUnsavedChoice =
        picked === 'save' || picked === 'update' || picked === 'discard' ? picked : 'cancel';
      track(ANALYTICS_EVENTS.paperPresetUnsavedChanges, { slot, choice });
      if (choice === 'update' && appliedPreset) {
        track(ANALYTICS_EVENTS.paperPresetUpdated, { slot });
        savePaperPreset(appliedPreset.preset.name, slot);
      }
      if (choice === 'discard' || choice === 'update') {
        applyPreset(row);
        return 'applied';
      }
      return choice === 'save' ? 'save' : 'cancelled';
    },
    [appliedPreset, applyPreset, savePaperPreset, setNestedDialogOpen, slot, t, unsaved]
  );

  const importPreset = useCallback(async () => {
    const file = await (fileService ?? getFileService()).openTextFile({
      title: t('dialogs:settings.paper.importTitle', 'Import Paper Style'),
      extensions: [PAPER_PRESET_FILE_EXTENSION.slice(1)],
    });
    if (!file) return null;
    const result = importPaperPreset(file.text);
    if (!result.ok) {
      toast.error(importFailureMessage(t, result.reason));
      return null;
    }
    const row: PaperPresetRow = {
      key: paperPresetKey(result.preset),
      preset: result.preset,
      builtIn: null,
    };
    return { row, choice: await choosePreset(row) };
  }, [choosePreset, fileService, importPaperPreset, t]);

  /** Write a preset file, counted once it is written: a cancelled dialog counts nothing. */
  const writePresetFile = useCallback(
    async (
      preset: PaperStylePreset,
      counted: { source: PaperPresetExportSource; preset: PaperPresetName; unsaved: boolean }
    ) => {
      const saved = await (fileService ?? getFileService()).saveTextFile({
        title: t('dialogs:settings.paper.exportTitle', 'Export Paper Style'),
        contents: serializePaperStylePreset(preset),
        suggestedName: exportFilename(preset.name, PAPER_PRESET_FILE_EXTENSION.slice(1)),
        path: null,
        extensions: [PAPER_PRESET_FILE_EXTENSION.slice(1)],
      });
      if (!saved) return;
      track(ANALYTICS_EVENTS.paperPresetExported, { slot, ...counted });
      toast.success(t('toasts:paperPreset.exported', 'Exported {{name}}', { name: saved.name }));
    },
    [fileService, slot, t]
  );

  const exportPreset = useCallback(
    (row: PaperPresetRow, source: PaperPresetExportSource) =>
      writePresetFile(row.preset, { source, preset: presetName(row), unsaved: false }),
    [writePresetFile]
  );

  const exportStyle = useCallback(
    async (name: string) => {
      // Through the normaliser, as a save is, so the file carries the name a
      // save would have kept.
      const preset = normalizePaperStylePreset({ version: 1, name, style });
      if (!preset) return;
      await writePresetFile(preset, { source: 'button', preset: 'custom', unsaved: true });
    },
    [style, writePresetFile]
  );

  const revert = useCallback(() => {
    if (appliedPreset && editable) applyPreset(appliedPreset);
  }, [appliedPreset, applyPreset, editable]);

  // A preset of the user's own, edited: saving under its name replaces it.
  const updatable = editable && modified && appliedPreset !== null && appliedPreset.builtIn === null;
  const update = useMemo(
    () =>
      updatable && appliedPreset
        ? () => {
            track(ANALYTICS_EVENTS.paperPresetUpdated, { slot });
            savePaperPreset(appliedPreset.preset.name, slot);
          }
        : null,
    [appliedPreset, savePaperPreset, slot, updatable]
  );

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
      unsaved,
      revert,
      update,
      applyPreset,
      choosePreset,
      savePreset: (name) => savePaperPreset(name, slot),
      removePreset: removePaperPreset,
      importPreset,
      exportPreset,
      exportStyle,
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
    choosePreset,
    editable,
    exportFollowsDisplay,
    exportPreset,
    exportStyle,
    importPreset,
    modified,
    presets,
    removePaperPreset,
    revert,
    savePaperPreset,
    setExportPaperStyleFollowsDisplay,
    update,
    setPaperStyleField,
    slot,
    style,
    unsaved,
  ]);
}

/**
 * The question asked before a preset replaces unsaved edits, and what can be
 * done about them: keep them as a preset of their own first, write them into
 * the saved preset they were made to, or let them go. A built-in is never
 * written to, so its edits can only be kept as a new preset.
 */
function unsavedChangesPrompt(
  t: TFunction,
  applied: PaperPresetRow | null,
  next: PaperPresetRow
): ChoiceDialogOptions {
  const nextName = paperPresetRowLabel(t, next);
  const message =
    applied === null
      ? t(
          'dialogs:settings.paper.unsaved.custom',
          'This style isn’t saved as a preset. Applying {{next}} replaces it.',
          { next: nextName }
        )
      : applied.key === next.key
        ? t(
            'dialogs:settings.paper.unsaved.revert',
            'You’ve changed {{preset}}. Applying it again undoes your changes.',
            { preset: nextName }
          )
        : t(
            'dialogs:settings.paper.unsaved.modified',
            'You’ve changed {{preset}}. Applying {{next}} replaces your changes.',
            { preset: paperPresetRowLabel(t, applied), next: nextName }
          );
  return {
    title: t('dialogs:settings.paper.unsaved.title', 'Unsaved changes'),
    message,
    options: [
      ...(applied !== null && applied.builtIn === null
        ? [
            {
              id: 'update',
              label: t('dialogs:settings.paper.unsaved.update', 'Update {{preset}}', {
                preset: paperPresetRowLabel(t, applied),
              }),
              description: t(
                'dialogs:settings.paper.unsaved.updateHint',
                'Save your changes into {{preset}}, then apply {{next}}.',
                { preset: paperPresetRowLabel(t, applied), next: nextName }
              ),
            },
          ]
        : []),
      {
        id: 'save',
        label: t('dialogs:settings.paper.unsaved.save', 'Save as a new preset…'),
        description: t(
          'dialogs:settings.paper.unsaved.saveHint',
          'Keep your changes as a preset of your own, then apply {{next}}.',
          { next: nextName }
        ),
      },
      {
        id: 'discard',
        label: t('dialogs:settings.paper.unsaved.discard', 'Discard changes'),
        description: t(
          'dialogs:settings.paper.unsaved.discardHint',
          'Apply {{next}} without keeping your changes.',
          { next: nextName }
        ),
        tone: 'danger',
      },
    ],
  };
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
