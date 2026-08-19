import type { ReactNode } from 'react';
import {
  ArrowUpToLine,
  ChevronFirst,
  ChevronRight,
  Copy,
  FileDown,
  Focus,
  Layers,
  OctagonAlert,
  RefreshCw,
  RotateCcwSquare,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { FoldedFigureActionIcon } from './foldedFigureActions';

/**
 * Icon for a folded-figure action, shared by the floating toolbar and the
 * right-click menu so the two surfaces stay visually identical.
 *
 * `foldedFigureActions` names icons rather than importing them so it can stay
 * JSX-free and directly unit-testable; this is where names become elements.
 */
export function foldedFigureActionIconNode(icon: FoldedFigureActionIcon, size = 14): ReactNode {
  switch (icon) {
    // A sheet with a turn arrow, not a mirror glyph: Flip turns the paper over
    // to show its other side, which is not the same as mirroring the shape.
    case 'flip':
      return <RotateCcwSquare size={size} />;
    // A viewfinder, not a rewind: this recentres the eye on the model rather
    // than undoing anything the user did to the paper.
    case 'reset-view':
      return <Focus size={size} />;
    // An upward arrow to a line: this declares which way is up, so the glyph is
    // about the axis rather than about rotating — nothing here turns the model,
    // it renames the pole the turntable spins on.
    case 'set-upright':
      return <ArrowUpToLine size={size} />;
    case 'style':
      return <Layers size={size} />;
    case 'another':
      return <ChevronRight size={size} />;
    // Rewind-to-start, so the wrap at the end of a lap reads as what it is.
    case 'first-solution':
      return <ChevronFirst size={size} />;
    case 'refold':
      return <RefreshCw size={size} />;
    case 'export':
      return <FileDown size={size} />;
    case 'duplicate':
      return <Copy size={size} />;
    case 'delete':
      return <Trash2 size={size} />;
    // A 3D verdict. Two glyphs rather than one tinted glyph, so the difference
    // between "it draws but passes through itself" and "its layers could not be
    // ordered" survives a colourblind reader and a monochrome screenshot.
    case 'notice-warn':
      return <TriangleAlert size={size} />;
    case 'notice-error':
      return <OctagonAlert size={size} />;
  }
}
