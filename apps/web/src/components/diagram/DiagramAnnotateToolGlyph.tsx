import type { ReactElement } from 'react';
import { MousePointer2, RotateCw, SplinePointer, Type } from 'lucide-react';
import { TURN_OVER_BOX, TURN_OVER_HEAD_PATH, TURN_OVER_PATH } from '../../cp-workspace/references/stepDiagramGeometry';
import type { AnnotateTool } from '../../diagram/annotate/annotateTools';

const SIZE = 20;

/** The shaft every fold arrow's icon shares: a 60° arc, left to right. */
const ARC = 'M3 14 A10.5 10.5 0 0 1 15.2 8.4';

/** One stroke, in the rail's ink, for an icon drawn here. */
function Glyph({ children }: { children: React.ReactNode }) {
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

/**
 * Each Annotate tool's icon: the mark it draws, small. The fold arrows are
 * the arrows themselves; the lines are their dash; Select, Edit Path, Rotate
 * and Label are the app's own icons for those verbs. Every tool has one: the return
 * type makes a kind left out a compile error, not a blank button.
 */
export function DiagramAnnotateToolGlyph({ tool }: { tool: AnnotateTool }): ReactElement {
  switch (tool) {
    case null:
      return <MousePointer2 size={17} aria-hidden="true" />;
    case 'edit-path':
      return <SplinePointer size={17} aria-hidden="true" />;
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
    case 'push-arrow':
      return (
        <Glyph>
          <path d="M2.5 7.5 L10 7.5 L10 4 L17.5 10 L10 16 L10 12.5 L2.5 12.5 L5 10 Z" strokeLinejoin="miter" />
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
    case 'label':
      return <Type size={17} aria-hidden="true" />;
  }
}
