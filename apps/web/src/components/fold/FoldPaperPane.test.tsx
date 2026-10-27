import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FOLD_DEFAULT_PAPER_STYLE,
  regularPolygonShape,
  type FoldPaperShape,
  type FoldStartSide,
} from '../../fold/document/foldSequenceDocument';
import {
  type DocumentPaperStyle,
  type DocumentPaperStyleChoice,
} from '../../lib/paper/documentPaperStyle';
import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { useSettingsStore } from '../../store/settingsStore';
import { TooltipProvider } from '../ui/Tooltip';
import { FoldPaperPane } from './FoldPaperPane';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Radix Select scrolls the selected option into view as it opens.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

let host: HTMLDivElement;
let root: Root;
const onImportSheet = vi.fn<() => void>();
const onStartSideChange = vi.fn<(side: FoldStartSide) => void>();
const onStyleChange = vi.fn<(choice: DocumentPaperStyleChoice) => void>();

/** The tab over document state it owns, as the store will hold it. */
function Harness({
  shape = { kind: 'square' },
  stepCount = 0,
  readOnly = false,
  initialStyle = FOLD_DEFAULT_PAPER_STYLE,
}: {
  shape?: FoldPaperShape;
  stepCount?: number;
  readOnly?: boolean;
  initialStyle?: DocumentPaperStyle;
}) {
  const [side, setSide] = useState<FoldStartSide>('front');
  const [style, setStyle] = useState(initialStyle);
  return (
    <TooltipProvider>
      <FoldPaperPane
        style={style}
        onStyleChange={(choice) => {
          onStyleChange(choice);
          setStyle(choice.style);
        }}
        shape={shape}
        startSide={side}
        stepCount={stepCount}
        readOnly={readOnly}
        onImportSheet={onImportSheet}
        onStartSideChange={(next) => {
          onStartSideChange(next);
          setSide(next);
        }}
      />
    </TooltipProvider>
  );
}

beforeEach(() => {
  onImportSheet.mockReset();
  onStartSideChange.mockReset();
  onStyleChange.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
});

const render = (props: Parameters<typeof Harness>[0] = {}) => act(() => root.render(<Harness {...props} />));
const segment = (group: string, name: string) =>
  host.querySelector<HTMLButtonElement>(`[role="group"][aria-label="${group}"] button[aria-label="${name}"]`) ??
  [...host.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${group}"] button`)].find(
    (element) => element.textContent?.trim() === name
  );
const pressed = (group: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${group}"] button`)]
    .filter((element) => element.getAttribute('aria-pressed') === 'true')
    .map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim());
const button = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === name);
const notice = () => host.querySelector('[role="status"]')?.textContent ?? null;
const display = () => useSettingsStore.getState().paperStyle.display;
const styleShown = () => host.querySelector('button[aria-label="Style"]')?.textContent ?? null;
/** The Shape row's text: what the sheet is. */
const shapeShown = () =>
  [...host.querySelectorAll('*')].find((element) => element.textContent?.trim().startsWith('Shape') && element.children.length >= 2)
    ?.textContent?.replace(/^Shape/, '')
    .trim() ?? null;

async function choose(selectLabel: string, option: string) {
  const trigger = host.querySelector<HTMLButtonElement>(`button[aria-label="${selectLabel}"]`);
  await act(async () => {
    trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (element) => element.textContent?.trim() === option
  );
  if (!item) throw new Error(`no ${option} option`);
  await act(async () => item.click());
}

describe('FoldPaperPane', () => {
  describe('style', () => {
    it('starts in Diagram and lets the sequence choose Default', async () => {
      render();
      // No colour pickers: the look is a style, chosen whole.
      expect(host.querySelector('input[type="color"]')).toBeNull();
      expect(styleShown()).toBe('Diagram');
      await choose('Style', 'Default');
      expect(onStyleChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'builtin:default', analytics: 'default' }));
      expect(styleShown()).toBe('Default');
    });

    it('copies the Settings export style into the sequence as it is when chosen', async () => {
      render();
      await choose('Style', 'Export style from Settings');
      expect(onStyleChange.mock.lastCall?.[0].style).toEqual({ style: display() });
      expect(onStyleChange.mock.lastCall?.[0].analytics).toBe('export-style');
    });

    it('names a style no choice holds the sequence’s own', () => {
      render({ initialStyle: { style: { ...DEFAULT_PAPER_STYLE, erode: 0.2 } } });
      expect(styleShown()).toBe('This sequence’s own');
    });
  });

  describe('start side', () => {
    it('is Front up or Back up, each with its face’s colour in the sequence’s style', () => {
      render();
      expect(pressed('Start')).toEqual(['Front up']);
      const swatches = [...host.querySelectorAll<HTMLElement>('[role="group"][aria-label="Start"] button span')]
        .map((element) => element.style.background)
        .filter(Boolean);
      // Diagram’s white front and grey back.
      const { front, back } = builtInPaperPreset('diagram').style.paper;
      expect(front).toBe('#ffffff');
      expect(back).toBe('#b3b3b3');
      expect(swatches).toEqual(['rgb(255, 255, 255)', 'rgb(179, 179, 179)']);
      act(() => segment('Start', 'Back up')?.click());
      expect(onStartSideChange).toHaveBeenCalledWith('back');
      expect(pressed('Start')).toEqual(['Back up']);
    });
  });

  describe('sheet', () => {
    it('shows the sheet’s shape, and offers no shape controls: only Import starting sheet', () => {
      render();
      expect(shapeShown()).toBe('Square');
      expect(host.querySelector('[role="group"][aria-label="Shape"]')).toBeNull();
      expect(host.querySelector('input[aria-label="Sides"]')).toBeNull();
      act(() => button('Import starting sheet…')?.click());
      expect(onImportSheet).toHaveBeenCalledTimes(1);
    });

    it('names a rectangle by its ratio and a polygon by its sides, regular or not', () => {
      render({ shape: { kind: 'rectangle', aspect: [Math.SQRT1_2, 1] } });
      expect(shapeShown()).toBe('Rectangle, 1 : 1.414');
      render({ shape: regularPolygonShape(6)! });
      expect(shapeShown()).toBe('Regular polygon, 6 sides');
      render({ shape: { kind: 'polygon', points: [[0, 0], [1, 0], [0.8, 0.6], [0.1, 0.4]] } });
      expect(shapeShown()).toBe('Polygon, 4 sides');
    });

    it('says beforehand that a new sheet starts the sequence over', () => {
      render();
      expect(notice()).toBeNull();
      render({ stepCount: 1 });
      expect(notice()).toBe('A new starting sheet starts over: the sequence’s 1 step is cleared. Undo brings it back.');
      render({ stepCount: 7 });
      expect(notice()).toBe('A new starting sheet starts over: the sequence’s 7 steps are cleared. Undo brings them back.');
    });
  });

  it('keeps a read-only sequence’s sheet and style as they are', () => {
    render({ shape: regularPolygonShape(5)!, stepCount: 3, readOnly: true });
    expect(button('Import starting sheet…')?.disabled).toBe(true);
    expect(segment('Start', 'Back up')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Style"]')?.disabled).toBe(true);
    // Nothing to warn about: the sheet cannot change.
    expect(notice()).toBeNull();
  });
});
