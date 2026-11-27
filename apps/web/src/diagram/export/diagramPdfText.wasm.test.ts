// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDiagram, createStep, insertSteps, type DiagramDocument, type DiagramStep } from '../document/diagramDocument';
import { fixedPicture } from '../document/diagramSteps.fixtures';
import { FIXTURE_FONTS, fixtureSubsetter } from '../fonts/diagramFonts.fixtures';
import type { FontSubsetter } from '../fonts/fontSubset';
import { diagramFontTexts, preparedPages } from '../pages/diagramPages';
import { composeEveryPage, diagramPdfInput, type PdfWriter } from './diagramPdf';

/**
 * Text the PDF prints as the page sets it (ORI-STUDIO-1M): every character
 * the composer sets in a font is in the subset the writer is handed, so the
 * writer (`crates/oristudio-pdf-wasm`) never meets one it would refuse.
 * The writer's cases are skipped where the bridge has not been built (a fresh
 * worktree before `build:wasm`); CI builds it before the web tests run.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-pdf-wasm/oristudio_pdf_wasm_bg.wasm');
const available = existsSync(WASM);

let subsetter: FontSubsetter;
let write: PdfWriter;
beforeAll(async () => {
  subsetter = await fixtureSubsetter();
  if (!available) return;
  const wasm = await import('../../generated/oristudio-pdf-wasm/oristudio_pdf_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  write = async (pages, fonts, options) => wasm.pages_to_pdf(pages, fonts, options);
});

/**
 * A Defox view's repeat label as the import keeps it (`fixedPicture` in
 * `captureFolded.ts`): the sanitizer has set its words in the diagram's fonts.
 */
const DEFOX_VIEW =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="1100" viewBox="-50 -50 1100 1100">' +
  '<path d="M 0 0 L 1000 1000" stroke="#000"/>' +
  '<rect x="460" y="430" width="120" height="96" fill="#fff" stroke="#000"/>' +
  `<text x="470" y="500" fill="magenta" font-size="80pt" font-family="'Noto Sans', sans-serif" font-weight="400">3~5</text>` +
  '</svg>';

/** A diagram whose only text at Regular is "Fold", and a Defox view. */
function defoxDiagram(): DiagramDocument {
  const steps: DiagramStep[] = [
    { ...createStep(() => 'step-words'), text: 'Fold' },
    { ...createStep(() => 'step-defox'), picture: { ...fixedPicture('fixed-defox', DEFOX_VIEW), widthPx: 1100, heightPx: 1100 } },
  ];
  return insertSteps(createDiagram({ title: '' }), steps, 0);
}

describe('a kept picture’s words (ORI-STUDIO-1M)', () => {
  it('loads the faces a Defox view’s repeat label is set in', () => {
    expect(diagramFontTexts(defoxDiagram())).toContainEqual({ text: '3~5', weight: 400 });
  });

  it('cuts the page’s fonts to the label’s characters too', () => {
    const document = defoxDiagram();
    const { usage } = composeEveryPage(document, preparedPages(document, FIXTURE_FONTS, subsetter));
    expect([...(usage.get('latin-400') ?? '')]).toEqual(expect.arrayContaining(['3', '~', '5']));
  });

  it.skipIf(!available)('prints the label, where the writer refused a digit its subset lacked', async () => {
    const input = diagramPdfInput(defoxDiagram(), FIXTURE_FONTS, subsetter, 'home');
    expect(input.missing).toEqual([]);
    const pdf = await write(input.pages, input.fonts, input.options);
    expect(new TextDecoder('latin1').decode(pdf.slice(0, 5))).toBe('%PDF-');
  });
});

/** Every Default_Ignorable_Code_Point but the bulk of the tag and supplementary-selector block, which a few stand for. */
function defaultIgnorables(): number[] {
  const all: number[] = [];
  for (let codePoint = 0; codePoint <= 0x1ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
    if (/\p{Default_Ignorable_Code_Point}/u.test(String.fromCodePoint(codePoint))) all.push(codePoint);
  }
  return [...all, 0xe0001, 0xe0020, 0xe007f, 0xe0100, 0xe01ef];
}

const hex = (codePoint: number) => `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;

describe.skipIf(!available)('characters that draw nothing, or seem to', () => {
  it('are printed by the writer whenever the composer finds none missing: a Hangul filler is a glyph to both', async () => {
    const refused: string[] = [];
    for (const codePoint of [0x09, 0x0a, 0x0d, ...defaultIgnorables()]) {
      const character = String.fromCodePoint(codePoint);
      // In a Latin run, and in a Han one (the fixture's Chinese face).
      for (const text of [`a${character}b`, `\u{6298}${character}\u{75D5}`]) {
        const step = { ...createStep(() => 'step-1'), text };
        const input = diagramPdfInput(insertSteps(createDiagram({ title: '' }), [step], 0), FIXTURE_FONTS, subsetter, 'home');
        // Missing, the export says so before it is tried (`useDiagramExport`).
        if (input.missing.length > 0) continue;
        await write(input.pages, input.fonts, input.options).catch(() => refused.push(hex(codePoint)));
      }
    }
    expect(refused).toEqual([]);
  });
});
