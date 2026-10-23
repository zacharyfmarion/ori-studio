/**
 * A step diagram as data: the primitives a picture of a step is drawn from,
 * and the model that carries them with their sheet.
 *
 * References makes them from ReferenceFinder's wire and from its planner, the
 * Diagram keeps them in its documents and draws its annotations in them, and
 * every surface draws the one list (`DiagramPrimitives`, `diagramToScene`). A
 * style is a name the picture turns into a CSS class or a pen; the colours are
 * theme tokens, never values carried here.
 */
import type { TurnRotation } from '../steps/turn';
import type { DiagramWhiteArrowFill, DiagramWhiteArrowWidth } from './diagramInk';
import type {
  DiagramArc,
  DiagramCubic,
  DiagramSheet,
  HiddenStretches,
  PathArrowFold,
  WhiteArrowTail,
} from './stepDiagramGeometry';

export type DiagramLineStyleName =
  /** A crease an earlier step made: the paper as it stands. */
  | 'crease'
  /**
   * One of the pattern's own auxiliary lines — ours, never on the RF wire. The
   * same pen and ink as `crease`; its own name because whether it is drawn is
   * the References "Show auxiliary creases" option's, while the creases an
   * earlier step made are always on the paper.
   */
  | 'aux'
  | 'edge'
  | 'highlight'
  /**
   * The step's own fold, as an instruction: fold here, this way. Drawn in the
   * paper style's diagram-crease pens, as are the pinches in a direction.
   */
  | 'valley'
  | 'mountain'
  /**
   * A line of the finished crease pattern — ours, never on the RF wire. The
   * finished card is the pattern rather than a step, so its creases take the
   * fold pens a crease pattern is drawn in, not the diagram-crease pens of an
   * instruction.
   */
  | 'fold-valley'
  | 'fold-mountain'
  | 'arrow'
  | 'dotted'
  | 'pinch'
  /** A pinch in a known direction — ours; the wire's `pinch` carries none. */
  | 'pinch-mountain'
  | 'pinch-valley'
  /** The rest of a fold that is not creased — ours, never on the RF wire. */
  | 'unfolded';

export type DiagramPointStyleName = 'normal' | 'highlight' | 'action';

export type StepDiagramPrimitive =
  | { kind: 'sheet'; width: number; height: number }
  | {
      kind: 'line';
      from: readonly [number, number];
      to: readonly [number, number];
      style: DiagramLineStyleName;
      /**
       * Where this piece starts along its line's own axis, in sheet units.
       *
       * A crease drawn as several pieces restarts its dash at each one, which
       * is a row of unrelated dashes rather than a dashed line. Set from
       * `dashRulerAlong` so every piece of one line measures from the same
       * zero. Omitted leaves the pattern starting at `from`, which is right for
       * a line drawn whole.
       */
      dashPhase?: number;
      /**
       * Its own colour, over its style's: a Diagram solid line's (17a of
       * `diagram-references-annotations.md`). References never sets it, so a
       * card and its goldens draw as they did; a stored card never carries it.
       */
      ink?: string;
      /**
       * Its stretches behind a flap, as shares of its length from `from`,
       * dotted in its own pen and colour as an arrow's are (15e): a Diagram
       * solid line's. References never sets it.
       */
      hidden?: HiddenStretches;
    }
  | {
      kind: 'arc';
      center: readonly [number, number];
      radius: number;
      from: number;
      to: number;
      ccw: boolean;
      style: DiagramLineStyleName;
    }
  /**
   * The path the paper takes over a crease and back.
   *
   * Only the outgoing arc: the return that makes it a round trip is the *same*
   * arc bulged further and stopped beside the mark, and how far beside is a
   * length of the drawing's (`foldReturnOffset`) — which a card measures
   * against the paper and a camera view against the pen. So it is derived where
   * the picture is drawn, and this stays the one thing both surfaces agree on.
   */
  | { kind: 'fold-arrow'; out: DiagramArc; hidden?: HiddenStretches }
  /**
   * A fold that is made and kept: the paper goes over along `out` and stays.
   * The head says which way (Yoshizawa–Randlett): a valley fold's is the
   * fold-and-unfold arrow's filled head, a mountain fold's one-sided and
   * hollow. Its size is the drawing's, as the fold arrow's is.
   */
  | { kind: 'one-way-arrow'; out: DiagramArc; fold: 'valley' | 'mountain'; hidden?: HiddenStretches }
  /**
   * A fold arrow shaped by hand rather than an arc: its path, tail first, and
   * which fold it says — a valley's or a mountain's head, as a one-way arrow
   * has, or out and back with the fold-and-unfold arrow's return, which is
   * derived from the path where it is drawn (`pathArrowGeometry`) unless it
   * was shaped by hand, when `back` is its own path, from the tip. Its head
   * and return are the drawing's size, as the arc arrows' are.
   */
  | {
      kind: 'path-arrow';
      path: readonly DiagramCubic[];
      fold: PathArrowFold;
      back?: readonly DiagramCubic[];
      hidden?: HiddenStretches;
    }
  /**
   * Push here — a squash, a sink, a reverse fold's push: a straight hollow
   * arrow with a cleft tail, from `from` to its tip at `to`. Its width is the
   * drawing's.
   */
  | { kind: 'push-arrow'; from: readonly [number, number]; to: readonly [number, number] }
  /**
   * Crimp or pleat here (Phase 15c): a straight arrow from `from` to its tip
   * at `to`, its shaft a lightning bolt with `kinks` Zs, which step to the
   * right of the way it points on the paper or, `mirrored`, to the left, and
   * the valley arrow's head. Its Zs are the drawing's size, as a push arrow's
   * outline is.
   */
  | {
      kind: 'pleat-arrow';
      from: readonly [number, number];
      to: readonly [number, number];
      kinks: number;
      mirrored: boolean;
      hidden?: HiddenStretches;
    }
  /**
   * A white arrow (Phase 14f): a hollow band along a path, tail first, with a
   * straight-backed head at its tip and a tail drawn to a point, cut square or
   * cleft (`whiteArrowOutline`), filled with the ground — or, a solid arrow
   * (15d), with the arrow's ink — and outlined in the arrow's pen. Its width
   * is one of three print sizes, in the drawing's ink, as a push arrow's is.
   */
  | {
      kind: 'white-arrow';
      path: readonly DiagramCubic[];
      width: DiagramWhiteArrowWidth;
      tail: WhiteArrowTail;
      fill: DiagramWhiteArrowFill;
    }
  /**
   * Turn the model round in its plane, centred on `at`: a circle of two
   * arrows going the way it turns, and how far — a fraction of a turn, or an
   * exact angle in degrees (`lib/steps/turn`'s rotation, whose fields it
   * carries). Its size is the drawing's, and it is drawn in screen space, as
   * the turn-over glyph is.
   */
  | ({ kind: 'rotate'; at: readonly [number, number] } & TurnRotation)
  /**
   * The turn-over glyph, centred on `at`.
   *
   * Its size is the drawing's, not the model's — the same reason a fold arrow
   * carries only its outgoing arc. `axis` is the one the model turns about:
   * a vertical axis (the default, and every References step's) turns it left
   * to right and draws the glyph as it is; a horizontal one turns it top to
   * bottom and draws the glyph a quarter turn round.
   */
  | { kind: 'turn-over'; at: readonly [number, number]; axis?: 'vertical' | 'horizontal' }
  /**
   * A right angle marked at `at`: an ∟ with a closed square in its corner,
   * set into the angle off `at` and opening toward `toward` — any point along
   * the diagonal into the angle, as only its direction is read. Its size is
   * the drawing's, as a ring's is; its legs mirror with the paper, parallel
   * to the lines it marks.
   */
  | { kind: 'right-angle'; at: readonly [number, number]; toward: readonly [number, number] }
  /**
   * An angle marked halved (Phase 15b): an arc across the angle at `at`
   * between its two arms — a point along each, only their directions read —
   * with `ticks` across the middle of each half, as a bisector's equal angles
   * are marked. Its size is the drawing's, as a right angle's is; measured
   * after projecting, so it mirrors with the paper.
   */
  | {
      kind: 'angle-mark';
      at: readonly [number, number];
      arms: readonly [readonly [number, number], readonly [number, number]];
      ticks: 1 | 2 | 3;
      /** Optional equal-angle radius in ink units. */
      radiusInk?: number;
    }
  /**
   * Equal divisions of the line from `from` to `to` (Revision 2): a line
   * `offset` ink off it — on the right of the way it runs on the paper or,
   * `mirrored`, the left — cut into `parts` equal parts by dividers square to
   * it, `ticks` across each part, and — `numbered` — the count beside it;
   * `shortDividers`, the dividers between its ends short strokes across its
   * line, not run to the line it measures (Revision 3). The line it measures
   * is the picture's, never drawn here. Its sizes are the drawing's, as an
   * angle mark's are; measured after projecting, so the line stays on the
   * paper's side through a mirror.
   */
  | {
      kind: 'divisions';
      from: readonly [number, number];
      to: readonly [number, number];
      parts: number;
      offset: number;
      mirrored: boolean;
      ticks: 1 | 2 | 3;
      numbered: boolean;
      shortDividers: boolean;
    }
  /**
   * A star naming the point `at` (Revision 3): five points, filled with the
   * marks' ink or — `white` — an outline in a ring's pen, the page's white
   * inside, as a hollow white arrow is. Its size is the drawing's times
   * `scale`, and it is turned `angle` degrees clockwise on the page, one
   * point up at 0: a turned or mirrored projection moves it, but never
   * turns it. Only an annotation draws one; References never emits it.
   */
  | {
      kind: 'star';
      at: readonly [number, number];
      fill: DiagramWhiteArrowFill;
      angle: number;
      scale: number;
    }
  /**
   * An eye in profile centred on `at`, saying where the next view is from
   * (Revision 3): two lids, a cornea and an iris, outline only, in the aux
   * lines' pen. It looks `angle` degrees clockwise from looking right, as the
   * sheet is seen — the sheet's direction (cos, −sin) — and that direction is
   * the paper's: a turned or mirrored projection turns it, unlike a star's
   * turn. Its size is the drawing's times `scale`. Only an annotation draws
   * one; References never emits it.
   */
  | {
      kind: 'eye';
      at: readonly [number, number];
      angle: number;
      scale: number;
    }
  /**
   * A stretch of the paper a step works in, as a light fill under the lines:
   * the band a grid step's lines are made in, between the bounds the folder
   * sights them from. A convex polygon, in sheet units.
   */
  | { kind: 'region'; corners: readonly (readonly [number, number])[] }
  | { kind: 'point'; at: readonly [number, number]; style: DiagramPointStyleName; hidden?: HiddenStretches; radius?: number }
  | { kind: 'label'; at: readonly [number, number]; text: string; style: DiagramPointStyleName };

export interface StepDiagramModel {
  /** The paper's size, and — off the unit frame — where its middle is and which way it lies. */
  sheet: DiagramSheet;
  /** In drawing order, the sheet first. */
  primitives: StepDiagramPrimitive[];
}
