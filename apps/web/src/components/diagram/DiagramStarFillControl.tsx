import { useTranslation } from 'react-i18next';
import { starFillLabel } from '../../diagram/annotate/annotateTools';
import { STAR_FILLS, type DiagramStarFill } from '../../diagram/annotate/starFill';
import { useSettingsStore } from '../../store/settingsStore';
import { SegmentedControl } from '../ui/SegmentedControl';
import { StarGlyph } from './DiagramAnnotateToolGlyph';

/**
 * The rail's Star Fill (Revision 3, R3-4 C), while the Star tool is in hand:
 * Filled or Outline, each drawn as a small star — the next star's fill, so
 * ★ and ☆ are each laid with a click. A preference, kept as it was left, as
 * Line Type is; filled until one is chosen, as the star in Zach's sample is.
 */
export function DiagramStarFillControl({ label, disabled }: { label: string; disabled: boolean }) {
  const { t } = useTranslation();
  const fill = useSettingsStore((state) => state.diagramAnnotateStarFill);
  const setFill = useSettingsStore((state) => state.setDiagramAnnotateStarFill);
  const help = t('panels:diagram.annotate.starFillHelp', 'How the Star tool draws the next star.');
  return (
    <SegmentedControl<DiagramStarFill>
      size="lg"
      fill
      iconsOnly
      tooltipSide="right"
      aria-label={label}
      value={fill}
      disabled={disabled}
      options={STAR_FILLS.map((value) => {
        const name = starFillLabel(t, value);
        return { value, label: name, icon: <StarGlyph fill={value} />, tooltip: `${name} - ${help}` };
      })}
      onChange={setFill}
    />
  );
}
