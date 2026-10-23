import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  Compass,
  Copy,
  CopyPlus,
  Download,
  Eye,
  FilePlus,
  FoldVertical,
  Image,
  ImageOff,
  Link2,
  Move,
  PenLine,
  PenTool,
  Pin,
  Plus,
  RefreshCw,
  Replace,
  Rotate3d,
  RotateCcw,
  RotateCcwSquare,
  RotateCw,
  Scaling,
  Trash2,
  Ungroup,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import type { DiagramStepActionId, DiagramStepChoice, DiagramStepGroup } from './diagramActions';

/** Everything in the step catalog that is drawn with an icon: a verb, a choice, a group. */
export type DiagramActionIconId = DiagramStepActionId | DiagramStepChoice['id'] | DiagramStepGroup['id'];

/**
 * A step verb's icon, by its id: the card's menu, the Step pane's rows and
 * its header all draw a verb with this one, so a verb looks the same wherever
 * it is offered. Where the card or the Pose toolbar already drew a verb, it is
 * that glyph.
 */
export const DIAGRAM_ACTION_ICONS: Readonly<Record<DiagramActionIconId, LucideIcon>> = {
  // The card's own buttons.
  'adjust-pose': Rotate3d,
  annotate: PenLine,
  duplicate: Copy,
  'duplicate-as': CopyPlus,
  'show-as': Eye,
  // The grid's "Add a step here" and the header's Add step.
  insert: Plus,
  'insert-before': BetweenHorizontalStart,
  'insert-after': BetweenHorizontalEnd,
  // A turn's card and Make Turn Over / Make Rotate: Edit's Flip glyph, and a turn.
  'insert-turn-over': RotateCcwSquare,
  'insert-rotate': RotateCw,
  'make-turn-over': RotateCcwSquare,
  'make-rotate': RotateCw,
  // As the turn's pane moves it: earlier is up the list.
  move: ArrowUpDown,
  'move-earlier': ArrowUp,
  'move-later': ArrowDown,
  'start-page': FilePlus,
  // The Pages view's Layers list names a step's picture with this.
  picture: Image,
  'upload-picture': Upload,
  'link-pattern': Link2,
  'from-references': Compass,
  // A Fold step's way in and its way back: Fold's own glyph, as its workspace rail draws it.
  'from-fold': FoldVertical,
  'refresh-picture': RefreshCw,
  // The zoom status's Update.
  'update-enlarged': RefreshCw,
  'update-all-enlarged': RefreshCw,
  'open-in-edit': PenTool,
  'open-in-references': Compass,
  'open-in-fold': FoldVertical,
  'replace-from-references': Replace,
  'make-marks-editable': Ungroup,
  'export-picture': Download,
  'remove-picture': ImageOff,
  // The pin the card wears while the step is placed by hand, which these undo.
  page: Pin,
  'reset-size': Scaling,
  'reset-position': Move,
  // The fields' own reset.
  'reset-layout': RotateCcw,
  delete: Trash2,
};

/** Whether an id names something the catalog draws with an icon (a turn's ways are radio rows, drawn with a check). */
export function hasDiagramActionIcon(id: string): id is DiagramActionIconId {
  return Object.hasOwn(DIAGRAM_ACTION_ICONS, id);
}

/** A verb's icon as a menu row's leading glyph. */
export function diagramActionIconNode(id: DiagramActionIconId, size = 14): ReactNode {
  const Icon = DIAGRAM_ACTION_ICONS[id];
  return <Icon size={size} aria-hidden="true" />;
}
