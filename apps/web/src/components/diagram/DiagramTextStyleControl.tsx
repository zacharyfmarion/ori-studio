import { useTranslation } from 'react-i18next';
import { ALargeSmall, Bold } from 'lucide-react';
import { textSizeId, textSizeOfId, textSizeOptions } from '../../diagram/annotate/annotateTools';
import { annotationInkColor } from '../../diagram/annotate/annotationPrimitives';
import { DEFAULT_DIAGRAM_STYLE } from '../../diagram/document/diagramDocument';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { ToolRailButtons } from '../ui/ToolRail';
import { DiagramColorSelect } from './DiagramColorSelect';
import { HaloGlyph } from './HaloGlyph';
import styles from './DiagramTextStyleControl.module.css';

/**
 * The rail's Text Style (17b), while the Label tool is in hand: the colour
 * the next label is set in, Bold and Halo, and its Size — one control across
 * the rail, as Line Type is. Each a preference, kept as it was left; their
 * defaults are today's look: the ink, Regular, no halo, with the picture.
 */
export function DiagramTextStyleControl({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const style = useSettingsStore((state) => state.diagramAnnotateTextStyle);
  const setStyle = useSettingsStore((state) => state.setDiagramAnnotateTextStyle);
  const diagramStyle = useWorkspaceStore((state) => state.diagram?.style ?? DEFAULT_DIAGRAM_STYLE);
  const bold = t('panels:diagram.annotations.bold', 'Bold');
  const halo = t('panels:diagram.annotations.halo', 'Halo');
  const haloHelp = t('panels:diagram.annotations.haloHelp', 'Outlines the text so it reads over lines: in the colour of a References sheet under it, and in white anywhere else.');
  const size = t('panels:diagram.annotations.textSize', 'Size');
  return (
    <div className={styles.control}>
      <DiagramColorSelect
        variant="rail"
        label={t('panels:diagram.annotate.textColor', 'Text Color')}
        value={style.color}
        ink={annotationInkColor(diagramStyle)}
        disabled={disabled}
        onChange={(color) => setStyle({ color })}
      />
      {/*
        Toggles in the rail's own grid, looking as its tools do: clear at rest, the
        accent's wash while on. Their tooltips open above, so Bold's never lies over
        Halo beside it.
      */}
      <ToolRailButtons
        tools={[
          {
            id: 'bold',
            label: bold,
            tooltip: bold,
            glyph: <Bold size={17} strokeWidth={2.75} aria-hidden="true" />,
            active: style.bold,
            toggle: true,
            available: !disabled,
            tooltipSide: 'top',
            onSelect: () => setStyle({ bold: !style.bold }),
          },
          {
            id: 'halo',
            label: halo,
            tooltip: `${halo} - ${haloHelp}`,
            glyph: <HaloGlyph />,
            active: style.halo,
            toggle: true,
            available: !disabled,
            tooltipSide: 'top',
            onSelect: () => setStyle({ halo: !style.halo }),
          },
        ]}
      />
      {/* Its own row: With the picture is cut short beside the toggles in the rail’s column. */}
      <span className={styles.size}>
        <Select
          value={textSizeId(style.sizePt)}
          disabled={disabled}
          onValueChange={(id) => setStyle({ sizePt: textSizeOfId(id) })}
        >
          <SelectTrigger aria-label={size} title={size}>
            {/* What it sets, as the colour select's swatch says its colour: an option alone does not say it is a size. */}
            <ALargeSmall size={14} aria-hidden="true" data-glyph="text-size" />
            <SelectValue className={styles.sizeValue} />
          </SelectTrigger>
          <SelectContent>
            {textSizeOptions(t, style.sizePt).map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
    </div>
  );
}
