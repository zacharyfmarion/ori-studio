import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagramWhiteArrowFill, DiagramWhiteArrowWidth } from '../../cp-workspace/references/diagram/diagramInk';
import type { WhiteArrowTail } from '../../cp-workspace/references/stepDiagramGeometry';
import { DEFAULT_WHITE_ARROW, type WhiteArrowLook } from '../../diagram/annotate/annotationModel';
import type { KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { SegmentedControl } from '../ui/SegmentedControl';
import { FieldRow } from '../ui/fieldRows';

const WIDTHS: readonly DiagramWhiteArrowWidth[] = ['narrow', 'regular', 'wide'];
const TAILS: readonly WhiteArrowTail[] = ['pointed', 'square', 'cleft'];
const FILLS: readonly DiagramWhiteArrowFill[] = ['white', 'black'];

/** A small arrow, left to right, in the control's ink — hollow, or `filled` — each preset as it draws. */
function ArrowMark({ d, filled = false }: { d: string; filled?: boolean }): ReactElement {
  return (
    <svg
      width={24}
      height={16}
      viewBox="0 0 24 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.25}
      aria-hidden="true"
    >
      <path d={d} strokeLinejoin="miter" strokeMiterlimit={1.5} />
    </svg>
  );
}

/** A straight arrow's outline with a shaft `shaft` wide and a head `head` wide, square at its tail. */
const straight = (shaft: number, head: number) =>
  `M2 ${8 - shaft / 2} L15 ${8 - shaft / 2} L15 ${8 - head / 2} L22 8 L15 ${8 + head / 2} L15 ${8 + shaft / 2} L2 ${8 + shaft / 2} Z`;

const WIDTH_MARKS: Readonly<Record<DiagramWhiteArrowWidth, string>> = {
  narrow: straight(3, 8),
  regular: straight(5, 11),
  wide: straight(7, 13),
};

const TAIL_MARKS: Readonly<Record<WhiteArrowTail, string>> = {
  pointed: 'M2 8 L15 5.5 L15 2.5 L22 8 L15 13.5 L15 10.5 Z',
  square: 'M2 5.5 L15 5.5 L15 2.5 L22 8 L15 13.5 L15 10.5 L2 10.5 Z',
  cleft: 'M2 5.5 L15 5.5 L15 2.5 L22 8 L15 13.5 L15 10.5 L2 10.5 L5.5 8 Z',
};

/**
 * A selected white arrow's look in the Step pane (Q13, decision 14): its
 * width — three print sizes, in ink, as every mark's is — its tail, and its
 * fill, the page's white or the arrow's ink (15d), each one undo step. One
 * unsaid is the template's (`DEFAULT_WHITE_ARROW`), and white. Each
 * option is a small arrow drawn as it would be, named by its tooltip and to
 * a screen reader: three words to a row do not fit a pane as narrow as an
 * iPad's.
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
  const fillLabel = (fill: DiagramWhiteArrowFill) =>
    fill === 'black' ? t('panels:diagram.annotations.fillBlack', 'Black') : t('panels:diagram.annotations.fillWhite', 'White');
  const widthName = t('panels:diagram.annotations.width', 'Width');
  const tailName = t('panels:diagram.annotations.tail', 'Tail');
  const fillName = t('panels:diagram.annotations.fill', 'Fill');
  return (
    <>
      <FieldRow label={widthName} kind="segmented" disabled={!editable}>
        <SegmentedControl<DiagramWhiteArrowWidth>
          size="sm"
          iconsOnly
          aria-label={widthName}
          value={annotation.width ?? DEFAULT_WHITE_ARROW.width}
          disabled={!editable}
          options={WIDTHS.map((width) => ({
            value: width,
            label: widthLabel(width),
            tooltip: widthLabel(width),
            icon: <ArrowMark d={WIDTH_MARKS[width]} />,
          }))}
          onChange={(width) => onChange({ width })}
        />
      </FieldRow>
      <FieldRow label={tailName} kind="segmented" disabled={!editable}>
        <SegmentedControl<WhiteArrowTail>
          size="sm"
          iconsOnly
          aria-label={tailName}
          value={annotation.tail ?? DEFAULT_WHITE_ARROW.tail}
          disabled={!editable}
          options={TAILS.map((tail) => ({
            value: tail,
            label: tailLabel(tail),
            tooltip: tailLabel(tail),
            icon: <ArrowMark d={TAIL_MARKS[tail]} />,
          }))}
          onChange={(tail) => onChange({ tail })}
        />
      </FieldRow>
      <FieldRow label={fillName} kind="segmented" disabled={!editable}>
        <SegmentedControl<DiagramWhiteArrowFill>
          size="sm"
          iconsOnly
          aria-label={fillName}
          value={annotation.fill ?? 'white'}
          disabled={!editable}
          options={FILLS.map((fill) => ({
            value: fill,
            label: fillLabel(fill),
            tooltip: fillLabel(fill),
            icon: <ArrowMark d={TAIL_MARKS.square} filled={fill === 'black'} />,
          }))}
          onChange={(fill) => onChange({ fill })}
        />
      </FieldRow>
    </>
  );
}
