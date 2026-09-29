/**
 * What a paper surface hands the export dialog: its picture, captured when the
 * dialog opens, and what the dialog needs to know about it.
 *
 * A surface's export verb no longer saves. It captures what it would have
 * exported at that moment into a target — the diagram and camera, the folded
 * figure's model, the simulation's positions — and opens the dialog on it, so
 * every repaint and rebuild the dialog makes works from that one capture
 * (X3 in `implementation-plans/paper-export-dialog.md`).
 *
 * React-free and store-free: a target is data plus the producer that turns a
 * style and a page's background into a scene, so the dialog can be driven by
 * a fake one in a test.
 */
import type { PaperExportScope } from '../analytics/events';
import type { PaperScene } from '../lib/paper/paperScene';
import type { Hex, PaperStyle, PaperStyleOverrides } from '../lib/paper/paperStyle';
import type { PaperSurface } from '../lib/paper/paperStyleResolve';
import type { PaperExportMark, PaperExportMarks } from '../lib/paperExportSettings';

/** What a scene is built from, beyond the capture itself. */
export interface PaperSceneInput {
  /** Which of the target's pages; 0 for a target with one picture. */
  page: number;
  /** The style the page is painted with, before the surface's policy. */
  style: PaperStyle;
  /**
   * Mark the pieces no pixel of the page shows, so the painter can drop them.
   * Only asked for when the page drops them: the hidden test is the expensive
   * half of building a scene.
   */
  markHidden: boolean;
  /** The page's background, or null for a transparent one: the ground a mark off the paper is drawn against. */
  background: Hex | null;
  /**
   * Which of a diagram's marks the page carries; absent carries every one.
   * Read only by a target that declares them (`PaperExportTarget.marks`), and
   * then part of its key. The dialog always fills it (`paperExportSceneInput`).
   */
  marks?: PaperExportMarks;
}

/** One page of a target that has several: a step of a References sequence. */
export interface PaperExportPage {
  /** Its name in the dialog's pager: "Step 3", "Turn over". */
  label: string;
  /** Its file's name inside the ZIP, before sanitising and without an extension. */
  fileStem: string;
}

/**
 * The pages of a target that has more than one picture, all captured when the
 * dialog opens. The dialog exports the page on show, or every page as a ZIP.
 */
export interface PaperExportPages {
  list: readonly PaperExportPage[];
  /** The page the surface was showing: the one "this step" exports. */
  current: number;
  /** The dialog's title while it exports every page: "Export all steps". */
  title: string;
  /** The ZIP's name, before sanitising and without an extension. */
  zipStem: string;
}

/**
 * A picture the options cannot change: a folded figure saved before its
 * picture could be repainted, which exports as it was drawn (E9).
 */
export interface PaperExportFixedPicture {
  svg: string;
  /** The picture's size in CSS px, which is its PNG's too. */
  widthPx: number;
  heightPx: number;
}

/** Which of a target's pages an export writes: declared once, with the analytics enum that reports it. */
export type { PaperExportScope };

export interface PaperExportTarget {
  /** Which surface this is: the analytics enum, and the style policy (`PAPER_STYLE_POLICIES[surface]`). */
  surface: PaperSurface;
  /** The dialog's title: "Export step 3". */
  title: string;
  /** The suggested file name, before sanitising and without an extension. */
  fileStem: string;
  /**
   * Its pages, when it has more than one picture; null for a surface with one.
   * `title` and `fileStem` are then the current page's.
   */
  pages: PaperExportPages | null;
  /** The Settings export style with the object's own pins on top: the style picker's first entry. */
  exportStyle: PaperStyle;
  /** The fields the object pins itself, applied over a picked preset as well. */
  pins: PaperStyleOverrides | null;
  /** Whether the picture can have buried faces at all: false for a References step, one sheet with nothing under it. */
  buriesFaces: boolean;
  /**
   * The sheet size it opens at, for a picture whose size on screen is no size
   * to export at; the dialog then offers no "As shown". A folded figure lies
   * small beside its crease pattern, at whatever zoom the pattern is at, and a
   * step has the size a printed diagram gives it. Omitted — a simulation —
   * means "As shown" is offered and is where a first export starts.
   */
  defaultSheetMm?: number;
  /**
   * The picture itself when no option can change it; the dialog then offers
   * the format alone. Absent for every target that builds scenes.
   */
  fixedPicture?: PaperExportFixedPicture | null;
  /** A line under the style picker: what of the style this picture cannot take. */
  hint?: string | null;
  /**
   * The marks the picture can be exported without, which the dialog offers
   * as options: a References step's letters and line highlights. Absent for a
   * picture that has none — it is drawn whole whatever the options say.
   */
  marks?: readonly PaperExportMark[];
  /**
   * Everything the picture depends on, as a string: the scene is rebuilt only
   * when this changes, and a page option that is not in it only repaints.
   */
  sceneKey(input: PaperSceneInput): string;
  /** The picture. Null when there is nothing to draw. */
  buildScene(input: PaperSceneInput): Promise<PaperScene | null>;
  /**
   * The style the painter draws the scene with: the surface's policy applied,
   * and whatever the surface's own drawing adds to it.
   */
  paintStyle(style: PaperStyle): PaperStyle;
  /** Let go of whatever the capture holds. Called once, when the dialog closes. */
  release(): void;
}
