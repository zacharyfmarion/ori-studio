/**
 * The preset list and its verbs. "Save current as…" opens a name field in
 * place rather than a command dialog: the Settings modal takes Escape on
 * `window` ahead of any dialog opened from inside it, so a prompt would need
 * the nested-dialog handshake for one text field.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import { PaperPresetCard } from './PaperPresetCard';
import { PaperSection } from './PaperSection';
import type { PaperSettingsBinding } from './usePaperSettings';

export function PaperPresetsSection({ paper }: { paper: PaperSettingsBinding }) {
  const { t } = useTranslation();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const trimmed = name.trim();

  const save = () => {
    if (!trimmed) return;
    paper.savePreset(trimmed);
    setNaming(false);
    setName('');
  };

  return (
    <PaperSection
      title={t('dialogs:settings.paper.presets.title', 'Presets')}
      testId="settings-paper-presets"
    >
      <div className="settings-paper-presets">
        {paper.presets.map((row) => (
          <PaperPresetCard
            key={row.key}
            row={row}
            applied={paper.appliedPreset?.key === row.key}
            disabled={!paper.editable}
            onApply={() => paper.applyPreset(row)}
            onExport={() => void paper.exportPreset(row)}
            onDelete={row.builtIn ? null : () => paper.removePreset(row.preset.name)}
          />
        ))}
      </div>
      {naming ? (
        <form
          className="settings-paper-name"
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
            className="control-row__input"
            type="text"
            aria-label={t('dialogs:settings.paper.presets.name', 'Preset name')}
            placeholder={t('dialogs:settings.paper.presets.name', 'Preset name')}
            value={name}
            autoFocus
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <Button size="sm" variant="primary" type="submit" disabled={!trimmed}>
            {t('dialogs:settings.paper.presets.save', 'Save')}
          </Button>
          {/* The outline sibling of Save, as the two verbs it replaced are. */}
          <Button size="sm" variant="secondary" onClick={() => setNaming(false)}>
            {t('dialogs:common.cancel', 'Cancel')}
          </Button>
        </form>
      ) : (
        <div className="settings-paper-actions">
          <Button size="sm" variant="secondary" onClick={() => setNaming(true)}>
            <Plus size={13} aria-hidden="true" />
            {t('dialogs:settings.paper.presets.saveAs', 'Save current as…')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void paper.importPreset()}>
            <Upload size={14} aria-hidden="true" />
            {t('dialogs:settings.paper.presets.import', 'Import…')}
          </Button>
        </div>
      )}
    </PaperSection>
  );
}
