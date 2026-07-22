interface FoldEstimateIconProps {
  height?: number;
}

/**
 * Oriedita's fold-estimate button icon (`ppp/suitei_04.png`): crease pattern,
 * arrow, folded figure. Redrawn as monochrome line art so it scales and picks
 * up `currentColor`; the source is a 42x20 colour bitmap.
 */
export function FoldEstimateIcon({ height = 16 }: FoldEstimateIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={(height * 34) / 16}
      height={height}
      viewBox="0 0 34 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 1.5h13v13h-13z" />
      <path d="m1.5 1.5 13 13M1.5 14.5l13-13" />
      <path d="M17 8h5" />
      <path d="m19.7 5.3 2.7 2.7-2.7 2.7" />
      <path d="M28.75 1.5 32.5 8l-3.75 6.5L25 8z" />
      <path d="M25 8l3.75-2.9L32.5 8" />
    </svg>
  );
}
