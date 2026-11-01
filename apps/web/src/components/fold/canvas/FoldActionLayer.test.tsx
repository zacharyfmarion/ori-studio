import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FoldActionGeometry } from '../../../fold/engine/foldEngineWire';
import { DEFAULT_ORISTUDIO_CP_LINE_WIDTH } from '../../../lib/creasePatternViewport';
import { applyPaperStylePolicy, PAPER_STYLE_POLICIES } from '../../../lib/paper/paperStyleResolve';
import { DEFAULT_PAPER_STYLE, PT_TO_CSS_PX } from '../../../lib/paper/paperStyle';
import {
  canvasDiagramInk,
  CP_CREASE_WIDTH_FACTOR,
  DIAGRAM_MARKS,
  REFERENCES_VIEW_MARKS,
} from '../../../lib/stepDiagram/diagramInk';
import { FoldActionLayer, foldActionMarks } from './FoldActionLayer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** The References view's letter, on screen: what the folded pane's must match. */
const REFERENCES_LETTER_PX = REFERENCES_VIEW_MARKS.labelSize * canvasDiagramInk(DEFAULT_ORISTUDIO_CP_LINE_WIDTH);

const SQUARE = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** 400 px to the unit, y up. */
const VIEW = { origin: [100, 500] as const, ex: [400, 0] as const, ey: [0, -400] as const };

describe('FoldActionLayer', () => {
  it('sizes letters, rings and arrowheads like the References view whatever the pen it draws with', () => {
    for (const ink of [0.4, 1, 2.5]) {
      const marks = foldActionMarks(ink);
      for (const mark of ['labelSize', 'ringRadius', 'arrowheadLength'] as const) {
        expect(marks[mark] * ink).toBeCloseTo(
          REFERENCES_VIEW_MARKS[mark] * canvasDiagramInk(DEFAULT_ORISTUDIO_CP_LINE_WIDTH),
          9
        );
      }
    }
  });

  it('draws its letters that size — larger than the print size it had — and a reverse fold’s push', () => {
    const action: FoldActionGeometry = {
      kind: 'fold',
      direction: 'mountain',
      line: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
      spans: [],
      moving: [1],
      grip: { at: { x: 0.8, y: 0.3 }, image: { x: 0.8, y: 0.7 }, hidden_at: 0, hidden_image: null },
      push: { at: { x: 0.45, y: 0.05 }, toward: { x: 0.7, y: 0.3 } },
    };
    act(() =>
      root.render(
        <FoldActionLayer
          action={action}
          letters={[{ kind: 'point', at: { x: 0.2, y: 0.2 }, letter: 'A' }]}
          view={VIEW as never}
          style={DEFAULT_PAPER_STYLE}
          outline={SQUARE}
          ground="#ffffff"
        />
      )
    );
    const label = [...host.querySelectorAll('text')].find((text) => text.textContent === 'A');
    const size = Number(label?.getAttribute('font-size'));
    expect(size).toBeCloseTo(REFERENCES_LETTER_PX, 6);
    // The style's own edge pen gave the old, unreadable size.
    const seen = applyPaperStylePolicy(DEFAULT_PAPER_STYLE, PAPER_STYLE_POLICIES.fold);
    const printInk = canvasDiagramInk((seen.edges.width * PT_TO_CSS_PX) / CP_CREASE_WIDTH_FACTOR);
    expect(size).toBeGreaterThan(DIAGRAM_MARKS.labelSize * printInk);
    // The push is drawn: a hollow outline, filled with the paper and stroked, beside the fold's arrow.
    const withPush = host.querySelectorAll('path').length;
    const { push: _push, ...plain } = action;
    act(() =>
      root.render(
        <FoldActionLayer action={plain} view={VIEW as never} style={DEFAULT_PAPER_STYLE} outline={SQUARE} ground="#ffffff" />
      )
    );
    expect(withPush - host.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
  });

  it('draws a compound fold’s pleat: a bolt in the arrow’s pen with its head, alone or beside the arrow', () => {
    const action: FoldActionGeometry = {
      kind: 'fold',
      direction: 'valley',
      line: null,
      spans: [],
      moving: [1],
      grip: null,
      pleat: { from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 }, kinks: 1 },
    };
    const render = (shown: FoldActionGeometry) =>
      act(() =>
        root.render(
          <FoldActionLayer action={shown} view={VIEW as never} style={DEFAULT_PAPER_STYLE} outline={SQUARE} ground="#ffffff" />
        )
      );
    render(action);
    // Nothing else to draw, and still drawn: its shaft and its head.
    expect(host.querySelector('[data-fold-action]')).not.toBeNull();
    const shafts = [...host.querySelectorAll('path')].filter((path) => path.getAttribute('stroke-linejoin') === 'miter');
    expect(shafts.length).toBeGreaterThan(0);
    const { pleat: _pleat, ...without } = action;
    render(without);
    expect(host.querySelector('[data-fold-action]')).toBeNull();
  });
});
