/**
 * The sheet a diagram is printed on (D10): its size, which way up, and its
 * margin. Deliberately not `PaperPage`, which is the artwork's page.
 *
 * B5 is the JIS size, 182 × 257 mm, which is what a Japanese printer means by
 * B5; CSS's `B5` keyword is ISO, 176 × 250.
 *
 * Pure.
 */
import type { DiagramPageSetup, DiagramPaperSize } from '../document/diagramDocument';

/** Points per millimetre: a page SVG's user units are pt. */
export const PT_PER_MM = 72 / 25.4;

/** Portrait width and height, in mm. */
export const PRINT_PAPER_MM: Readonly<Record<DiagramPaperSize, { widthMm: number; heightMm: number }>> = {
  a4: { widthMm: 210, heightMm: 297 },
  a5: { widthMm: 148, heightMm: 210 },
  'b5-jis': { widthMm: 182, heightMm: 257 },
  letter: { widthMm: 215.9, heightMm: 279.4 },
};

export interface PrintPaper {
  widthMm: number;
  heightMm: number;
  marginMm: number;
}

/** The sheet a setup prints on, turned for its orientation. */
export function printPaper(setup: Pick<DiagramPageSetup, 'size' | 'orientation' | 'marginMm'>): PrintPaper {
  const { widthMm, heightMm } = PRINT_PAPER_MM[setup.size];
  const portrait = setup.orientation === 'portrait';
  return {
    widthMm: portrait ? widthMm : heightMm,
    heightMm: portrait ? heightMm : widthMm,
    marginMm: setup.marginMm,
  };
}
