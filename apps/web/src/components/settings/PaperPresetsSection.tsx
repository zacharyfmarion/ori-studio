/**
 * The preset list and its verbs. "Save current as…" opens a name field in
 * place rather than a command dialog: the Settings modal takes Escape on
 * `window` ahead of any dialog opened from inside it, so a prompt would need
 * the nested-dialog handshake for one text field.
 *
 * Picking a preset while the slot holds unsaved edits asks first
 * (`PaperSettingsBinding.choosePreset`). Keeping them opens the same name
 * field, with the picked preset waiting: it is applied once they are saved.
 */
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import { paperPresetRowLabel, type PaperPresetRow } from '../../lib/paperPresetRows';
import { PaperPresetCard } from './PaperPresetCard';
import { PaperSection } from './PaperSection';
import styles from './PaperPresetsSection.module.css';
import type { PaperPresetChoice, PaperSettingsBinding } from './usePaperSettings';

export function PaperPresetsSection({ paper }: { paper: PaperSettingsBinding }) {
  const { t } = useTranslation();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  // The preset to apply once the edits it would have replaced are saved.
  const [waiting, setWaiting] = useState<PaperPresetRow | null>(null);
  const trimmed = name.trim();
  const whyId = useId();

  const startNaming = (then: PaperPresetRow | null) => {
    setWaiting(then);
    setName('');
    setNaming(true);
  };
  const stopNaming = () => {
    setNaming(false);
    setWaiting(null);
  };
  /** What became of a pick: a `save` asks for the name the edits are kept under. */
  const settle = (row: PaperPresetRow, choice: PaperPresetChoice) => {
    if (choice === 'save') startNaming(row);
    // Another pick went through instead, so the edits a waiting preset was
    // held back for are gone, and so is the reason to name them.
    else if (choice === 'applied' && waiting) stopNaming();
  };

  const save = () => {
    if (!trimmed) return;
    paper.savePreset(trimmed);
    // Saved over the very preset that was waiting, the edits *are* that preset
    // now; applying the old copy would only undo the save.
    const replaced = waiting?.builtIn === null && waiting.preset.name === trimmed;
    if (waiting && !replaced) paper.applyPreset(waiting);
    stopNaming();
    setName('');
  };

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
            onExport={() => void paper.exportPreset(row)}
            onDelete={row.builtIn ? null : () => paper.removePreset(row.preset.name)}
          />
        ))}
      </div>
      {naming && waiting && (
        <p id={whyId} className={styles.why}>
          {t(
            'dialogs:settings.paper.presets.saveThenApply',
            'Name a preset for your changes. {{preset}} is applied once it is saved.',
            { preset: paperPresetRowLabel(t, waiting) }
          )}
        </p>
      )}
      {naming ? (
        <form
          className={styles.name}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {/*
            The field is the whole row, so it says what it wants in itself
            rather than carrying a heading beside it — the two buttons already
            say what the row is for.
          */}
          <input
            className={`control-row__input ${styles.input}`}
            type="text"
            aria-label={t('dialogs:settings.paper.presets.name', 'Preset name')}
            placeholder={t('dialogs:settings.paper.presets.name', 'Preset name')}
            aria-describedby={waiting ? whyId : undefined}
            value={name}
            autoFocus
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <Button size="sm" variant="primary" type="submit" disabled={!trimmed}>
            {t('dialogs:settings.paper.presets.save', 'Save')}
          </Button>
          {/* The outline sibling of Save, as the two verbs it replaced are. */}
          <Button size="sm" variant="secondary" onClick={stopNaming}>
            {t('dialogs:common.cancel', 'Cancel')}
          </Button>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button size="sm" variant="secondary" onClick={() => startNaming(null)}>
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
        </div>
      )}
    </PaperSection>
  );
}
