import { useTranslation } from 'react-i18next';
import { starFillLabel } from '../../diagram/annotate/annotateTools';
import { STAR_FILLS, type DiagramStarFill } from '../../diagram/annotate/starFill';
import type { KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { SegmentedControl } from '../ui/SegmentedControl';
import { FieldRow } from '../ui/fieldRows';
import { StarGlyph } from './DiagramAnnotateToolGlyph';

/**
 * A selected star's Fill in the Layers pane (Revision 3, R3-4 C): Filled or
 * Outline, each drawn as a small star, as the rail's Star Fill offers them
 * and the white arrow's Fill row is laid out. One unsaid is an outline. One
 * undo step.
 */
export function DiagramStarControls({
  annotation,
  editable,
  onFill,
}: {
  annotation: KnownDiagramAnnotation;
  editable: boolean;
  onFill: (fill: DiagramStarFill) => void;
}) {
  const { t } = useTranslation();
  const fillName = t('panels:diagram.annotations.fill', 'Fill');
  return (
    <FieldRow label={fillName} kind="segmented" disabled={!editable}>
      <SegmentedControl<DiagramStarFill>
        size="sm"
        iconsOnly
        aria-label={fillName}
        value={annotation.fill ?? 'white'}
        disabled={!editable}
        options={STAR_FILLS.map((fill) => ({
          value: fill,
          label: starFillLabel(t, fill),
          tooltip: starFillLabel(t, fill),
          icon: <StarGlyph fill={fill} />,
        }))}
        onChange={onFill}
      />
    </FieldRow>
  );
}
