import { useTranslation } from 'react-i18next';
import { textSizeId, textSizeOfId, textSizeOptions } from '../../diagram/annotate/annotateTools';
import { textStyleOf } from '../../diagram/annotate/annotationModel';
import type { TextStyleOption } from '../../diagram/annotate/useStepAnnotations';
import type { KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { SelectRow, ToggleRow } from '../ui/fieldRows';

/**
 * A selected label's Bold, Halo and Size rows in the Layers pane (17b), under
 * its Text and Color rows: Size offers With the picture and the rail's sizes,
 * and a size from a file that is none of these as an item of its own.
 */
export function DiagramTextStyleRows({
  annotation,
  editable,
  onChange,
}: {
  annotation: KnownDiagramAnnotation;
  editable: boolean;
  onChange: (option: TextStyleOption) => void;
}) {
  const { t } = useTranslation();
  const style = textStyleOf(annotation);
  return (
    <>
      <ToggleRow
        label={t('panels:diagram.annotations.bold', 'Bold')}
        checked={style.bold}
        disabled={!editable}
        onChange={(value) => onChange({ option: 'bold', value })}
      />
      <ToggleRow
        label={t('panels:diagram.annotations.halo', 'Halo')}
        help={t('panels:diagram.annotations.haloHelp', 'Outlines the text so it reads over lines: in the colour of a References sheet under it, and in white anywhere else.')}
        checked={style.halo}
        disabled={!editable}
        onChange={(value) => onChange({ option: 'halo', value })}
      />
      <SelectRow
        label={t('panels:diagram.annotations.textSize', 'Size')}
        value={textSizeId(style.sizePt)}
        options={textSizeOptions(t, style.sizePt)}
        disabled={!editable}
        onChange={(id) => onChange({ option: 'size', value: textSizeOfId(id) })}
      />
    </>
  );
}
