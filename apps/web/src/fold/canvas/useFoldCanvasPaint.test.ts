import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { FOLD_SHEET_KEY } from '../document/foldStepTree';
import type { FoldScene, FoldStateSummary } from '../engine/foldEngineWire';
import { bookScene, flatSquareScene } from './foldCanvas.fixtures';
import { foldPickIndex } from './foldPicking';
import { FOLD_PANE_DISPLAY_DEFAULT, foldedDisplayOffset } from './foldPaneScenes';
import { foldedFormKey, useFoldCanvasPaint, type FoldCanvasPaint } from './useFoldCanvasPaint';
import type { FoldStateView } from './useFoldStateView';
import type { FoldToolPreview } from './useFoldToolPreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('foldedFormKey', () => {
  it('names the step on screen once its own picture is shown, the sheet by its key', () => {
    const book = bookScene();
    expect(foldedFormKey({ cursorId: 'fstep-1', scene: book, index: foldPickIndex(book, null, []) })).toBe('fstep-1');
    const sheet = flatSquareScene();
    expect(foldedFormKey({ cursorId: null, scene: sheet, index: foldPickIndex(sheet, null, []) })).toBe(FOLD_SHEET_KEY);
  });

  it('names nothing while the last picture shown stands in for the step on its way', () => {
    // The cursor moved on: its scene is not in, and the book is still shown.
    expect(foldedFormKey({ cursorId: 'fstep-2', scene: bookScene(), index: null })).toBeNull();
    // Its scene is in, but the picture shown is still the one before.
    const next = flatSquareScene();
    expect(foldedFormKey({ cursorId: 'fstep-2', scene: bookScene(), index: foldPickIndex(next, null, []) })).toBeNull();
    expect(foldedFormKey({ cursorId: null, scene: null, index: null })).toBeNull();
  });
});

describe('Rotate’s preview on the panes', () => {
  const SHEET: FoldStateSummary['sheet'] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const book = bookScene();
  const view = {
    cursorId: 'fstep-1',
    summary: { step: 1, sheet: SHEET } as unknown as FoldStateSummary,
    scene: book,
    index: foldPickIndex(book, null, []),
  } as unknown as FoldStateView;
  const idle = {
    candidates: null,
    build: { status: 'unlocated' },
    step: null,
    analysis: null,
    section: null,
    action: null,
    landed: null,
    refused: null,
    landing: false,
    reverse: null,
    crimp: null,
    tuck: null,
    vertex: null,
    sink: null,
    extent: null,
    turned: null,
  } as FoldToolPreview;
  /** The book turned a quarter counterclockwise about the origin: its middle lands at (−0.5, 0.5). */
  const turned: FoldScene = { ...book, view: { flipped: false, rotation: Math.PI / 2 }, view_transform: [0, -1, 0, 1, 0, 0] };

  function paintOf(preview: FoldToolPreview, shown: FoldStateView = view): FoldCanvasPaint {
    let painted: FoldCanvasPaint | null = null;
    function Probe() {
      const paint = useFoldCanvasPaint(shown, preview, FOLD_PANE_DISPLAY_DEFAULT, null, null);
      useEffect(() => {
        painted = paint;
      });
      return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe)));
    act(() => root.unmount());
    return painted!;
  }

  it('paints the model turned on the folded pane, about the sheet’s middle, and keeps the turned form in view', () => {
    const still = paintOf(idle);
    const turning = paintOf({ ...idle, turned });
    expect(still.folded.offset).toEqual({ x: 0, y: 0 });
    // The turned scene is placed so the sheet's middle stays where it was.
    expect(turning.folded.offset).toEqual(foldedDisplayOffset(turned, SHEET));
    expect(turning.folded.offset).toEqual({ x: 1, y: 0 });
    expect(turning.folded.scene).not.toEqual(still.folded.scene);
    // Another form: the pane keeps it in view as it keeps a new step's.
    expect(still.folded.keepInView).toBe('fstep-1');
    expect(turning.folded.keepInView).toBe('fstep-1|turned:0,-1,0,1,0,0');
  });

  it('leaves the crease pattern as it is: front up, the state on screen’s', () => {
    expect(paintOf({ ...idle, turned }).creasePattern.lines).toEqual(paintOf(idle).creasePattern.lines);
  });

  describe('an Import CP step', () => {
    const imported = { ...view, since: 0, imported: true } as FoldStateView;
    const creasesOf = (shown: FoldStateView, preview: FoldToolPreview) => paintOf(preview, shown).creasePattern.lines!;

    it('draws its own creases as the pattern, not as an instruction drawn wider over it', () => {
      // A fold step's own valley is its instruction...
      const folded = creasesOf({ ...view, since: 0, imported: false } as FoldStateView, idle);
      expect(folded.instruction.map((line) => line.letter)).toEqual(['valley']);
      // ...an import's is the pattern it collapses along, inked as Edit inks it.
      const lines = creasesOf(imported, idle);
      expect(lines.instruction).toEqual([]);
      expect(lines.creases.map((line) => line.color)).toContain('Blue2');
    });

    it('still draws a fold previewed from it as that fold’s instruction', () => {
      const landed = { scene: book, summary: view.summary!, added: new Set([6]) };
      const lines = creasesOf(imported, { ...idle, landed });
      expect(lines.instruction.map((line) => line.letter)).toEqual(['valley']);
    });
  });
});
