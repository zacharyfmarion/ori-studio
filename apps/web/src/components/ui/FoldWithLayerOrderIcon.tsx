import { useId } from 'react';
import type { LucideProps } from 'lucide-react';

/**
 * Fold with layer order…: Fold's own glyph (lucide's Origami), shrunk into
 * the top left, with a small stack of two sheets in the bottom right corner
 * for the layers (the approved Round 4 board).
 *
 * The glyph is cut by a disc around the sheets, so the two never touch at
 * toolbar size. A mask rather than a disc painted in the button's fill: the
 * cut shows whatever is behind the icon, so it follows the button through
 * hover, press and every theme with no colour of its own. The disc's radius
 * leaves two units (about 1.2px at 14px) between the cut glyph and the sheets.
 *
 * The glyph keeps lucide's stroke of 2, which the 0.8 scale draws at 1.6, the
 * width the sheets are drawn at.
 */
export function FoldWithLayerOrderIcon({ size = 24, ...props }: LucideProps) {
  // One mask per icon: two buttons on a page must not share an id.
  const cut = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <circle cx="18" cy="18" r="7.25" fill="black" stroke="none" />
      </mask>
      <g mask={`url(#${cut})`}>
        <g transform="translate(-0.4 -0.4) scale(0.8)">
          <path d="M12 12V4a1 1 0 0 1 1-1h6.297a1 1 0 0 1 .651 1.759l-4.696 4.025" />
          <path d="m12 21-7.414-7.414A2 2 0 0 1 4 12.172V6.415a1.002 1.002 0 0 1 1.707-.707L20 20.009" />
          <path d="m12.214 3.381 8.414 14.966a1 1 0 0 1-.167 1.199l-1.168 1.163a1 1 0 0 1-.706.291H6.351a1 1 0 0 1-.625-.219L3.25 18.8a1 1 0 0 1 .631-1.781l4.165.027" />
        </g>
      </g>
      <path d="m18 13.6 4 2.1-4 2.1-4-2.1z" strokeWidth={1.6} />
      <path d="m14 19.3 4 2.1 4-2.1" strokeWidth={1.6} />
    </svg>
  );
}
