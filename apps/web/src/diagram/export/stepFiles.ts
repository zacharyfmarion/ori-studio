/**
 * A diagram's steps as files of their own (D11): one SVG for each step with a
 * picture, with its number and instruction when asked, for a ZIP of SVGs or
 * of PNGs rasterised from them.
 *
 * - **Same size for every step:** every file is the canvas, W × H mm. The
 *   picture's box is the square left between the number and a five-line slot
 *   for the instruction, and every picture that knows its paper is drawn at
 *   one scale, the largest at which each fits that box (D10's rule), so the
 *   files line up side by side. An instruction longer than its slot is cut
 *   with "…".
 * - **Cropped:** the same scale, so the steps still match one another, but
 *   each file is cut to its own drawing, with the number over its corner and
 *   the whole instruction under it.
 *
 * A step with no picture has no file. Each file embeds the faces it sets, cut
 * to what it sets, so it opens anywhere as it looks here.
 *
 * Pure: no DOM, no store.
 */
import { PT_PER_MM, type PaperSvgResult } from '../../lib/paper/paperSvg';
import type { DiagramDocument } from '../document/diagramDocument';
import type { DiagramFonts } from '../fonts/diagramFonts';
import { embeddedFontFaces } from '../fonts/fontEmbedding';
import type { FontSubsetter } from '../fonts/fontSubset';
import { stepPictureSource } from '../pictures/paintDiagramStep';
import { stepNumberElement, stepTextElement, svgDocument } from '../pages/composeDiagramPage';
import {
  STEP_NUMBER_SIZE_MM,
  STEP_TEXT_LEADING_MM,
  STEP_TEXT_SIZE_MM,
  type LayoutStep,
  type SetLine,
} from '../pages/diagramPageLayout';
import { diagramLabelTexts, diagramLayoutSteps, diagramUploadTexts } from '../pages/diagramPages';
import { fontTextSetter } from '../pages/fontTextSetter';
import { cellPicture } from '../pages/pagePictures';
import {
  ASCENT_EM,
  CROPPED_TEXT_MIN_WIDTH_MM,
  DESCENT_EM,
  NUMBER_BASELINE_MM,
  PAD_MM,
  PICTURE_TOP_MM,
  pictureBoxOf,
  STEP_FILE_TEXT_LINES,
  TEXT_GAP_MM,
  textSlotMm,
  type StepFileOptions,
} from './stepFileGeometry';
import { stepsOf } from '../document/diagramDocument';

export { STEP_FILE_MM_RANGE, STEP_FILE_TEXT_LINES, stepFileMinHeightMm, type StepFileOptions } from './stepFileGeometry';

/** A file's ground when it is not transparent: the page's white. */
const BACKGROUND = '#ffffff';

export interface StepFile {
  stepId: string;
  /** The step's number in the diagram, 1-based: a skipped step keeps its own. */
  number: number;
  /** The file's name in the archive, before its extension: `<title>-step-07`. */
  fileStem: string;
}

export interface PreparedStepFiles {
  /** A file for each step with a picture, in order. */
  files: StepFile[];
  /** The numbers of the steps with no picture: they have no file. */
  skipped: number[];
  /** The numbers of the steps whose instruction was cut to its slot. */
  cut: number[];
  /** Characters no font has: drawn as a missing-glyph box. */
  missing: string[];
  /** File `index` (of `files`) as an SVG document. */
  compose: (index: number) => PaperSvgResult;
}

/** D10's shared scale for a box: the largest mm per unit at which every paper picture fits it. */
function sharedScale(steps: readonly LayoutStep[], boxMm: number): number | null {
  let scale: number | null = null;
  for (const { picture } of steps) {
    if (picture?.kind !== 'paper' || !(picture.extentUnits > 0)) continue;
    const fits = boxMm / picture.extentUnits;
    scale = scale === null ? fits : Math.min(scale, fits);
  }
  return scale;
}

export function prepareStepFiles(
  document: DiagramDocument,
  fonts: DiagramFonts,
  subsetter: FontSubsetter,
  options: StepFileOptions
): PreparedStepFiles {
  const setter = fontTextSetter((key, weight) => fonts.font(key, weight)?.metrics ?? null, document.hanStyle);
  const box = pictureBoxOf(options);
  // A file per step: a turn between two (D22) has no picture of its own.
  const steps = stepsOf(document);
  // Twice when a References step is measured: its letters keep their pt size,
  // so how far they reach past its sheet is known only at the scale found first.
  let layoutSteps = diagramLayoutSteps(document);
  let scale = sharedScale(layoutSteps, box.size);
  if (scale !== null && steps.some((step) => step.picture?.kind === 'step-diagram')) {
    layoutSteps = diagramLayoutSteps(document, scale);
    scale = sharedScale(layoutSteps, box.size);
  }

  const digits = String(steps.length).length;
  const title = document.title.trim() || 'Diagram';
  const files: (StepFile & { index: number; lines: SetLine[] })[] = [];
  const skipped: number[] = [];
  const cut: number[] = [];
  const textWidthMm = options.widthMm - 2 * PAD_MM;
  steps.forEach((step, index) => {
    const number = index + 1;
    if (!stepPictureSource(step, document.assets)) {
      skipped.push(number);
      return;
    }
    let lines: SetLine[] = [];
    if (options.text && step.text.trim() !== '') {
      const all = setter.paragraph(step.text, textWidthMm, STEP_TEXT_SIZE_MM, Number.MAX_SAFE_INTEGER);
      lines = all.lines;
      if (options.sameSize && all.linesNeeded > STEP_FILE_TEXT_LINES) {
        lines = setter.paragraph(step.text, textWidthMm, STEP_TEXT_SIZE_MM, STEP_FILE_TEXT_LINES).lines;
        cut.push(number);
      }
    }
    files.push({
      stepId: step.id,
      number,
      fileStem: `${title}-step-${String(number).padStart(digits, '0')}`,
      index,
      lines,
    });
  });
  // An upload's text is set as its file is composed; what no font has is known now.
  for (const { face, text } of [...diagramUploadTexts(document), ...diagramLabelTexts(document)]) {
    setter.runs(text, face);
  }
  if (options.number) for (const { number } of files) setter.line(String(number), STEP_NUMBER_SIZE_MM, 700);

  return {
    files: files.map(({ stepId, number, fileStem }) => ({ stepId, number, fileStem })),
    skipped,
    cut,
    missing: [...setter.missing],
    compose(fileIndex) {
      const file = files[fileIndex];
      if (!file) throw new RangeError(`No step file ${fileIndex}`);
      const step = steps[file.index]!;
      const usage = new Map<string, Set<string>>();
      const count = (face: string, text: string) => {
        const characters = usage.get(face) ?? new Set<string>();
        for (const character of text) characters.add(character);
        usage.set(face, characters);
      };
      const paper = layoutSteps[file.index]?.picture?.kind === 'paper';
      const picture = cellPicture(
        step,
        document.assets,
        document.style,
        { pictureMm: box, mmPerUnit: paper ? scale : null },
        's-',
        { hanStyle: document.hanStyle, runs: setter.runs }
      );
      const body: string[] = [];
      if (picture) {
        body.push(picture.markup);
        for (const { face, characters } of picture.text) count(face, characters);
      }
      const drawn = picture
        ? {
            x: picture.boundsPt.x / PT_PER_MM,
            y: picture.boundsPt.y / PT_PER_MM,
            w: picture.boundsPt.width / PT_PER_MM,
            h: picture.boundsPt.height / PT_PER_MM,
          }
        : { x: box.x, y: box.y, w: box.size, h: box.size };

      // Where the number and the instruction go: the canvas's places, or the drawing's.
      const numberAt = options.sameSize
        ? { x: PAD_MM, y: PAD_MM + NUMBER_BASELINE_MM }
        : { x: drawn.x, y: drawn.y - (PICTURE_TOP_MM - NUMBER_BASELINE_MM) };
      let lines = file.lines;
      let textAt = { x: PAD_MM, y: options.heightMm - PAD_MM - textSlotMm() + TEXT_GAP_MM };
      if (!options.sameSize) {
        textAt = { x: drawn.x, y: drawn.y + drawn.h + TEXT_GAP_MM };
        const width = Math.min(textWidthMm, Math.max(drawn.w, CROPPED_TEXT_MIN_WIDTH_MM));
        if (lines.length > 0 && width < textWidthMm) {
          lines = setter.paragraph(step.text, width, STEP_TEXT_SIZE_MM, Number.MAX_SAFE_INTEGER).lines;
        }
      }

      // What the file draws, for a cropped file's edges.
      const extent = { left: drawn.x, top: drawn.y, right: drawn.x + drawn.w, bottom: drawn.y + drawn.h };
      const include = (left: number, top: number, right: number, bottom: number) => {
        extent.left = Math.min(extent.left, left);
        extent.top = Math.min(extent.top, top);
        extent.right = Math.max(extent.right, right);
        extent.bottom = Math.max(extent.bottom, bottom);
      };
      if (options.number) {
        const line = setter.line(String(file.number), STEP_NUMBER_SIZE_MM, 700);
        body.push(stepNumberElement(line, numberAt.x, numberAt.y, count));
        include(
          numberAt.x,
          numberAt.y - ASCENT_EM * STEP_NUMBER_SIZE_MM,
          numberAt.x + line.widthMm,
          numberAt.y + DESCENT_EM * STEP_NUMBER_SIZE_MM
        );
      }
      if (lines.length > 0) {
        body.push(stepTextElement(lines, textAt.x, textAt.y, count));
        include(
          textAt.x,
          textAt.y - ASCENT_EM * STEP_TEXT_SIZE_MM,
          textAt.x + Math.max(...lines.map((line) => line.widthMm)),
          textAt.y + (lines.length - 1) * STEP_TEXT_LEADING_MM + DESCENT_EM * STEP_TEXT_SIZE_MM
        );
      }

      const frame = options.sameSize
        ? { x: 0, y: 0, w: options.widthMm, h: options.heightMm }
        : {
            x: extent.left - PAD_MM,
            y: extent.top - PAD_MM,
            w: extent.right - extent.left + 2 * PAD_MM,
            h: extent.bottom - extent.top + 2 * PAD_MM,
          };
      const widthPt = frame.w * PT_PER_MM;
      const heightPt = frame.h * PT_PER_MM;
      const originPt = { x: frame.x * PT_PER_MM, y: frame.y * PT_PER_MM };
      if (!options.transparent) {
        body.unshift(
          `<rect x="${num(originPt.x)}" y="${num(originPt.y)}" width="${num(widthPt)}" height="${num(heightPt)}" ` +
            `fill="${BACKGROUND}"/>`
        );
      }
      const svg = svgDocument({
        widthPt,
        heightPt,
        originPt,
        fonts: embeddedFontFaces(
          new Map([...usage].map(([face, characters]) => [face, [...characters].join('')])),
          fonts,
          subsetter
        ),
        body,
      });
      return { svg, widthPt, heightPt };
    },
  };
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}
