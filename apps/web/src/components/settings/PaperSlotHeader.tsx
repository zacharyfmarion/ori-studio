/**
 * Which style is being edited, which preset it came from, and — on the export
 * slot — whether it is still the display style.
 *
 * Above the groups rather than inside one: it names what every group below is
 * about, and the banner under it speaks for the same thing.
 */
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link2, Unlink2 } from 'lucide-react';
import type { PaperStyleSlot } from '../../lib/paperStyleSettings';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { SegmentedControl } from '../ui/SegmentedControl';
import { paperPresetRowLabel } from './PaperPresetCard';
import type { PaperSettingsBinding } from './usePaperSettings';

export function PaperSlotHeader({ paper }: { paper: PaperSettingsBinding }) {
  const { t } = useTranslation();
  return (
    <header className="settings-paper__slot">
      <div className="settings-paper__slot-row">
        <SegmentedControl<PaperStyleSlot>
          aria-label={t('dialogs:settings.paper.slot.title', 'Style')}
          value={paper.slot}
          onChange={paper.setSlot}
          options={[
            { value: 'display', label: t('dialogs:settings.paper.slot.display', 'Display') },
            {
              value: 'export',
              label: paper.exportFollowsDisplay
                ? t('dialogs:settings.paper.slot.exportLinked', 'Export · linked')
                : t('dialogs:settings.paper.slot.export', 'Export'),
            },
          ]}
        />
        <span className="settings-paper__chip" data-state={presetChipState(paper)}>
          <span className="settings-paper__chip-dot" aria-hidden="true" />
          {presetChipLabel(t, paper)}
        </span>
        {paper.modified && paper.editable && (
          <Chip className="settings-paper__revert" onClick={paper.revert}>
            {t('dialogs:settings.paper.presetChip.revert', 'Revert')}
          </Chip>
        )}
      </div>
      <span className="settings-paper__slot-hint">
        {paper.slot === 'export'
          ? t('dialogs:settings.paper.slot.exportHint', 'Used by every SVG and PNG the app writes.')
          : t(
              'dialogs:settings.paper.slot.displayHint',
              'Crease pattern, simulator, folded figures and steps, on screen.'
            )}
      </span>
    </header>
  );
}

/** The dot beside the chip: accent for a preset, warning once it is modified, muted for a style of nobody's. */
function presetChipState(paper: PaperSettingsBinding): 'modified' | 'preset' | 'custom' {
  if (paper.modified) return 'modified';
  return paper.appliedPreset ? 'preset' : 'custom';
}

/**
 * The chip's words, built up rather than written out: the preset's name, then
 * whether it has been edited, then — on the export slot while it follows —
 * that this is display's style being shown, not the export slot's own.
 */
function presetChipLabel(t: TFunction, paper: PaperSettingsBinding): string {
  const name = paper.appliedPreset
    ? paperPresetRowLabel(t, paper.appliedPreset)
    : t('dialogs:settings.paper.presetChip.custom', 'Custom');
  const preset = paper.modified
    ? t('dialogs:settings.paper.presetChip.modified', '{{preset}} · modified', { preset: name })
    : name;
  return paper.editable
    ? preset
    : t('dialogs:settings.paper.presetChip.fromDisplay', '{{preset}}, from display', { preset });
}

/**
 * On the export slot: whether it is still the display style, and the one press
 * that changes that.
 *
 * Replaces the switch this used to be. "Export uses display style" as a toggle
 * put the state in a row of its own below the thing it governed; the banner
 * states the consequence — what exports will use — beside the button that
 * changes it.
 */
export function PaperLinkBanner({ paper }: { paper: PaperSettingsBinding }) {
  const { t } = useTranslation();
  const linked = paper.exportFollowsDisplay;
  return (
    <div className="settings-paper__banner" data-linked={linked || undefined}>
      {linked ? (
        <Link2 size={16} aria-hidden="true" className="settings-paper__banner-icon" />
      ) : (
        <Unlink2 size={16} aria-hidden="true" className="settings-paper__banner-icon" />
      )}
      <span className="settings-paper__banner-copy">
        {linked
          ? t(
              'dialogs:settings.paper.link.linked',
              'Exports use the display style. Detach to give exports their own pens.'
            )
          : t(
              'dialogs:settings.paper.link.detached',
              'Exports have their own pens and no longer track the display style.'
            )}
      </span>
      <Button
        size="sm"
        variant={linked ? 'primary' : 'secondary'}
        onClick={() => paper.setExportFollowsDisplay(!linked)}
      >
        {linked
          ? t('dialogs:settings.paper.link.detach', 'Detach')
          : t('dialogs:settings.paper.link.follow', 'Follow display')}
      </Button>
    </div>
  );
}
