/**
 * Put this tool's settings back to their defaults.
 *
 * # Why it is conditional, and why that is the whole design
 *
 * It renders **only when a setting in the visible groups is off its default**, so
 * one control does two jobs: it is the way back, and its presence is the only
 * signal a user gets that something here is non-default and may have been carried
 * over from a previous session (see `lib/cpToolOptionPersistence.ts`). Without
 * that, a remembered setting is invisible until it surprises someone — a tool
 * behaving oddly with no indication why.
 *
 * Scoped to the groups on screen rather than every option there is: "put this
 * tool back to normal", not "discard everything I have ever configured". Losing
 * a carefully set angle system because you wanted to fix polygon corners would
 * make the control something people learn to avoid.
 */
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { hasNonDefaultCpToolOptions, resetCpToolOptions } from '../../lib/cpToolOptionPersistence';
import {
  cpToolOptionKeysForGroups,
  type OristudioCpToolOptions,
  type OristudioCpToolSettingGroup,
} from '../../lib/oristudioCpToolSettings';

export function CpContextToolReset({
  options,
  setOptions,
  groups,
}: {
  options: OristudioCpToolOptions;
  setOptions: Dispatch<SetStateAction<OristudioCpToolOptions>>;
  /** The setting groups currently on screen — the reset's scope. */
  groups: readonly OristudioCpToolSettingGroup[];
}) {
  const { t } = useTranslation();
  const keys = cpToolOptionKeysForGroups(groups);
  if (!hasNonDefaultCpToolOptions(options, keys)) return null;

  return (
    <button
      className="cp-context-panel__reset"
      type="button"
      onClick={() => setOptions((current) => resetCpToolOptions(current, keys))}
      title={t(
        'tools:cpContext.resetSettingsHint',
        'A setting here is not its default. Some settings are remembered between sessions.',
      )}
    >
      <RotateCcw size={11} />
      {t('tools:cpContext.resetSettings', 'Reset')}
    </button>
  );
}
