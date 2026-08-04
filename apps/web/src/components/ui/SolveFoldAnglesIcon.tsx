import type { LucideProps } from 'lucide-react';

/**
 * The Solve Fold Angles tool: an angle between two creases, and a wand.
 *
 * Drawn rather than composed from lucide parts, because the tool's whole idea is
 * the *pair* — a measured angle plus something solving it — and lucide has
 * neither an angle nor a way to combine two glyphs into one rail slot. Follows
 * {@link ProtractorIcon}'s precedent and lucide's conventions: a 24-unit grid,
 * `currentColor`, round joins.
 *
 * Mixed fill and stroke on purpose. The creases are strokes because they *are*
 * lines, and the endpoint dots, star and sparkles are filled because at a
 * 20-pixel rail icon an outlined 3-unit star is a grey smudge.
 *
 * The star sits clear of the upper crease and the sparkles occupy the gap
 * between them: at rail size anything that touches reads as one blob, so the
 * separations are the part worth preserving if this is ever redrawn. The
 * coordinates stay on the 24 grid; only the viewBox crops in.
 */
export function SolveFoldAnglesIcon({ size = 20, ...props }: LucideProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      /* Cropped to the artwork rather than the full 24 grid. The drawing is
         wide and short — it spans nearly the whole width but only two thirds of
         the height — so on lucide's square grid it is width-bound and reads
         small beside blockier neighbours. Trimming the dead margin scales it
         about 15% larger inside the *same* 20-pixel slot, so it grows without
         breaking the rail's alignment. Keep this in step with the geometry:
         these numbers are the artwork's bounding box plus a hair. */
      viewBox="1.6 2.6 21.1 17"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* The two creases meeting at the vertex. */}
      <path d="M3 18.2h16.3" />
      <path d="M3 18.2 10.3 4.2" />
      {/* The angle between them, struck on a circle centred on the vertex so it
          meets both creases square. */}
      <path d="M6.26 11.9A7 7 0 0 1 10 18.2" />
      {/* Endpoints, as the crease-pattern canvas draws its vertices. */}
      <circle cx="3" cy="18.2" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="19.3" cy="18.2" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="10.3" cy="4.2" r="1.25" fill="currentColor" stroke="none" />
      {/* The wand: the stick first, so the star caps it rather than the join
          showing through. */}
      <path d="m18.9 9.7 2.7 4.2" />
      <path
        d="M16.9 3.9 17.66 5.85 19.75 5.97 18.14 7.3 18.66 9.33 16.9 8.2 15.14 9.33 15.66 7.3 14.05 5.97 16.14 5.85Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={0.6}
      />
      {/* Sparkles, in the gap between the star and the upper crease. */}
      <path
        d="M12.4 7.45 12.72 8.28 13.55 8.6 12.72 8.92 12.4 9.75 12.08 8.92 11.25 8.6 12.08 8.28Z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M13.6 2.75 13.84 3.36 14.45 3.6 13.84 3.84 13.6 4.45 13.36 3.84 12.75 3.6 13.36 3.36Z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M13.3 10.65 13.51 11.19 14.05 11.4 13.51 11.61 13.3 12.15 13.09 11.61 12.55 11.4 13.09 11.19Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
