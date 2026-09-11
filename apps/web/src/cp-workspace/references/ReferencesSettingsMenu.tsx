import { useTranslation } from 'react-i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Settings2 } from 'lucide-react';
import { MenuIconButton } from '../../components/ui/MenuIconButton';
import type { ReferencesSettings } from '../../store/workspaceStore/types';
import { REFERENCES_CANDIDATE_COUNTS } from '../../store/workspaceStore/slices/referencesSlice';

/**
 * The toolbar's settings popover: how many candidates to ask for, and whether
 * approximate constructions are accepted (plan D4: settings live in the
 * toolbar, there is no View pane).
 *
 * A menu rather than a form, on purpose. Radix's dropdown owns the keyboard
 * inside it (arrows, Escape, typeahead), so a number field in there would fight
 * it for every key; a radio group and a checkbox item are menu-native, and two
 * settings do not need more than that. Reuses the context menu's classes so it
 * reads as the same kind of surface.
 */
export function ReferencesSettingsMenu({
  settings,
  onChange,
  disabled = false,
  landmarksFirst,
  onToggleLandmarksFirst,
  hasPlan,
}: {
  settings: ReferencesSettings;
  onChange: (settings: Partial<ReferencesSettings>) => void;
  disabled?: boolean;
  /** Whole-pattern mode: auxiliary folds hoisted to a phase 0. */
  landmarksFirst: boolean;
  onToggleLandmarksFirst: () => void;
  /** A breakdown exists, so the sequence-relative options mean something. */
  hasPlan: boolean;
}) {
  const { t } = useTranslation();
  const label = t('panels:references.settings.trigger', 'Reference settings');

  return (
    <DropdownMenu.Root>
      <MenuIconButton
        label={label}
        icon={<Settings2 size={14} />}
        disabled={disabled}
        isActive={settings.includeApproximate}
        variant="toolbar"
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="context-menu"
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          loop
        >
          <DropdownMenu.Label className="context-menu__item context-menu__heading">
            {t('panels:references.settings.candidates', 'Candidates')}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={String(settings.candidateCount)}
            onValueChange={(value) => onChange({ candidateCount: Number(value) })}
          >
            {REFERENCES_CANDIDATE_COUNTS.map((count) => (
              <DropdownMenu.RadioItem
                key={count}
                value={String(count)}
                className="context-menu__item"
              >
                <span className="context-menu__icon">
                  <DropdownMenu.ItemIndicator>
                    <Check size={12} />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span className="context-menu__label">
                  {t('panels:references.settings.candidateCount', '{{n}} solutions', { n: count })}
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="context-menu__separator" />
          <DropdownMenu.CheckboxItem
            className="context-menu__item"
            checked={settings.includeApproximate}
            onCheckedChange={(checked) => onChange({ includeApproximate: checked === true })}
          >
            <span className="context-menu__icon">
              <DropdownMenu.ItemIndicator>
                <Check size={12} />
              </DropdownMenu.ItemIndicator>
            </span>
            <span className="context-menu__label">
              {t('panels:references.settings.includeApproximate', 'Include approximate solutions')}
            </span>
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.CheckboxItem
            className="context-menu__item"
            checked={settings.startFromPlan}
            disabled={!hasPlan}
            onCheckedChange={(checked) => onChange({ startFromPlan: checked === true })}
          >
            <span className="context-menu__icon">
              <DropdownMenu.ItemIndicator>
                <Check size={12} />
              </DropdownMenu.ItemIndicator>
            </span>
            <span className="context-menu__label">
              {t('panels:references.settings.startFromPlan', 'Start from this sequence')}
            </span>
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.Separator className="context-menu__separator" />
          <DropdownMenu.Label className="context-menu__item context-menu__heading">
            {t('panels:references.settings.sequence', 'Folding sequence')}
          </DropdownMenu.Label>
          <DropdownMenu.CheckboxItem
            className="context-menu__item"
            checked={landmarksFirst}
            onCheckedChange={() => onToggleLandmarksFirst()}
          >
            <span className="context-menu__icon">
              <DropdownMenu.ItemIndicator>
                <Check size={12} />
              </DropdownMenu.ItemIndicator>
            </span>
            <span className="context-menu__label">
              {t('panels:references.settings.landmarksFirst', 'Landmarks first')}
            </span>
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.CheckboxItem
            className="context-menu__item"
            checked={settings.precreaseGrid}
            onCheckedChange={(checked) => onChange({ precreaseGrid: checked === true })}
          >
            <span className="context-menu__icon">
              <DropdownMenu.ItemIndicator>
                <Check size={12} />
              </DropdownMenu.ItemIndicator>
            </span>
            <span className="context-menu__label">
              {t('panels:references.settings.precreaseGrid', 'Precrease grid')}
            </span>
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.CheckboxItem
            className="context-menu__item"
            checked={settings.showPinches}
            onCheckedChange={(checked) => onChange({ showPinches: checked === true })}
          >
            <span className="context-menu__icon">
              <DropdownMenu.ItemIndicator>
                <Check size={12} />
              </DropdownMenu.ItemIndicator>
            </span>
            <span className="context-menu__label">
              {t('panels:references.settings.showPinches', 'Show pinches')}
            </span>
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
