/**
 * The Square tool's params: size, unit, orientation, anchor, line type.
 *
 * A child component rather than another branch in `CpContextToolPanel`, per
 * AGENTS.md — presentation belongs beside its concern, and five controls is more
 * than a composition site should be holding.
 */
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import {
  ORISTUDIO_CP_SQUARE_ANCHORS,
  type OristudioCpSquareAnchor,
  type OristudioCpSquareLineType,
  type OristudioCpSquareOrientation,
  type OristudioCpSquareSizeUnit,
  type OristudioCpToolOptions,
} from '../../lib/oristudioCpToolSettings';
import { convertSquareSize } from '../tools/squareTool';
import { NumericToolOption } from './NumericToolOption';

export function SquareToolOptions({
  options,
  setOptions,
  gridWidth,
}: {
  options: OristudioCpToolOptions;
  setOptions: Dispatch<SetStateAction<OristudioCpToolOptions>>;
  /** Active grid width in model units, for the cells ↔ paper conversion. */
  gridWidth: number | undefined;
}) {
  const { t } = useTranslation(['tools']);

  const setSizeUnit = (squareSizeUnit: OristudioCpSquareSizeUnit) =>
    setOptions((current) =>
      current.squareSizeUnit === squareSizeUnit
        ? current
        : {
            ...current,
            squareSizeUnit,
            // Convert rather than reinterpret: switching the unit is a change of
            // notation, not a request for a square 32x the size.
            squareSize: convertSquareSize(
              current.squareSize,
              current.squareSizeUnit,
              squareSizeUnit,
              gridWidth
            ),
          }
    );

  return (
    <div className="cp-context-panel__group">
      <div className="cp-context-panel__group-title">{t('tools:cpContext.square', 'Square')}</div>

      <NumericToolOption
        label={t('tools:cpContext.squareSize', 'Size')}
        ariaLabel={t('tools:cpContext.squareSizeAria', 'Square size')}
        min={0}
        max={1000}
        // Whole cells are the common case; a half-cell square is still typable.
        step={options.squareSizeUnit === 'grid' ? 1 : 0.05}
        value={options.squareSize}
        onChange={(squareSize) => setOptions((current) => ({ ...current, squareSize }))}
      />

      <SegmentedToolOption
        label={t('tools:cpContext.squareUnit', 'Unit')}
        ariaLabel={t('tools:cpContext.squareSizeUnitAria', 'Square size unit')}
        value={options.squareSizeUnit}
        options={[
          {
            value: 'grid',
            label: t('tools:cpContext.squareUnitGrid', 'Cells'),
            title: t('tools:cpContext.squareUnitGridHint', 'Size in grid cells'),
          },
          {
            value: 'paper',
            label: t('tools:cpContext.squareUnitPaper', 'Paper'),
            title: t('tools:cpContext.squareUnitPaperHint', 'Size as a fraction of the paper edge'),
          },
        ]}
        onChange={setSizeUnit}
      />

      <SegmentedToolOption
        label={t('tools:cpContext.squareOrientation', 'Orientation')}
        ariaLabel={t('tools:cpContext.squareOrientationAria', 'Square orientation')}
        value={options.squareOrientation}
        options={[
          {
            value: 'normal',
            label: t('tools:cpContext.squareOrientationNormal', 'Normal'),
            title: t('tools:cpContext.squareOrientationNormalHint', 'Edges along the grid axes'),
          },
          {
            value: 'diagonal',
            label: t('tools:cpContext.squareOrientationDiagonal', 'Diagonal'),
            title: t(
              'tools:cpContext.squareOrientationDiagonalHint',
              'The same square, turned 45 degrees'
            ),
          },
        ]}
        onChange={(squareOrientation: OristudioCpSquareOrientation) =>
          setOptions((current) => ({ ...current, squareOrientation }))
        }
      />

      <SquareAnchorPicker
        value={options.squareAnchor}
        onChange={(squareAnchor) => setOptions((current) => ({ ...current, squareAnchor }))}
      />

      <SegmentedToolOption
        label={t('tools:cpContext.squareLineType', 'Line type')}
        ariaLabel={t('tools:cpContext.squareLineTypeAria', 'Square line type')}
        value={options.squareLineType}
        options={[
          {
            value: 'edge',
            label: t('tools:cpContext.squareLineTypeEdge', 'Edge'),
            title: t('tools:cpContext.squareLineTypeEdgeHint', 'Always draw the square as edges'),
          },
          {
            value: 'active',
            label: t('tools:cpContext.squareLineTypeActive', 'Active'),
            title: t(
              'tools:cpContext.squareLineTypeActiveHint',
              'Draw the square in the active line type'
            ),
          },
        ]}
        onChange={(squareLineType: OristudioCpSquareLineType) =>
          setOptions((current) => ({ ...current, squareLineType }))
        }
      />
    </div>
  );
}

/**
 * A segmented control on the same label-left / control-right row as
 * `NumericToolOption`.
 *
 * A bare full-width toggle reads as a mode switch for the whole group rather
 * than as one param among several — with three of them stacked, nothing said
 * which was which. Sharing the field grid puts every param on one column and
 * makes the answer to "what does this choose?" the text beside it.
 *
 * A `div` rather than the `label` element the numeric field uses: a label points
 * at a single control, and this names a group of buttons. The group carries its
 * own `aria-label`, so the accessible name does not depend on the visible text.
 */
function SegmentedToolOption<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="cp-context-panel__field">
      <span>{label}</span>
      <SegmentedControl aria-label={ariaLabel} value={value} options={options} onChange={onChange} />
    </div>
  );
}

/**
 * Where on the square's bounding box the click lands, as a 3×3 transform-origin
 * picker.
 *
 * The nine cells describe the *bounding box*, not the square, which is why this
 * control is unaffected by the orientation above it: the positions mean the same
 * thing whichever way the square is turned. The square has four corners either
 * way — they land on the corner cells when normal and on the side cells when
 * diagonal — so nothing here has to change shape when the orientation flips.
 */
function SquareAnchorPicker({
  value,
  onChange,
}: {
  value: OristudioCpSquareAnchor;
  onChange: (anchor: OristudioCpSquareAnchor) => void;
}) {
  const { t } = useTranslation(['tools']);

  return (
    <div className="cp-context-panel__field cp-context-panel__field--anchor">
      <span>{t('tools:cpContext.squareAnchor', 'Anchor')}</span>
      <div
        className="cp-square-anchor"
        role="radiogroup"
        aria-label={t('tools:cpContext.squareAnchorAria', 'Square anchor')}
      >
        {ORISTUDIO_CP_SQUARE_ANCHORS.map((anchor) => (
          <button
            key={anchor}
            type="button"
            role="radio"
            aria-checked={anchor === value}
            aria-label={squareAnchorLabel(t, anchor)}
            title={squareAnchorLabel(t, anchor)}
            data-active={anchor === value || undefined}
            className="cp-square-anchor__cell"
            onClick={() => onChange(anchor)}
          />
        ))}
      </div>
    </div>
  );
}

function squareAnchorLabel(
  t: ReturnType<typeof useTranslation<['tools']>>['t'],
  anchor: OristudioCpSquareAnchor
): string {
  switch (anchor) {
    case 'top-left':
      return t('tools:cpContext.squareAnchorTopLeft', 'Top left');
    case 'top-center':
      return t('tools:cpContext.squareAnchorTopCenter', 'Top center');
    case 'top-right':
      return t('tools:cpContext.squareAnchorTopRight', 'Top right');
    case 'middle-left':
      return t('tools:cpContext.squareAnchorMiddleLeft', 'Middle left');
    case 'center':
      return t('tools:cpContext.squareAnchorCenter', 'Center');
    case 'middle-right':
      return t('tools:cpContext.squareAnchorMiddleRight', 'Middle right');
    case 'bottom-left':
      return t('tools:cpContext.squareAnchorBottomLeft', 'Bottom left');
    case 'bottom-center':
      return t('tools:cpContext.squareAnchorBottomCenter', 'Bottom center');
    case 'bottom-right':
      return t('tools:cpContext.squareAnchorBottomRight', 'Bottom right');
  }
}
