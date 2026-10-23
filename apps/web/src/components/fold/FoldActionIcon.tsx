import { Undo2, BookImage, Download, Images, RotateCcwSquare, RotateCw, Send, Trash2, Upload } from 'lucide-react';
import type { FoldActionIcon as FoldActionIconName } from '../../fold/foldActions';
import { FoldKindMark } from './FoldKindMark';

/** Repeat's icon, on the rail and beside a label: the diagram's repeat symbol. */
export function FoldRepeatGlyph({ size }: { size: number }) {
  return <FoldKindMark kind="repeat" size={size} />;
}

/**
 * The icon of a Fold verb (`fold/foldActions`' `FoldActionIcon`), wherever a
 * surface draws one with an icon — the header, the step cards' menus. The
 * fold kinds use the same symbols as on the
 * rail; turn over is the rail's own glyph, the turn-over icon of Edit's Flip
 * and the Diagram's turns; Send to Edit is the verb's icon in every
 * workspace. Decorative: every verb is named in words beside it.
 */
export function FoldActionIcon({ icon, size = 14 }: { icon: FoldActionIconName; size?: number }) {
  switch (icon) {
    case 'valley':
    case 'mountain':
    case 'precrease':
      return <FoldKindMark kind={icon} size={size} />;
    case 'turn-over':
      return <RotateCcwSquare size={size} aria-hidden="true" />;
    case 'rotate':
      // The rail's Rotate tool, and the Diagram's rotate glyph tool: one icon for the one concept.
      return <RotateCw size={size} aria-hidden="true" />;
    case 'unfold-to':
    case 'unfold-last':
      // The rail's Unfold to step tool: one icon for the one concept.
      return <Undo2 size={size} aria-hidden="true" />;
    case 'repeat':
      return <FoldRepeatGlyph size={size} />;
    case 'import-cp':
      return <Upload size={size} aria-hidden="true" />;
    case 'send-to-edit':
      return <Send size={size} aria-hidden="true" />;
    case 'send-to-diagram':
      return <BookImage size={size} aria-hidden="true" />;
    case 'export-fold':
      return <Download size={size} aria-hidden="true" />;
    case 'export-steps':
      return <Images size={size} aria-hidden="true" />;
    case 'delete':
      return <Trash2 size={size} aria-hidden="true" />;
  }
}
