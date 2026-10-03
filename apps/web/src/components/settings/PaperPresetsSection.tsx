/**
 * The preset list and its verbs. "Save current as…" opens a name field in
 * place rather than a command dialog: the Settings modal takes Escape on
 * `window` ahead of any dialog opened from inside it, so a prompt would need
 * the nested-dialog handshake for one text field.
 *
 * Picking a preset while the slot holds unsaved edits asks first
 * (`PaperSettingsBinding.choosePreset`). Keeping them opens the same name
 * field, with the picked preset waiting: it is applied once they are saved.
 *
 * Export… writes the style on show. While that is a preset's, unedited, the
 * preset goes as it is, as its card's download would write it. A style no
 * preset holds has no name to go under, so the same field asks for one first;
 * exporting it adds nothing to the list.
 */
import { useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Plus, Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import { paperPresetRowLabel, type PaperPresetRow } from '../../lib/paperPresetRows';
import { PaperPresetCard } from './PaperPresetCard';
import { PaperSection } from './PaperSection';
import styles from './PaperPresetsSection.module.css';
import type { PaperPresetChoice, PaperSettingsBinding } from './usePaperSettings';

/**
 * What the name field is open for: saving the slot's style as a preset, with
 * a picked preset waiting to be applied once it is or none; or exporting a
 * style no preset holds, under the name the file will carry.
 */
type Naming = { verb: 'save'; waiting: PaperPresetRow | null } | { verb: 'export' };

export function PaperPresetsSection({ paper }: { paper: PaperSettingsBinding }) {
  const { t } = useTranslation();
  const [naming, setNaming] = useState<Naming | null>(null);
  const [name, setName] = useState('');
  // The preset to apply once the edits it would have replaced are saved.
  const waiting = naming?.verb === 'save' ? naming.waiting : null;
  const trimmed = name.trim();
  const whyId = useId();

  const startNaming = (next: Naming, initial = '') => {
    setNaming(next);
    setName(initial);
  };
  const stopNaming = () => setNaming(null);
  /** What became of a pick: a `save` asks for the name the edits are kept under. */
  const settle = (row: PaperPresetRow, choice: PaperPresetChoice) => {
    if (choice === 'save') startNaming({ verb: 'save', waiting: row });
    // Another pick went through instead, so the edits a waiting preset was
    // held back for are gone, and so is the reason to name them — as is the
    // style an export was asking a name for.
    else if (choice === 'applied' && (waiting || naming?.verb === 'export')) stopNaming();
  };

  const save = () => {
    paper.savePreset(trimmed);
    // Saved over the very preset that was waiting, the edits *are* that preset
    // now; applying the old copy would only undo the save.
    const replaced = waiting?.builtIn === null && waiting.preset.name === trimmed;
    if (waiting && !replaced) paper.applyPreset(waiting);
  };

  const submit = () => {
    if (!trimmed || !naming) return;
    if (naming.verb === 'export') void paper.exportStyle(trimmed);
    else save();
    stopNaming();
  };

  // A suggested name arrives selected, so typing replaces it and Enter keeps
  // it. Once, as the field mounts: a click into it later places a caret.
  const selectSuggestion = useCallback((input: HTMLInputElement | null) => input?.select(), []);

  const exportOnShow = () => {
    const applied = paper.appliedPreset;
    if (applied && !paper.modified) void paper.exportPreset(applied, 'button');
    // Edited, the preset's name is still the likeliest one for the file.
    else startNaming({ verb: 'export' }, applied ? paperPresetRowLabel(t, applied) : '');
  };

  // Why the field is asking, where the button pressed does not already say.
  const why =
    naming?.verb === 'export'
      ? t(
          'dialogs:settings.paper.presets.exportUnsaved',
          'This style isn’t saved as a preset. Name it for the file.'
        )
      : waiting
        ? t(
            'dialogs:settings.paper.presets.saveThenApply',
            'Name a preset for your changes. {{preset}} is applied once it is saved.',
            { preset: paperPresetRowLabel(t, waiting) }
          )
        : null;

  return (
    <PaperSection
      title={t('dialogs:settings.paper.presets.title', 'Presets')}
      testId="settings-paper-presets"
    >
      <div className={styles.presets}>
        {paper.presets.map((row) => (
          <PaperPresetCard
            key={row.key}
            row={row}
            applied={paper.appliedPreset?.key === row.key}
            disabled={!paper.editable}
            onApply={() => void paper.choosePreset(row).then((choice) => settle(row, choice))}
            onExport={() => void paper.exportPreset(row, 'card')}
            onDelete={row.builtIn ? null : () => paper.removePreset(row.preset.name)}
          />
        ))}
      </div>
      {why && (
        <p id={whyId} className={styles.why}>
          {why}
        </p>
      )}
      {naming ? (
        <form
          className={styles.name}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {/*
            The field is the whole row, so it says what it wants in itself
            rather than carrying a heading beside it — the two buttons already
            say what the row is for.
          */}
          <input
            ref={selectSuggestion}
            className={`control-row__input ${styles.input}`}
            type="text"
            aria-label={t('dialogs:settings.paper.presets.name', 'Preset name')}
            placeholder={t('dialogs:settings.paper.presets.name', 'Preset name')}
            aria-describedby={why ? whyId : undefined}
            value={name}
            autoFocus
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <Button size="sm" variant="primary" type="submit" disabled={!trimmed}>
            {naming.verb === 'export'
              ? t('dialogs:settings.paper.presets.exportConfirm', 'Export')
              : t('dialogs:settings.paper.presets.save', 'Save')}
          </Button>
          {/* The outline sibling of Save, as the two verbs it replaced are. */}
          <Button size="sm" variant="secondary" onClick={stopNaming}>
            {t('dialogs:common.cancel', 'Cancel')}
          </Button>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => startNaming({ verb: 'save', waiting: null })}
          >
            <Plus size={13} aria-hidden="true" />
            {t('dialogs:settings.paper.presets.saveAs', 'Save current as…')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void paper.importPreset().then((imported) => {
                if (imported) settle(imported.row, imported.choice);
              })
            }
          >
            <Upload size={14} aria-hidden="true" />
            {t('dialogs:settings.paper.presets.import', 'Import…')}
          </Button>
          <Button size="sm" variant="secondary" onClick={exportOnShow}>
            <Download size={14} aria-hidden="true" />
            {t('dialogs:settings.paper.presets.export', 'Export…')}
          </Button>
        </div>
      )}
    </PaperSection>
  );
}
