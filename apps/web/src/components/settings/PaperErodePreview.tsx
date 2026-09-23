/**
 * Erode, seen: a close-up of a paper corner where a valley fold runs into the
 * paper's edge and an aux crease stops short of it by the style's erode.
 * Erode is the aux pen's alone — a fold is drawn to the edge — so the fold is
 * there for contrast.
 *
 * Erode is a share of the whole sheet, and at any size a settings card can
 * give a whole sheet it is invisible — half a percent of an 80 px thumbnail is
 * 0.4 px. So this is a close-up: a tenth of the sheet fills it. The geometry
 * is magnified and the pens are not, which is how a zoomed canvas draws them
 * too — the lines keep the weight they draw at, and only the gap grows.
 */
import { useTranslation } from 'react-i18next';
import { PT_TO_CSS_PX, type PaperStyle, type Pen } from '../../lib/paper/paperStyle';

/** The close-up's box, in CSS px. */
const WIDTH = 120;
const HEIGHT = 72;
/** How much of the sheet the box's width shows. */
export const ERODE_PREVIEW_SHEET_SHARE = 0.1;
/** Where the paper's corner is: its right and bottom edges. */
const EDGE_X = 104;
const EDGE_Y = 60;
/** The valley fold's row, and the aux crease's column. */
const FOLD_Y = 26;
const CREASE_X = 54;

/** The gap erode leaves at the edge, in the close-up's px. */
export function erodePreviewGap(erode: number): number {
  return (erode * WIDTH) / ERODE_PREVIEW_SHEET_SHARE;
}

/** A pen as SVG stroke attributes, at its on-screen weight. */
function stroke(pen: Pen) {
  const width = pen.width * PT_TO_CSS_PX;
  return {
    stroke: pen.color,
    strokeWidth: width,
    strokeLinecap: pen.cap,
    strokeDasharray: pen.dash ? pen.dash.map((run) => run * width).join(' ') : undefined,
    fill: 'none',
  };
}

export function PaperErodePreview({ style }: { style: PaperStyle }) {
  const { t } = useTranslation();
  const creaseEnd = EDGE_Y - erodePreviewGap(style.erode);
  const label = t(
    'dialogs:settings.paper.erodePreview',
    'Close-up of a tenth of the sheet: a valley fold running to the paper’s edge, and an auxiliary crease stopping short of it'
  );
  return (
    <figure className="settings-paper-erode">
      <svg
        className="settings-paper-erode__picture"
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={label}
      >
        <rect x={0} y={0} width={EDGE_X} height={EDGE_Y} fill={style.paper.front} />
        <line
          data-role="valley"
          x1={0}
          y1={FOLD_Y}
          x2={EDGE_X}
          y2={FOLD_Y}
          {...stroke(style.valleyFolds)}
        />
        {/* Only while the style draws aux creases: the close-up shows what the style does. */}
        {style.auxCreases.visible && creaseEnd > 0 && (
          <line
            data-role="aux"
            x1={CREASE_X}
            y1={0}
            x2={CREASE_X}
            y2={creaseEnd}
            {...stroke(style.auxCreases.pen)}
          />
        )}
        <polyline
          data-role="edge"
          points={`${EDGE_X},0 ${EDGE_X},${EDGE_Y} 0,${EDGE_Y}`}
          {...stroke(style.edges)}
        />
      </svg>
      <figcaption className="settings-paper-erode__caption">
        {t('dialogs:settings.paper.erodeCloseUp', 'Close-up')}
      </figcaption>
    </figure>
  );
}
