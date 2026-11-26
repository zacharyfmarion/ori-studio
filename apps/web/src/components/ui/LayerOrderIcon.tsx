import type { LucideProps } from 'lucide-react';

/**
 * The layer order's mark: two sheets, one over the other, in a 24-unit
 * frame's bottom right corner — the badge Fold with layer order… wears
 * (`FoldWithLayerOrderIcon`). One concept, one mark: every glyph that means
 * the layers' order draws these paths.
 */
export const LAYER_ORDER_SHEETS = ['m18 13.6 4 2.1-4 2.1-4-2.1z', 'm14 19.3 4 2.1 4-2.1'] as const;

/** The badge's box in its 24-unit frame, and the scale that fills a 24-unit frame with it. */
const BADGE_LEFT = 14;
const BADGE_TOP = 13.6;
const SCALE = 2.25;

/**
 * The layer order's mark on its own, at full size: for a tool whose whole job
 * is the order (Fold's Adjust order). The badge's own paths, scaled up to
 * fill the frame, their stroke kept at lucide's 2.
 */
export function LayerOrderIcon({ size = 24, strokeWidth = 2, ...props }: LucideProps) {
  const stroke = Number(strokeWidth) / SCALE;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <g transform={`translate(${3 - BADGE_LEFT * SCALE} ${3.2 - BADGE_TOP * SCALE}) scale(${SCALE})`} strokeWidth={stroke}>
        {LAYER_ORDER_SHEETS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}
