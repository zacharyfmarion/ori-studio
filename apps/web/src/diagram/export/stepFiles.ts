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
import { STEP_NUMBER_SIZE_MM, STEP_TEXT_LEADING_MM, STEP_TEXT_SIZE_MM, pictureFit, type SetLine } from '../pages/diagramPageLayout';
import {
  diagramLabelTexts,
  diagramLayoutSteps,
  diagramUploadTexts,
  largestHeld,
  MEASURE_SETTLED,
} from '../pages/diagramPages';
import { fontTextSetter } from '../pages/fontTextSetter';
import { cellPicture, layoutPicture } from '../pages/pagePictures';
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
  /** The mm per pattern unit every paper picture is drawn at (D10); null with none. */
  mmPerUnit: number | null;
  /** File `index` (of `files`) as an SVG document. */
  compose: (index: number) => PaperSvgResult;
}

/** The least of its box's fit a picture is drawn at to keep its whole reach on a canvas of one size. */
const CANVAS_KEEP = 0.5;

/** How many times the shared scale may be taken down for a picture that does not hold at it. */
const HOLD_PASSES = 8;

/**
 * D10's shared scale for a box: the largest mm per unit at which every paper
 * picture holds the box, its marks as the pages count them, measured at that
 * scale (`largestHeld`). On a canvas of one size (`canvas`, the room round
 * the box's centre), where marks the floor lets reach out of the box would be
 * cut at its edge, no larger than keeps a picture's whole reach on the
 * canvas, placed in the box as a file places it — or off it the least it can,
 * never drawn under {@link CANVAS_KEEP} of its box's fit for it. A picture
 * drawn smaller than its own at the shared scale, whose marks reach out
 * unevenly, may not hold there: the scale goes down to the largest it does.
 */
function sharedScale(
  document: DiagramDocument,
  boxMm: number,
  canvas: { across: number; down: number } | null
): number | null {
  const lip = canvas ? { across: (canvas.across - boxMm) / 2, down: (canvas.down - boxMm) / 2 } : null;
  const pictures = stepsOf(document).flatMap((step) => {
    const measured = (scale: number | null) =>
      layoutPicture(step, document.assets, document.style, scale === null ? null : { mmPerUnit: scale });
    if (measured(null)?.kind !== 'paper') return [];
    const boxFit = largestHeld((scale) => pictureFit(measured(scale), boxMm, boxMm));
    if (boxFit === null || !(boxFit > 0)) return [];
    /** Its fit measured at `scale`: in the box, and on the canvas. */
    const fit = (scale: number | null) => {
      const picture = measured(scale);
      const inBox = pictureFit(picture, boxMm, boxMm);
      if (!lip || inBox === null) return inBox;
      const onCanvas = pictureFit(picture, boxMm, boxMm, { lip, from: CANVAS_KEEP * boxFit });
      return onCanvas === null ? inBox : Math.min(inBox, onCanvas);
    };
    const held = lip ? largestHeld(fit) : boxFit;
    return held !== null && held > 0 ? [{ fit, held }] : [];
  });
  if (pictures.length === 0) return null;
  let scale = Math.min(...pictures.map(({ held }) => held));
  for (let pass = 0; pass < HOLD_PASSES; pass += 1) {
    const failing = pictures.filter(({ fit }) => {
      const there = fit(scale);
      return there === null || there < scale * (1 - MEASURE_SETTLED);
    });
    if (failing.length === 0) break;
    scale = Math.min(...failing.map(({ fit }) => largestHeld(fit, scale) ?? 0));
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
  // A canvas of one size: the room round the box's centre, the pad included.
  const middle = box.y + box.size / 2;
  const canvas = options.sameSize
    ? { across: options.widthMm, down: 2 * Math.min(middle, options.heightMm - middle) }
    : null;
  // Its letters and marks keep their pt size, so how far they reach past a
  // picture is known only at its scale: each found where it holds, measured
  // there, as the pages find theirs (`layoutDiagram`).
  const layoutSteps = diagramLayoutSteps(document);
  const scale = sharedScale(document, box.size, canvas);

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
    mmPerUnit: scale,
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
        { pictureMm: box, mmPerUnit: paper ? scale : null, frameMm: null },
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
