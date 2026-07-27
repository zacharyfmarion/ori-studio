import type { ReactNode } from 'react';
import {
  ChevronRight,
  Copy,
  FileDown,
  FlipHorizontal2,
  Layers,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { FoldedFigureActionIcon } from './foldedFigureActions';

/**
 * Icon for a folded-figure action, shared by the floating toolbar and the
 * right-click menu so the two surfaces stay visually identical.
 *
 * `foldedFigureActions` names icons rather than importing them so it can stay
 * JSX-free and directly unit-testable; this is where names become elements.
 */
export function foldedFigureActionIconNode(
  icon: FoldedFigureActionIcon,
  size = 14
): ReactNode {
  switch (icon) {
    case 'flip':
      return <FlipHorizontal2 size={size} />;
    case 'style':
      return <Layers size={size} />;
    case 'another':
      return <ChevronRight size={size} />;
    case 'refold':
      return <RefreshCw size={size} />;
    case 'export':
      return <FileDown size={size} />;
    case 'duplicate':
      return <Copy size={size} />;
    case 'delete':
      return <Trash2 size={size} />;
  }
}
