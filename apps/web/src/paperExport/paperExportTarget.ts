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
import type { PaperScene } from '../lib/paper/paperScene';
import type { Hex, PaperStyle, PaperStyleOverrides } from '../lib/paper/paperStyle';
import type { PaperSurface } from '../lib/paper/paperStyleResolve';

/** What a scene is built from, beyond the capture itself. */
export interface PaperSceneInput {
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
}

export interface PaperExportTarget {
  /** Which surface this is: the analytics enum, and the style policy (`PAPER_STYLE_POLICIES[surface]`). */
  surface: PaperSurface;
  /** The dialog's title: "Export step 3". */
  title: string;
  /** The suggested file name, before sanitising and without an extension. */
  fileStem: string;
  /** The Settings export style with the object's own pins on top: the style picker's first entry. */
  exportStyle: PaperStyle;
  /** The fields the object pins itself, applied over a picked preset as well. */
  pins: PaperStyleOverrides | null;
  /** Whether the picture can have buried faces at all: false for a References step, one sheet with nothing under it. */
  buriesFaces: boolean;
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
