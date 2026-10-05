// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as hb from 'harfbuzzjs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE, type KnownDiagramAnnotation } from '../document/diagramDocument';
import type { DiagramFontKey } from '../fonts/diagramFontFaces';
import { annotationDrawing, LABEL_BASELINE, labelRuns } from './annotationPrimitives';

/**
 * A callout's words inside its box, by the fonts a page sets them in — Noto
 * Sans, and the CJK faces' fixtures — shaped by HarfBuzz and measured by
 * their glyphs' own outlines: not by the advance table the box is sized
 * from, so a box too small for its words cannot pass by the same mistake.
 */
const FONT_DIR = resolve(process.cwd(), 'src/diagram/fonts');
const FILES: Partial<Record<DiagramFontKey, string>> = {
  latin: 'NotoSans-Regular.ttf',
  jp: 'fixtures/NotoSansJP-Regular.fixture.ttf',
  sc: 'fixtures/NotoSansSC-Regular.fixture.ttf',
  tc: 'fixtures/NotoSansTC-Regular.fixture.ttf',
  kr: 'fixtures/NotoSansKR-Regular.fixture.ttf',
};
const fonts = new Map<DiagramFontKey, hb.Font>();
function fontFor(key: DiagramFontKey): hb.Font {
  let font = fonts.get(key);
  if (!font) {
    const file = FILES[key];
    if (!file) throw new Error(`no fixture for ${key}`);
    font = new hb.Font(new hb.Face(new hb.Blob(readFileSync(resolve(FONT_DIR, file)))));
    fonts.set(key, font);
  }
  return font;
}

/** A run shaped: its advance, and its ink's box from its start on the baseline, y up — in ems. */
function shaped(key: DiagramFontKey, text: string) {
  const font = fontFor(key);
  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(font, buffer);
  const positions = buffer.getGlyphPositions();
  let x = 0;
  const ink = { left: Infinity, right: -Infinity, top: -Infinity, bottom: Infinity };
  buffer.getGlyphInfos().forEach((glyph, index) => {
    const extents = font.glyphExtents(glyph.codepoint);
    const at = positions[index]!;
    if (extents && extents.width !== 0 && extents.height !== 0) {
      ink.left = Math.min(ink.left, x + at.xOffset + extents.xBearing);
      ink.right = Math.max(ink.right, x + at.xOffset + extents.xBearing + extents.width);
      ink.top = Math.max(ink.top, at.yOffset + extents.yBearing);
      ink.bottom = Math.min(ink.bottom, at.yOffset + extents.yBearing + extents.height);
    }
    x += at.xAdvance;
  });
  return { advance: x / 1000, left: ink.left / 1000, right: ink.right / 1000, top: ink.top / 1000, bottom: ink.bottom / 1000 };
}

/** How far a callout's words' ink stands inside its box's outline at its nearest, in px: negative past it. */
function clearance(text: string, framePx: number): number {
  const callout: KnownDiagramAnnotation = { id: 'c', kind: 'callout', from: [0.1, 0.9], to: [0.5, 0.4], text };
  const drawn = annotationDrawing([callout], { width: 1, height: 1 }, framePx, DEFAULT_DIAGRAM_STYLE).callouts[0]!;
  const { label, box, boxPen } = drawn;
  const runs = labelRuns(text).map((run) => ({ ...shaped(run.key, run.text) }));
  // Centred on its middle as SVG's `text-anchor="middle"` sets the whole line, its baseline below it.
  const width = runs.reduce((sum, run) => sum + run.advance, 0) * label.size;
  const baseline = label.y + LABEL_BASELINE * label.size;
  let x = label.x - width / 2;
  let nearest = Infinity;
  for (const run of runs) {
    if (Number.isFinite(run.left)) {
      const left = x + run.left * label.size;
      const right = x + run.right * label.size;
      const top = baseline - run.top * label.size;
      const bottom = baseline - run.bottom * label.size;
      // Inside the outline's own ink, not its middle.
      nearest = Math.min(
        nearest,
        left - (box.x + boxPen / 2),
        box.x + box.width - boxPen / 2 - right,
        top - (box.y + boxPen / 2),
        box.y + box.height - boxPen / 2 - bottom
      );
    }
    x += run.advance * label.size;
  }
  return nearest;
}

describe('a callout’s words', () => {
  it('stand inside its box, every Latin glyph its advances are counted for', () => {
    // A 40 mm frame on a page, and the canvas's.
    for (const framePx of [151, 1000]) {
      for (let codePoint = 0x21; codePoint < 0x300; codePoint += 1) {
        const text = String.fromCodePoint(codePoint);
        if (labelRuns(text)[0]?.key !== 'latin' || !Number.isFinite(shaped('latin', text).left)) continue;
        expect(clearance(text, framePx), `U+${codePoint.toString(16)} at ${framePx} px`).toBeGreaterThan(0);
      }
    }
  });

  it('stand inside its box in a line: its default, wide and tall letters, marks stacked, and CJK in each face', () => {
    const texts = [
      'Repeat behind',
      'Repeat on the other flap',
      'MAMMOTH WWWWW',
      'ǺÅjyţ ẫ ệ',
      'é̂̃',
      'Repeat 折り筋を上に',
      '将底角向上折至顶角，（压实）',
      '將底角向上摺',
      '모서리를 접고',
    ];
    for (const framePx of [151, 1000]) {
      for (const text of texts) {
        const room = clearance(text, framePx);
        expect(room, `${text} at ${framePx} px`).toBeGreaterThan(0);
      }
    }
    // Hugged, not lost in it: "Repeat behind" stands within an em of its sides at the canvas's size.
    expect(clearance('Repeat behind', 1000)).toBeLessThan(0.05 * 1000 * 0.5);
  });
});
