import { describe, expect, it, vi } from 'vitest';
import { face, line, SQUARE } from '../../lib/paper/paperScene.fixtures';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import type { FileService } from '../../platform/fileService';
import { linesUnderMarks } from '../annotate/linesUnderMarks';
import { annotation, NO_ASSETS, sceneStep } from '../annotate/pictureSnap.fixtures';
import { createDiagram, insertSteps, type DiagramStep, type DiagramStyle } from '../document/diagramDocument';
import { referencesStep } from '../document/diagramSteps.fixtures';
import { estimateTextSetter } from '../pages/estimateTextSetter';
import { cellPicture, type PictureText } from '../pages/pagePictures';
import { diagramScenePaintStyle } from './diagramPaperStyle';
import { exportStepPicture } from './exportStepPicture';
import { paintSource, sourceUnderMarks, stepPictureSource } from './paintDiagramStep';
import { stepDiagramPaintStyle } from './paintStepDiagram';
import { annotatedStepUrl } from './useStepPictureUrl';

/**
 * Which surfaces leave a picture's line out under a mark drawn along it: every
 * one that draws the marks over the picture at full strength — a card, the
 * canvas, a page and what is printed from one — and not Export Picture, which
 * writes the picture with no marks over it, nor Pose, which ghosts them.
 */
// The diagram's own pens are all one ink: here each line a picture or a mark draws has a colour of its own.
const style: DiagramStyle = {
  style: {
    ...DEFAULT_PAPER_STYLE,
    auxCreases: { visible: true, pen: { ...DEFAULT_PAPER_STYLE.auxCreases.pen, color: '#00aa11' } },
    valleyDiagramCreases: { ...DEFAULT_PAPER_STYLE.valleyDiagramCreases, color: '#aa0011' },
  },
};
const TEXT: PictureText = { hanStyle: 'sc', runs: estimateTextSetter.runs };
const CELL = { pictureMm: { x: 10, y: 20, size: 40 }, mmPerUnit: null, frameMm: null };

/** A crease pattern with one precrease across its middle; a valley drawn along it. */
const precrease = sceneStep([face([SQUARE]), line('aux', [0, 50], [100, 50])]);
const valley = annotation({ id: 'valley', kind: 'valley-line', from: [0, 0.5], to: [1, 0.5] });
const marked: DiagramStep = { ...precrease, annotations: [valley] };

/** How many lines `svg` draws in a pen of this colour. */
function linesIn(svg: string, color: string): number {
  return [...svg.matchAll(/<line [^>]*stroke="([^"]+)"/g)].filter(([, stroke]) => stroke === color).length;
}

const AUX = diagramScenePaintStyle(style, true).auxCreases.pen.color;

function decoded(url: string | null): string {
  const base64 = url?.replace(/^data:image\/svg\+xml;base64,/, '') ?? '';
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
}

describe('a line drawn along a crease, on each surface', () => {
  it('leaves the precrease out of a page’s picture, and only there under the mark', () => {
    expect(linesIn(cellPicture(precrease, NO_ASSETS, style, CELL, 'c0-', TEXT)!.markup, AUX)).toBe(1);
    expect(linesIn(cellPicture(marked, NO_ASSETS, style, CELL, 'c0-', TEXT)!.markup, AUX)).toBe(0);
    const half: DiagramStep = { ...precrease, annotations: [{ ...valley, to: [0.5, 0.5] }] };
    expect(linesIn(cellPicture(half, NO_ASSETS, style, CELL, 'c0-', TEXT)!.markup, AUX)).toBe(1);
  });

  it('leaves a References step’s own line out under a mark drawn along it', () => {
    // Its valley runs across the unit sheet's middle (`SENT_MODEL`).
    const step: DiagramStep = { ...referencesStep('step-sent'), annotations: [valley] };
    const source = stepPictureSource(step, NO_ASSETS)!;
    const pen = stepDiagramPaintStyle(style).valleyDiagramCreases.color;
    expect(linesIn(paintSource(source, style)!.svg, pen)).toBe(1);
    const covering = linesUnderMarks(step, NO_ASSETS, style);
    expect(linesIn(paintSource(sourceUnderMarks(source, covering), style)!.svg, pen)).toBe(0);
  });

  it('keeps the whole picture in Export Picture', async () => {
    const document = { ...insertSteps(createDiagram({ title: 'Crane' }), [marked], 0), style };
    const saveTextFile = vi.fn(async () => 'saved');
    expect(await exportStepPicture(document, marked.id, { saveTextFile } as unknown as FileService)).toBe('svg');
    const [[{ contents }]] = saveTextFile.mock.calls as unknown as [[{ contents: string }]];
    expect(linesIn(contents, AUX)).toBe(1);
  });

  it('keeps the whole picture under Pose’s ghosted marks, and leaves it out under a card’s', () => {
    const source = stepPictureSource(marked, NO_ASSETS)!;
    expect(linesIn(decoded(annotatedStepUrl(source, marked.annotations, style, 0.3, false)), AUX)).toBe(1);
    const covered = sourceUnderMarks(source, linesUnderMarks(marked, NO_ASSETS, style));
    expect(linesIn(decoded(annotatedStepUrl(covered, marked.annotations, style, 1, false)), AUX)).toBe(0);
  });
});
