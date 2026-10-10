import { useTranslation } from 'react-i18next';
import { textSizeId, textSizeOfId, textSizeOptions } from '../../diagram/annotate/annotateTools';
import { annotationInkColor } from '../../diagram/annotate/annotationPrimitives';
import { DEFAULT_DIAGRAM_STYLE } from '../../diagram/document/diagramDocument';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { FieldRow, SelectRow, ToggleRow } from '../ui/fieldRows';
import { DiagramColorSelect } from './DiagramColorSelect';

/** The next label's defaults. Existing labels keep their own properties in Layers. */
export function DiagramTextStyleControl({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const style = useSettingsStore((state) => state.diagramAnnotateTextStyle);
  const setStyle = useSettingsStore((state) => state.setDiagramAnnotateTextStyle);
  const diagramStyle = useWorkspaceStore((state) => state.diagram?.style ?? DEFAULT_DIAGRAM_STYLE);
  const colorLabel = t('panels:diagram.annotate.textColor', 'Text Color');
  return (
    <>
      <FieldRow label={colorLabel} kind="select" disabled={disabled}>
        <DiagramColorSelect
          variant="row"
          label={colorLabel}
          value={style.color}
          ink={annotationInkColor(diagramStyle)}
          disabled={disabled}
          onChange={(color) => setStyle({ color })}
        />
      </FieldRow>
      <ToggleRow label={t('panels:diagram.annotations.bold', 'Bold')} checked={style.bold} disabled={disabled} onChange={(bold) => setStyle({ bold })} />
      <ToggleRow
        label={t('panels:diagram.annotations.halo', 'Halo')}
        help={t('panels:diagram.annotations.haloHelp', 'Outlines the text so it reads over lines: in the colour of a References sheet under it, and in white anywhere else.')}
        checked={style.halo}
        disabled={disabled}
        onChange={(halo) => setStyle({ halo })}
      />
      <SelectRow
        label={t('panels:diagram.annotations.textSize', 'Size')}
        value={textSizeId(style.sizePt)}
        options={textSizeOptions(t, style.sizePt)}
        disabled={disabled}
        onChange={(id) => setStyle({ sizePt: textSizeOfId(id) })}
      />
    </>
  );
}
