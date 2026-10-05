import { useTranslation } from 'react-i18next';
import type { DiagramWhiteArrowWidth } from '../../cp-workspace/references/diagram/diagramInk';
import type { WhiteArrowTail } from '../../cp-workspace/references/stepDiagramGeometry';
import { DEFAULT_WHITE_ARROW } from '../../diagram/annotate/annotationModel';
import type { KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { SegmentedRow } from '../ui/fieldRows';

/** What a white arrow looks like: the two presets the Step pane sets, either alone. */
export interface WhiteArrowLook {
  width?: DiagramWhiteArrowWidth;
  tail?: WhiteArrowTail;
}

const WIDTHS: readonly DiagramWhiteArrowWidth[] = ['narrow', 'regular', 'wide'];
const TAILS: readonly WhiteArrowTail[] = ['pointed', 'square', 'cleft'];

/**
 * A selected white arrow's look in the Step pane (Q13, decision 14): its
 * width — three print sizes, in ink, as every mark's is — and its tail, each
 * one undo step. One unsaid is the template's (`DEFAULT_WHITE_ARROW`).
 */
export function DiagramWhiteArrowControls({
  annotation,
  editable,
  onChange,
}: {
  annotation: KnownDiagramAnnotation;
  editable: boolean;
  onChange: (look: WhiteArrowLook) => void;
}) {
  const { t } = useTranslation();
  const widthLabel = (width: DiagramWhiteArrowWidth) => {
    switch (width) {
      case 'narrow':
        return t('panels:diagram.annotations.widthNarrow', 'Narrow');
      case 'regular':
        return t('panels:diagram.annotations.widthRegular', 'Regular');
      case 'wide':
        return t('panels:diagram.annotations.widthWide', 'Wide');
    }
  };
  const tailLabel = (tail: WhiteArrowTail) => {
    switch (tail) {
      case 'pointed':
        return t('panels:diagram.annotations.tailPointed', 'Pointed');
      case 'square':
        return t('panels:diagram.annotations.tailSquare', 'Square');
      case 'cleft':
        return t('panels:diagram.annotations.tailCleft', 'Cleft');
    }
  };
  return (
    <>
      <SegmentedRow
        label={t('panels:diagram.annotations.width', 'Width')}
        value={annotation.width ?? DEFAULT_WHITE_ARROW.width}
        disabled={!editable}
        options={WIDTHS.map((width) => ({ id: width, label: widthLabel(width) }))}
        onChange={(width) => onChange({ width: width as DiagramWhiteArrowWidth })}
      />
      <SegmentedRow
        label={t('panels:diagram.annotations.tail', 'Tail')}
        value={annotation.tail ?? DEFAULT_WHITE_ARROW.tail}
        disabled={!editable}
        options={TAILS.map((tail) => ({ id: tail, label: tailLabel(tail) }))}
        onChange={(tail) => onChange({ tail: tail as WhiteArrowTail })}
      />
    </>
  );
}
