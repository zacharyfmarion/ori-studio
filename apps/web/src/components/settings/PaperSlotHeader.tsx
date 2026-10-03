/**
 * Which style is being edited, which preset it came from, and — on the export
 * slot — whether it is still the display style.
 *
 * Above the groups rather than inside one: it names what every group below is
 * about, and the banner under it speaks for the same thing.
 */
import { useTranslation } from 'react-i18next';
import { Link2, Unlink2 } from 'lucide-react';
import { paperSlotChipLabel } from '../../lib/paperPresetRows';
import type { PaperStyleSlot } from '../../lib/paperStyleSettings';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { SegmentedControl } from '../ui/SegmentedControl';
import type { PaperSettingsBinding } from './usePaperSettings';

export function PaperSlotHeader({ paper }: { paper: PaperSettingsBinding }) {
  const { t } = useTranslation();
  return (
    <header className="settings-paper__slot">
      <div className="settings-paper__slot-row">
        <SegmentedControl<PaperStyleSlot>
          size="lg"
          aria-label={t('dialogs:settings.paper.slot.title', 'Style')}
          value={paper.slot}
          onChange={paper.setSlot}
          // "Style" in both, so the switch does not read as a second Export
          // button beside the presets' Export…; and the export dialog's style
          // picker already calls this slot "Export style".
          options={[
            { value: 'display', label: t('dialogs:settings.paper.slot.display', 'Display style') },
            {
              value: 'export',
              label: paper.exportFollowsDisplay
                ? t('dialogs:settings.paper.slot.exportLinked', 'Export style · linked')
                : t('dialogs:settings.paper.slot.export', 'Export style'),
            },
          ]}
        />
        <span className="settings-paper__chip" data-state={presetChipState(paper)}>
          <span className="settings-paper__chip-dot" aria-hidden="true" />
          {paperSlotChipLabel(
            t,
            { applied: paper.appliedPreset, modified: paper.modified },
            { fromDisplay: !paper.editable }
          )}
        </span>
        {paper.update && (
          <Chip size="md" onClick={paper.update}>
            {t('dialogs:settings.paper.presetChip.update', 'Update')}
          </Chip>
        )}
        {paper.modified && paper.editable && (
          <Chip size="md" onClick={paper.revert}>
            {t('dialogs:settings.paper.presetChip.revert', 'Revert')}
          </Chip>
        )}
      </div>
      <span className="settings-paper__slot-hint">
        {paper.slot === 'export'
          ? t('dialogs:settings.paper.slot.exportHint', 'Used by every SVG and PNG the app writes.')
          : t(
              'dialogs:settings.paper.slot.displayHint',
              'Simulations, folded figures and steps, on screen.'
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
              'Exports use the display style. Detach to give exports their own style.'
            )
          : t(
              'dialogs:settings.paper.link.detached',
              'Exports have their own style and no longer follow the display style.'
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
