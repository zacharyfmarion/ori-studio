import type { LucideProps } from 'lucide-react';

/**
 * The Propagate Fold Angles tool: a bulb whose glass is a crease pattern.
 *
 * Drawn rather than composed, for the same reason as {@link SolveFoldAnglesIcon}
 * — the idea is the *pair*, a solution arriving and the pattern it arrives in,
 * and lucide has a bulb but no way to put creases inside one. Follows the same
 * conventions: 24-unit grid, `currentColor`, round joins.
 *
 * Traced from `solve_icon_v1.png` and then cut down hard, because that artwork
 * is an app icon and this is twenty pixels of rail. Everything in it that reads
 * at 1024px — eleven creases, the four-fold symmetry, the two ink weights, the
 * puzzle tab in the collar — becomes one grey smudge at rail size. What survives
 * is what makes it *this* tool rather than a lightbulb: a single interior vertex
 * with creases running out of it to the glass, which is exactly the picture of
 * propagation.
 *
 * Six spokes, not the original's eleven. Below about 2 units apart a pair of
 * strokes merges into one thick one at 20px, and six is what fits the bulb's
 * inner circle at that spacing while keeping the source's left-right symmetry
 * and its centre vertex slightly above the bulb's middle.
 *
 * The spokes stop short of the glass rather than touching it. A stroke that
 * meets the outline at a shallow angle thickens the outline where it lands, and
 * at rail size that reads as a dent in the bulb.
 */
export function PropagateFoldAnglesIcon({ size = 20, ...props }: LucideProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      /* Cropped to the artwork like {@link SolveFoldAnglesIcon}: the bulb is
         tall and narrow, so on the full square grid it is height-bound and
         reads small. Keep in step with the geometry below. */
      viewBox="4.2 1.6 15.6 20.8"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* The glass: a circle tapering into the neck, matching the source's
          silhouette rather than lucide's rounder bulb. */}
      <path d="M8.75 15.1a6.6 6.6 0 1 1 6.5 0c-.64.42-1.08 1.06-1.08 1.82h-4.34c0-.76-.44-1.4-1.08-1.82Z" />
      {/* The screw base: two bars, as in the source. */}
      <path d="M9.85 19.1h4.3" />
      <path d="M10.55 21.5h2.9" />
      {/* The crease pattern, at well under half the outline's weight.
          This is the one thing that has to be right. In the source the glass is
          heavy ink and the creases are hairlines, and that contrast is what
          makes the inside read as a *pattern* rather than as decoration on the
          bulb. Drawn at the outline's weight instead — which is what a first
          pass does, since lucide icons are uniform — six creases three units
          long are as thick as they are long, and the whole interior collapses
          into one asterisk-shaped blob at rail size.

          An X and a half-vertical, not three diameters. Three lines through one
          point is a six-armed asterisk however thin it is drawn, and the source
          is not that: its vertical stops at the vertex rather than crossing it,
          which is what makes the picture a *vertex creases run out of* instead
          of a starburst. Five arms is also the most that stay apart at 20px.
          Checked at 20px. */}
      <g strokeWidth={0.9}>
        <path d="m8.3 5.9 7.4 7.1" />
        <path d="m15.7 5.9-7.4 7.1" />
        <path d="M12 3.5v6" />
      </g>
    </svg>
  );
}
