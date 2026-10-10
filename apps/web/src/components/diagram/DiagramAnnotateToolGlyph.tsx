import type { ReactElement } from 'react';
import { MousePointer2, RotateCw, SplinePointer, Type } from 'lucide-react';
import {
  TURN_OVER_BOX,
  TURN_OVER_HEAD_PATH,
  TURN_OVER_PATH,
  eyePathData,
  eyeShape,
  polygonPathData,
  starPoints,
} from '../../cp-workspace/references/stepDiagramGeometry';
import {
  ANGLE_BISECTOR,
  EDIT_PATH,
  ENLARGE,
  ENLARGE_FRAME,
  LINE_TOOL,
  SOLID_ARROW,
  type AnnotateTool,
} from '../../diagram/annotate/annotateTools';
import { lineKindOf, type DiagramLineType } from '../../diagram/annotate/lineTypes';
import type { DiagramStarFill } from '../../diagram/annotate/starFill';
import type { DiagramAnnotationKind, DiagramZoomShape } from '../../diagram/document/diagramDocument';

const SIZE = 20;

/** Each line type's dash in a glyph, as its line glyph draws it: none for a solid line. */
const LINE_DASH: Readonly<Record<DiagramLineType, string | undefined>> = {
  valley: '3.2 2.2',
  mountain: '4 1.6 0.8 1.6',
  hidden: '0.9 1.9',
  solid: undefined,
};

/** The shaft every fold arrow's icon shares: a 60° arc, left to right. */
const ARC = 'M3 14 A10.5 10.5 0 0 1 15.2 8.4';

/** One stroke, in the rail's ink or a colour of its own, for an icon drawn here. */
function Glyph({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * Each Annotate tool's icon: Select's and Edit Path's are the app's own; the
 * Line tool's is a line in the type it draws in now; every other tool's is
 * the mark it draws ({@link DiagramAnnotationGlyph}).
 */
export function DiagramAnnotateToolGlyph({
  tool,
  lineType,
  starFill = 'black',
}: {
  tool: AnnotateTool;
  /** The type the Line tool draws in. */
  lineType: DiagramLineType;
  /** The fill the Star tool lays (Revision 3): its icon is the star it lays, as the Line tool's is its line. */
  starFill?: DiagramStarFill;
}): ReactElement {
  if (tool === null) return <MousePointer2 size={17} aria-hidden="true" />;
  if (tool === EDIT_PATH) return <SplinePointer size={17} aria-hidden="true" />;
  if (tool === ANGLE_BISECTOR) {
    // Two arms, and the line halving them in the type it draws in.
    return (
      <Glyph>
        <path d="M3 16.5 L17.5 16.5 M3 16.5 L14 4.5" strokeWidth={1} />
        <path d="M3 16.5 L16.7 10.5" strokeDasharray={LINE_DASH[lineType]} strokeLinecap="butt" />
      </Glyph>
    );
  }
  if (tool === SOLID_ARROW) return <SolidArrowGlyph />;
  if (tool === ENLARGE) return <EnlargeGlyph shape="circle" />;
  if (tool === ENLARGE_FRAME) return <EnlargeGlyph shape="rounded" />;
  if (tool === 'star') return <StarGlyph fill={starFill} />;
  return <DiagramAnnotationGlyph kind={tool === LINE_TOOL ? lineKindOf(lineType) : tool} />;
}

/** A star's corners in a glyph, one point up: the regular star the mark draws (`starPoints`). */
const STAR_GLYPH_PATH = polygonPathData(starPoints({ x: 10, y: 10.6 }, 8.4, 0));

/**
 * A star's icon (Revision 3): filled, or an outline — the Star tool's in the
 * fill it lays, the rail's Fill's two options, and the list's for a star in
 * its own fill. Mitred, as the mark's outline is.
 */
export function StarGlyph({ fill }: { fill: DiagramStarFill }): ReactElement {
  return (
    <Glyph>
      <path
        d={STAR_GLYPH_PATH}
        fill={fill === 'black' ? 'currentColor' : 'none'}
        strokeWidth={fill === 'black' ? 1 : 1.25}
        strokeLinejoin="miter"
        data-glyph-fill={fill}
      />
    </Glyph>
  );
}

/**
 * An enlarge area's icon (Revision 2), in the shape it is drawn: a circle —
 * Enlarge's — or a rounded rectangle — Enlarge in Frame's, and the list's for
 * any area — its corners pushed outward: what a later step shows larger. Not
 * a ring with an arrow off it, which reads as ♂, nor Close-Up's two rings.
 */
export function EnlargeGlyph({ shape }: { shape: DiagramZoomShape }): ReactElement {
  return (
    <Glyph>
      {shape === 'circle' ? <circle cx={10} cy={10} r={5.2} /> : <rect x={5.5} y={5.5} width={9} height={9} rx={2} />}
      <path d="M4.2 4.2 L2 2 M15.8 4.2 L18 2 M15.8 15.8 L18 18 M4.2 15.8 L2 18" />
    </Glyph>
  );
}

/**
 * A solid arrow's icon (15d): the push arrow's straight outline with its tail
 * cut square, filled — the Solid Arrow tool's, and the list's for one.
 */
export function SolidArrowGlyph(): ReactElement {
  return (
    <Glyph>
      <path d="M2.5 7.5 L10 7.5 L10 4 L17.5 10 L10 16 L10 12.5 L2.5 12.5 Z" fill="currentColor" strokeLinejoin="miter" />
    </Glyph>
  );
}

/**
 * Each kind's icon: the mark, small — the rail's tools and the Step pane's
 * list both show it. The fold, push and white arrows are the arrows
 * themselves; the lines are their dash; the circle its ring; the right angle
 * its ∟ and square inside the two lines it marks; equal divisions the
 * template's |\|\| symbol; the callout its line and box; the star, the eye, the oval,
 * the rectangle and the x-ray the marks they draw; Rotate and Label are the app's own icons for those verbs. Every kind
 * has one: the return type makes a kind left out a compile error, not a
 * blank button.
 *
 * `color` is a mark's own colour: a solid line's glyph is drawn in it — a label's too (17b) — so the
 * Layers list tells one line from the next (17a). None is the icon's ink.
 */
export function DiagramAnnotationGlyph({
  kind,
  color,
  fill,
}: {
  kind: DiagramAnnotationKind;
  color?: string;
  /** A star's own fill (Revision 3); unsaid, an outline, as a star with none is. */
  fill?: DiagramStarFill;
}): ReactElement {
  switch (kind) {
    case 'valley-arrow':
      return (
        <Glyph>
          <path d={ARC} />
          <path d="M17.6 9.6 L12.4 10.6 L14.4 5.6 Z" fill="currentColor" strokeWidth={1} />
        </Glyph>
      );
    case 'mountain-arrow':
      return (
        <Glyph>
          <path d={ARC} />
          <path d="M16.6 9.4 L12.4 4.6 L13.4 7.6" strokeLinejoin="miter" />
        </Glyph>
      );
    case 'fold-unfold-arrow':
      return (
        <Glyph>
          <path d="M4.5 13 A9 9 0 0 1 16 10" />
          <path d="M16 10 A11 11 0 0 1 6 16.4" />
          <path d="M3.4 17.2 L8.2 14.6 L8 18.6 Z" fill="currentColor" strokeWidth={1} />
        </Glyph>
      );
    case 'pleat-arrow':
      // A lightning bolt with one Z — `pleatBolt` at this size — and a valley arrow's head.
      return (
        <Glyph>
          <path d="M2.5 14.5 L9.8 8.4 L10.3 12.3 L14.3 9" strokeLinejoin="miter" />
          <path d="M17.6 6.2 L14.1 10.6 L12 6.8 Z" fill="currentColor" strokeWidth={1} />
        </Glyph>
      );
    case 'push-arrow':
      return (
        <Glyph>
          <path d="M2.5 7.5 L10 7.5 L10 4 L17.5 10 L10 16 L10 12.5 L2.5 12.5 L5 10 Z" strokeLinejoin="miter" />
        </Glyph>
      );
    case 'white-arrow':
      // Hollow, curving up into a straight-backed head from a pointed tail: a new one's look.
      return (
        <Glyph>
          <path
            d="M17.8 7.1 L13.3 12.5 L12.9 10 C9 10 5 11.5 2.7 15.5 C3.3 10.5 7 6.4 12.3 5.6 L11.9 3 Z"
            strokeLinejoin="miter"
            strokeMiterlimit={1.5}
          />
        </Glyph>
      );
    case 'turn-over': {
      const scale = 17 / TURN_OVER_BOX.width;
      return (
        <Glyph>
          <g
            transform={`translate(${(SIZE - TURN_OVER_BOX.width * scale) / 2} ${(SIZE - TURN_OVER_BOX.height * scale) / 2}) scale(${scale})`}
          >
            <path d={TURN_OVER_PATH} strokeWidth={1.5 / scale} />
            <path d={TURN_OVER_HEAD_PATH} fill="currentColor" stroke="none" />
          </g>
        </Glyph>
      );
    }
    case 'rotate':
      return <RotateCw size={17} aria-hidden="true" />;
    case 'valley-line':
      return (
        <Glyph>
          <path d="M3 17 L17 3" strokeDasharray="3.2 2.2" strokeLinecap="butt" />
        </Glyph>
      );
    case 'mountain-line':
      return (
        <Glyph>
          <path d="M3 17 L17 3" strokeDasharray="4 1.6 0.8 1.6" strokeLinecap="butt" />
        </Glyph>
      );
    case 'hidden-line':
      return (
        <Glyph>
          <path d="M3 17 L17 3" strokeDasharray="0.9 1.9" strokeLinecap="butt" />
        </Glyph>
      );
    case 'solid-line':
      // A plain stroke, round at its ends as the line is (17a), in the line's colour when it has one.
      return (
        <Glyph color={color}>
          <path d="M3 17 L17 3" />
        </Glyph>
      );
    case 'label':
      // In the label's colour when it has one (17b), as a solid line's glyph is.
      return <Type size={17} color={color} aria-hidden="true" />;
    case 'circle':
      // The ring, round the point it marks.
      return (
        <Glyph>
          <circle cx={10} cy={10} r={6.5} />
          <circle cx={10} cy={10} r={1.3} fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'right-angle':
      // Two lines meeting square, in a hairline, and the mark set into their
      // corner (RA7): its ∟ and the square in the ∟'s corner, clear of them.
      return (
        <Glyph>
          <path d="M3 2.5 L3 17 L17.5 17" strokeWidth={1} data-glyph-part="lines" />
          <path
            d="M6.5 3.5 L6.5 13.5 L16.5 13.5 M11 13.5 L11 9 L6.5 9"
            strokeLinecap="butt"
            strokeLinejoin="miter"
            data-glyph-part="mark"
          />
        </Glyph>
      );
    case 'angle-mark':
      // Two arms, an arc across them, a tick across each half.
      return (
        <Glyph>
          <path d="M3 16.5 L17.5 16.5 M3 16.5 L14 4.5" strokeWidth={1} />
          <path d="M12 16.5 A9 9 0 0 0 9.1 9.9" />
          <path d="M10.4 14.9 L13.2 14.4 M9.2 12.1 L11.5 10.5" strokeWidth={1.1} strokeLinecap="butt" />
        </Glyph>
      );
    case 'divisions':
      // The template's |\|\| symbol (Revision 2): a line cut in two by three
      // dividers straddling it, a tick leaning across each part, 20° off
      // square as a backslash does.
      return (
        <Glyph>
          <path d="M3 10 L17 10" strokeWidth={1} data-glyph-part="line" />
          <path d="M3 5.5 L3 14.5 M10 5.5 L10 14.5 M17 5.5 L17 14.5" strokeLinecap="butt" data-glyph-part="dividers" />
          <path d="M5.63 7.6 L7.37 12.4 M12.63 7.6 L14.37 12.4" strokeLinecap="butt" data-glyph-part="ticks" />
        </Glyph>
      );
    case 'callout':
      // A line from the point it marks up to a box of words: two lines of text in it.
      return (
        <Glyph>
          <circle cx={4} cy={16.5} r={1.3} fill="currentColor" stroke="none" />
          <path d="M4 16.5 L8.5 11.5" />
          <rect x={7.5} y={3.5} width={10} height={8} strokeLinejoin="miter" />
          <path d="M10 6.5 H15 M10 8.75 H13.5" strokeWidth={1.1} />
        </Glyph>
      );
    case 'close-up':
      // A ring round an area, and a larger one beside it, joined rim to rim.
      return (
        <Glyph>
          <circle cx={4.6} cy={15.4} r={2.4} />
          <path d="M6.3 13.7 L9.1 10.9" />
          <circle cx={13} cy={7} r={5.5} />
        </Glyph>
      );
    case 'zoom':
      return <EnlargeGlyph shape="rounded" />;
    case 'star':
      return <StarGlyph fill={fill ?? 'white'} />;
    case 'eye':
      return <EyeGlyph />;
    case 'oval':
      // Upright, about three quarters as wide as it is high, as the turtle's ovals are (Revision 3).
      return (
        <Glyph>
          <ellipse cx={10} cy={10} rx={5.6} ry={7.6} />
        </Glyph>
      );
    case 'rectangle':
      // Its corners square, as the mark's are (R3-11b A): not Enlarge in Frame's rounded ones.
      return (
        <Glyph>
          <rect x={3} y={5} width={14} height={10} strokeLinejoin="miter" />
        </Glyph>
      );
    case 'x-ray':
      return (
        <Glyph>
          <circle cx={10} cy={10} r={7.2} data-glyph-part="rim" />
          <path d="M5.5 8 L10 5.5 L14.5 8 L10 10.5 Z" data-glyph-part="top-layer" />
          <path d="M5.5 11 L10 13.5 L14.5 11 M6.5 14.2 L10 16 L13.5 14.2" data-glyph-part="lower-layers" />
        </Glyph>
      );
  }
}

/** An eye's lids, cornea and iris in a glyph, as the mark draws them (`eyeShape`): looking left, as the eye in Zach's note does. */
const EYE_GLYPH_PATH = eyePathData(eyeShape({ x: 10, y: 10 }, { x: -1, y: 0 }, 17 / 15));

/** The eye's icon (Revision 3): the Eye tool's and the list's, an outline, its back corner mitred as the mark's is. */
export function EyeGlyph(): ReactElement {
  return (
    <Glyph>
      <path d={EYE_GLYPH_PATH} strokeWidth={1.1} strokeLinecap="butt" strokeLinejoin="miter" />
    </Glyph>
  );
}
