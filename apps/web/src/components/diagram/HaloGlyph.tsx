import type { ReactElement } from 'react';

/**
 * Halo's icon (17b): a letter knocked out of a wash round it — the letter's
 * stroke over a wider, fainter one of the same shape, as a halo is a stroke
 * under the letters in what they stand on.
 */
export function HaloGlyph(): ReactElement {
  const letter = 'M4.5 13.5 L8 3.5 L11.5 13.5 M5.8 10 H10.2';
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
      <path d={letter} strokeWidth={4.5} strokeOpacity={0.28} strokeLinecap="round" strokeLinejoin="round" />
      <path d={letter} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
