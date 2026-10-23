/**
 * The Fold canvas bar's Flat creases switch: a sheet with a crease across it,
 * corner to corner, the Precrease tool's line (`FoldKindMark`'s `precrease`)
 * drawn on the paper. Solid, never dashed: a dash is a valley fold's.
 *
 * Drawn as lucide draws its icons (a 24-unit box, the current colour), so it
 * sits in the bar beside them at the same weight; the crease a little lighter
 * than the sheet's edge, as a crease is drawn lighter than the paper's edge.
 */
export function FoldFlatCreasesIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x={3.5} y={3.5} width={17} height={17} rx={1.5} />
      <path d="M4.5 19.5 19.5 4.5" strokeWidth={1.5} />
    </svg>
  );
}
