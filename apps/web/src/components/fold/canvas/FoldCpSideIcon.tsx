import type { PaperSide } from '../../../lib/paper/paperScene';

/** The side currently facing the viewer: a white front or a grey back. */
export function FoldCpSideIcon({ side, size = 14 }: { side: PaperSide; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" data-paper-side={side}>
      <rect
        x={3.5} y={3.5} width={17} height={17} rx={1.5}
        fill={side === 'front' ? '#ffffff' : '#b3b3b3'}
        stroke="currentColor" strokeWidth={2}
      />
      <path d="M4.5 19.5 19.5 4.5" fill="none" stroke="#555555" strokeWidth={1} />
    </svg>
  );
}
