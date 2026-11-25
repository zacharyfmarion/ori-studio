/**
 * A Fold sequence's steps as paper pages (plan D11): the crease pattern by
 * step, one page per numbered step of the active path, through the paper
 * export every step-diagram surface shares (`stepDiagramExportTarget`, the
 * `fold` policy).
 *
 * A step's page is its state's crease pattern in sheet coordinates (the
 * scene's `creases`, unit frame, y-up, as a step diagram is): the folds
 * earlier steps made in the fold pens, the precreases and unfolded creases in
 * the crease pen, and this step's own creases in the diagram-crease pens — the
 * instruction. Letters are front-relative, so a page is read from the front
 * whatever the view. Turns and rotations change no crease and are not
 * numbered, so they get no page.
 *
 * Pure: no React, no store, no engine.
 */

import type { TFunction } from 'i18next';
import {
  stepDiagramPageScene,
  type StepDiagramPageInput,
} from '../../cp-workspace/references/referencesStepExport';
import {
  stepDiagramExportTarget,
  type StepDiagramExportPage,
} from '../../cp-workspace/references/referencesExportTarget';
import { DEFAULT_ORISTUDIO_CP_LINE_WIDTH } from '../../lib/creasePatternViewport';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import type { PaperExportTarget } from '../../paperExport/paperExportTarget';
import type { DiagramSheet } from '../../lib/stepDiagram/stepDiagramGeometry';
import type { DiagramLineStyleName, StepDiagramModel, StepDiagramPrimitive } from '../../lib/stepDiagram/stepDiagramModel';
import { madeByStep } from '../canvas/foldPaneScenes';
import type { FoldOp } from '../document/foldSequenceDocument';
import type { FoldSceneCrease } from '../engine/foldEngineWire';

/** A crease's role on its step's page: its letter when it is the step's own, its instruction. */
function lineStyle(crease: FoldSceneCrease, own: boolean): DiagramLineStyleName | null {
  if (crease.kind === 'border') return null;
  if (own && crease.letter) return crease.letter;
  if (crease.kind === 'fold' && crease.letter) return crease.letter === 'mountain' ? 'fold-mountain' : 'fold-valley';
  return 'crease';
}

/**
 * The sheet a page is drawn on: the outline's extent in the unit frame, and
 * the outline itself when it is not that rectangle — a polygon sheet.
 */
function pageSheet(outline: readonly (readonly [number, number])[]): DiagramSheet {
  const xs = outline.map(([x]) => x);
  const ys = outline.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const width = Math.max(maxX - minX, 0);
  const height = Math.max(maxY - minY, 0);
  const sheet: DiagramSheet = { width, height, centre: [(minX + maxX) / 2, (minY + maxY) / 2] };
  const tolerance = 1e-9 * Math.max(width, height, 1);
  const near = (value: number, ...ends: number[]) => ends.some((end) => Math.abs(value - end) <= tolerance);
  // The extent's own rectangle: four corners on it. A diamond has four points too.
  const rectangle = outline.length === 4 && outline.every(([x, y]) => near(x, minX, maxX) && near(y, minY, maxY));
  return rectangle ? sheet : { ...sheet, outline: outline.map(([x, y]) => [x, y] as const) };
}

/**
 * A step's page: the crease pattern of the state it lands, its own creases
 * the instruction. `step` is the step's number in the state (`summary.step`),
 * what each crease's `made_at` counts in, and `since` the number of the state
 * it folds from — every crease made after it is the step's, a Repeat's every
 * operation's (`foldOpSteps`); one before `step` when unsaid. `outline` is the
 * sheet's (`summary.sheet`).
 */
export function foldStepCreaseDiagram(
  creases: readonly FoldSceneCrease[],
  outline: readonly (readonly [number, number])[],
  step: number,
  since: number = step - 1
): StepDiagramModel {
  const sheet = pageSheet(outline);
  const primitives: StepDiagramPrimitive[] = [{ kind: 'sheet', width: sheet.width, height: sheet.height }];
  const lines: StepDiagramPrimitive[] = [];
  const instructions: StepDiagramPrimitive[] = [];
  for (const crease of creases) {
    const own = crease.letter !== null && madeByStep(crease.made_at, { step, since });
    const style = lineStyle(crease, own);
    if (!style) continue;
    const line: StepDiagramPrimitive = {
      kind: 'line',
      from: [crease.from.x, crease.from.y],
      to: [crease.to.x, crease.to.y],
      style,
    };
    // The instruction over the paper as it stands.
    (own ? instructions : lines).push(line);
  }
  return { sheet, primitives: [...primitives, ...lines, ...instructions] };
}

/** Whether a step gets a page, and a number: everything but a turn or a rotation. */
export function foldStepIsNumbered(op: FoldOp): boolean {
  return op.kind !== 'turn' && op.kind !== 'rotate';
}

/** One page: its diagram, and the step's number on the active path. */
export interface FoldStepPage {
  /** 1-based, as the strip numbers it. */
  number: number;
  diagram: StepDiagramModel;
}

export interface FoldStepsExportCapture {
  /** The numbered steps of the active path, in order. */
  pages: readonly FoldStepPage[];
  /** The page on show: the step on screen, or the nearest numbered one before it. */
  current: number;
  /** The sequence's title, or the project's: the files' names. */
  title: string;
  /** The Settings export style; a step pins nothing of its own. */
  exportStyle: PaperStyle;
  t: TFunction;
}

/** The base of the files' names: the title, or "Untitled". */
function stem(title: string): string {
  return title.trim() || 'Untitled';
}

/**
 * The export dialog's target for the steps: one page per numbered step, the
 * step on show first in view, every page in one ZIP for "all". Named as
 * References names its step pages, so a reader's files from the two read
 * alike: `<title> step 3`, and inside the ZIP `03 step 3`.
 */
export function foldStepsExportTarget({ pages, current, title, exportStyle, t }: FoldStepsExportCapture): PaperExportTarget {
  const onShow = pages[current] ?? pages[0];
  const width = String(pages.length).length;
  const steps: StepDiagramExportPage[] = pages.map((page, index) => ({
    diagram: page.diagram,
    mirrored: false,
    label: t('dialogs:paperExport.pageStep', 'Step {{number}}', { number: page.number }),
    entryStem: `${String(index + 1).padStart(width, '0')} step ${page.number}`,
  }));
  return stepDiagramExportTarget({
    surface: 'fold',
    // A page is the crease pattern: no letters, no reference lines to leave out.
    marks: [],
    steps,
    current: Math.min(Math.max(current, 0), Math.max(steps.length - 1, 0)),
    title: t('dialogs:paperExport.titleStep', 'Export step {{number}}', { number: onShow?.number ?? 1 }),
    fileStem: `${stem(title)} step ${onShow?.number ?? 1}`,
    allTitle: t('dialogs:paperExport.titleAllSteps', 'Export all steps'),
    zipStem: `${stem(title)} steps`,
    exportStyle,
    stepScene: (diagram, input: StepDiagramPageInput) =>
      stepDiagramPageScene(diagram, {
        ...input,
        surface: 'fold',
        // The letters and marks at the weight a step diagram opens at.
        lineWidth: DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
        showAux: null,
      }),
  });
}
