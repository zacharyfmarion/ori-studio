import type { ReactElement, ReactNode } from 'react';
import {
  ArrowDownToDot,
  ArrowDownToLine,
  ArrowUpFromLine,
  BetweenHorizontalStart,
  Divide,
  Flower2,
  Rabbit,
  RotateCcwSquare,
  RotateCw,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { CpToolGlyph } from '../../cp-workspace/toolCatalog/cpToolGlyph';
import { cpActionByOperation } from '../../lib/oristudioCpActions';
import type {
  FoldLineModeId,
  FoldRailItemId,
  FoldSinkToolId,
} from '../../fold/tools/foldToolCatalog';
import { FoldRepeatGlyph } from './FoldActionIcon';
import { FoldKindMark } from './FoldKindMark';

const SIZE = 20;

/** The dash a glyph draws a fold line in: the line the tool locates. */
const FOLD_DASH = '2.4 2.2';

/** One stroke in the rail's ink, for a glyph drawn here. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** A reference point: filled. */
const Dot = ({ x, y }: { x: number; y: number }) => <circle cx={x} cy={y} r={1.6} fill="currentColor" stroke="none" />;
/** A point the fold passes through but does not move: open. */
const Ring = ({ x, y }: { x: number; y: number }) => <circle cx={x} cy={y} r={1.9} />;
/** The fold line the mode locates. */
const FoldLine = ({ d }: { d: string }) => <path d={d} strokeDasharray={FOLD_DASH} />;

/**
 * Each line mode's picture: the references it takes — points filled, a pivot
 * open, edges solid — and the fold line it finds, dashed.
 */
function lineModeGlyph(mode: FoldLineModeId): ReactElement {
  switch (mode) {
    case 'axiom-1':
      return (
        <Glyph>
          <FoldLine d="M3 17 17 3" />
          <Dot x={6.5} y={13.5} />
          <Dot x={13.5} y={6.5} />
        </Glyph>
      );
    case 'axiom-2':
      return (
        <Glyph>
          <FoldLine d="M10 2v16" />
          <Dot x={4} y={14} />
          <Dot x={16} y={14} />
          <path d="M5 10Q10 4 15 10M12.9 9.6 15 10l.3-2.2" />
        </Glyph>
      );
    case 'axiom-3':
      return (
        <Glyph>
          <path d="M2 17h16M2 17 14 5" />
          <FoldLine d="M2 17 18 10.4" />
        </Glyph>
      );
    case 'axiom-4':
      return (
        <Glyph>
          <path d="M2 14h16" />
          <FoldLine d="M10 2v16" />
          <Dot x={10} y={7} />
        </Glyph>
      );
    case 'axiom-5':
      return (
        <Glyph>
          <path d="M2 17h16" />
          <Dot x={5} y={6} />
          <Ring x={14} y={5} />
          <FoldLine d="M13.2 6.8 8 18" />
        </Glyph>
      );
    case 'axiom-6':
      return (
        <Glyph>
          <path d="M2 17h16M3 2v15" />
          <Dot x={8} y={7} />
          <Dot x={14} y={11} />
          <FoldLine d="M6 18 18 4" />
        </Glyph>
      );
    case 'axiom-7':
      return (
        <Glyph>
          <path d="M2 17h12M17 2v16" />
          <Dot x={7} y={7} />
          <FoldLine d="M2 12h13" />
        </Glyph>
      );
    case 'free':
      return (
        <Glyph>
          <FoldLine d="M5.4 13.6 14.6 6.4" />
          <Ring x={4} y={15} />
          <Ring x={16} y={5} />
        </Glyph>
      );
    case 'crease':
      // A crease already there: the solid line, where a precrease is dashed.
      return <FoldKindMark kind="crease" size={SIZE} />;
  }
}

/**
 * Edit's Rabbit Ear tool (Oriedita's `Inward`): the rabbit ear is drawn as
 * Edit's rail draws it, so the one fold looks the same in both workspaces
 * (owner feedback, 2026-10-12).
 */
const EDIT_RABBIT_EAR = cpActionByOperation('Inward');

/** The sinks: the point pushed down to the line, into a pocket, or pulled back up. */
const SINK_ICONS: Readonly<Record<FoldSinkToolId, LucideIcon>> = {
  'open-sink': ArrowDownToLine,
  'closed-sink': ArrowDownToDot,
  unsink: ArrowUpFromLine,
};

/**
 * Every Fold rail item's icon: a fold's symbol in the control's ink; a line
 * mode's picture of what it locates; Edit's own glyph for the rabbit ear; the
 * diagram's repeat symbol for Repeat; the app's own icons for the tuck, the Divide line, Unfold to step, the model
 * verbs (Turn over is the turn-over icon of Edit's Flip and the Diagram's
 * turns), the other vertex folds and the sinks.
 * `compact`: beside text in a toolbar button, at the text's scale, as Edit's
 * "Tools" trigger draws its glyph.
 */
export function FoldToolGlyph({ id, compact = false }: { id: FoldRailItemId; compact?: boolean }): ReactElement {
  switch (id) {
    case 'valley':
    case 'mountain':
    case 'precrease':
    case 'inside-reverse':
    case 'crimp':
      return <FoldKindMark kind={id} size={compact ? 16 : SIZE} />;
    case 'pleat':
      return <Glyph><path d="M19 7.5H5L15 12.5H1" /></Glyph>;
    case 'squash':
    case 'swivel': {
      // Enlarge the paper while matching Petal's visible stroke weight.
      // Both SVGs use a 24-unit viewBox; Petal is SIZE pixels at stroke 1.5.
      const size = compact ? 20 : 24;
      return <FoldKindMark kind={id} size={size} strokeWidth={(1.5 * SIZE) / size} />;
    }
    case 'tuck':
      return <BetweenHorizontalStart size={SIZE} strokeWidth={1.5} aria-hidden="true" />;
    case 'divide-line':
      return <Divide size={SIZE} strokeWidth={1.5} aria-hidden="true" />;
    case 'turn-over':
      // Edit's Flip and the Diagram's Turn over: a sheet with a turn arrow, never a mirror.
      return <RotateCcwSquare size={SIZE} strokeWidth={1.5} aria-hidden="true" />;
    case 'rotate':
      return <RotateCw size={SIZE} strokeWidth={1.5} aria-hidden="true" />;
    // The sequence tools, by the icons their header buttons and menu rows wear.
    case 'unfold-to':
      return <Undo2 size={SIZE} strokeWidth={1.5} aria-hidden="true" />;
    case 'repeat':
      return <FoldRepeatGlyph size={compact ? 16 : SIZE} />;
    case 'axiom-1':
    case 'axiom-2':
    case 'axiom-3':
    case 'axiom-4':
    case 'axiom-5':
    case 'axiom-6':
    case 'axiom-7':
    case 'free':
    case 'crease':
      return lineModeGlyph(id);
    case 'rabbit-ear':
      if (EDIT_RABBIT_EAR) return <CpToolGlyph action={EDIT_RABBIT_EAR} compact={compact} />;
      return <Rabbit size={SIZE} strokeWidth={1.5} aria-hidden="true" />;
    case 'petal':
      return <Flower2 size={SIZE} strokeWidth={1.5} aria-hidden="true" />;
    case 'open-sink':
    case 'closed-sink':
    case 'unsink': {
      const Icon = SINK_ICONS[id];
      return <Icon size={SIZE} strokeWidth={1.5} aria-hidden="true" />;
    }
  }
}
