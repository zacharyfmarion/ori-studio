import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_DISC_SIZE } from '../../lib/paper/paperLightDisc';
import { DEFAULT_PAPER_STYLE, PT_TO_CSS_PX, type PaperStyle } from '../../lib/paper/paperStyle';
import { erodePreviewGap } from './PaperErodePreview';
import { erodeSliderMax, formatErodePercent, PaperFoldedCard } from './PaperFoldedCard';
import type { PaperSettingsBinding } from './usePaperSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const calls = {
  setField: vi.fn(),
  adjustField: vi.fn(),
  endAdjustment: vi.fn(),
};

/**
 * The card reads four things off the binding and writes through three of them;
 * the rest of it is the preset list's, and is nothing to this card.
 */
function binding(style: PaperStyle, editable = true): PaperSettingsBinding {
  return { style, editable, ...calls } as unknown as PaperSettingsBinding;
}

function render(style: PaperStyle, editable = true): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<PaperFoldedCard paper={binding(style, editable)} />));
  return container;
}

/** The same card again with a different style, the way the binding hands one back. */
function rerender(style: PaperStyle, editable = true) {
  act(() => root?.render(<PaperFoldedCard paper={binding(style, editable)} />));
}

const erode = () => container!.querySelector<HTMLInputElement>('input[aria-label="Erode"]')!;
const disc = () =>
  container!.querySelector<HTMLButtonElement>('.settings-paper-light__disc') ?? null;
const switches = () => Array.from(container!.querySelectorAll<HTMLElement>('[role="switch"]'));

/** React listens for the native input event, so a slider's value goes in through the setter. */
function drag(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * A pointer event jsdom will carry: it has no `PointerEvent`, and React reads
 * the coordinates and the id off whatever is dispatched.
 */
function pointer(type: string, x: number, y: number): Event {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 7 });
  return event;
}

/** jsdom lays nothing out, so the disc has to be told how big it is. */
function placeDisc(element: HTMLElement, left = 200, top = 100) {
  element.getBoundingClientRect = () =>
    ({
      left,
      top,
      width: LIGHT_DISC_SIZE,
      height: LIGHT_DISC_SIZE,
      right: left + LIGHT_DISC_SIZE,
      bottom: top + LIGHT_DISC_SIZE,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  return { cx: left + LIGHT_DISC_SIZE / 2, cy: top + LIGHT_DISC_SIZE / 2 };
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe('erode label', () => {
  it('states a percentage without the noise, and off as off', () => {
    expect(formatErodePercent(2.5)).toBe('2.5');
    expect(formatErodePercent(0.25)).toBe('0.25');
    expect(formatErodePercent(4)).toBe('4');
    render({ ...DEFAULT_PAPER_STYLE, erode: 0 });
    expect(container!.querySelector('.settings-paper-folded__value')?.textContent).toBe('Off');
    expect(erode().getAttribute('aria-valuetext')).toBe('Off');
  });

  it('says what a live erode is worth, in the slider’s own voice', () => {
    render({ ...DEFAULT_PAPER_STYLE, erode: 0.025 });
    expect(container!.querySelector('.settings-paper-folded__value')?.textContent).toBe(
      '2.5% of the sheet'
    );
    expect(erode().getAttribute('aria-valuetext')).toBe('2.5% of the sheet');
  });
});

describe('erode slider', () => {
  it('offers the band the design draws, in percent', () => {
    render(DEFAULT_PAPER_STYLE);
    expect(erode().type).toBe('range');
    expect(erode().min).toBe('0');
    expect(erode().max).toBe('4');
    expect(erode().step).toBe('0.25');
  });

  /** A file, or the CP inspector's number field, may carry more than the slider offers. */
  it('stretches to hold a style that already erodes further', () => {
    expect(erodeSliderMax(2.5)).toBe(4);
    expect(erodeSliderMax(12)).toBe(12);
    render({ ...DEFAULT_PAPER_STYLE, erode: 0.12 });
    expect(erode().max).toBe('12');
    expect(erode().value).toBe('12');
  });

  /**
   * A ceiling read off the live value would shorten the track on every pointer
   * move, and the handle would jump back to the far end rather than follow.
   */
  it('keeps the stretched track while the value is dragged back down it', () => {
    render({ ...DEFAULT_PAPER_STYLE, erode: 0.12 });
    rerender({ ...DEFAULT_PAPER_STYLE, erode: 0.05 });
    expect(erode().max).toBe('12');
    rerender({ ...DEFAULT_PAPER_STYLE, erode: 0.01 });
    expect(erode().max).toBe('12');
  });

  it('still stretches when a style with more erode arrives', () => {
    render(DEFAULT_PAPER_STYLE);
    expect(erode().max).toBe('4');
    rerender({ ...DEFAULT_PAPER_STYLE, erode: 0.09 });
    expect(erode().max).toBe('9');
  });

  it('writes a fraction per move and settles once the drag ends', () => {
    render(DEFAULT_PAPER_STYLE);
    drag(erode(), '2.5');
    drag(erode(), '3');
    expect(calls.adjustField.mock.calls).toEqual([
      ['erode', 0.025],
      ['erode', 0.03],
    ]);
    expect(calls.endAdjustment).not.toHaveBeenCalled();
    // The end of a drag is the native `change`, which React's onChange is not.
    act(() => erode().dispatchEvent(new Event('change', { bubbles: true })));
    expect(calls.endAdjustment).toHaveBeenCalledTimes(1);
  });
});

describe('the card’s switches', () => {
  it('writes each one to the field it governs', () => {
    render(DEFAULT_PAPER_STYLE);
    const [aux, foldsAsEdges, light] = switches();
    act(() => aux!.click());
    expect(calls.setField).toHaveBeenCalledWith('auxCreases.visible', false);
    act(() => foldsAsEdges!.click());
    expect(calls.setField).toHaveBeenCalledWith('foldsAsEdges', true);
    act(() => light!.click());
    expect(calls.setField).toHaveBeenCalledWith('light', {
      ...DEFAULT_PAPER_STYLE.light,
      enabled: false,
    });
  });

  it('shows the disc only while the light is on', () => {
    render({
      ...DEFAULT_PAPER_STYLE,
      light: { ...DEFAULT_PAPER_STYLE.light, enabled: false },
    });
    expect(disc()).toBeNull();
    expect(switches().map((element) => element.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);
  });

  it('is shown but not the user’s to set while the export slot follows display', () => {
    render(DEFAULT_PAPER_STYLE, false);
    expect(erode().disabled).toBe(true);
    expect(disc()!.disabled).toBe(true);
    expect(switches().every((element) => element.hasAttribute('disabled'))).toBe(true);
  });
});

describe('the light disc', () => {
  it('carries both angles in its name, and draws the highlight where the light is', () => {
    render({
      ...DEFAULT_PAPER_STYLE,
      light: { enabled: true, azimuth: 90, elevation: 45 },
    });
    expect(disc()!.getAttribute('aria-label')).toBe(
      'Light direction: azimuth 90°, elevation 45°'
    );
    expect(
      Array.from(container!.querySelectorAll('.settings-paper-light__readout-value')).map(
        (element) => element.textContent
      )
    ).toEqual(['90°', '45°']);
    // Half the elevation is half way out from the centre, due east of it.
    const percent = (axis: string) =>
      Number.parseFloat(disc()!.style.getPropertyValue(`--settings-paper-light-${axis}`));
    expect(percent('x')).toBeCloseTo(((52 + 23) / LIGHT_DISC_SIZE) * 100, 6);
    expect(percent('y')).toBeCloseTo(50, 6);
  });

  it('is one gesture: a write per move, and a single settle at the end', () => {
    render(DEFAULT_PAPER_STYLE);
    const element = disc()!;
    const { cx, cy } = placeDisc(element);
    act(() => {
      element.dispatchEvent(pointer('pointerdown', cx, cy));
      element.dispatchEvent(pointer('pointermove', cx + 23, cy));
      element.dispatchEvent(pointer('pointermove', cx, cy - 46));
    });
    // The press is the first sample: the light goes where the disc was pressed.
    expect(calls.adjustField.mock.calls.map(([field]) => field)).toEqual([
      'light',
      'light',
      'light',
    ]);
    const light = (at: number) => calls.adjustField.mock.calls[at]![1] as PaperStyle['light'];
    expect(light(0).elevation).toBeCloseTo(90, 6);
    expect(light(1)).toMatchObject({ azimuth: 90, elevation: 45 });
    expect(light(2)).toMatchObject({ azimuth: 0, elevation: 0 });
    // Nothing discrete was written, and nothing settled, until the release.
    expect(calls.setField).not.toHaveBeenCalled();
    expect(calls.endAdjustment).not.toHaveBeenCalled();
    act(() => element.dispatchEvent(pointer('pointerup', cx, cy - 46)));
    expect(calls.endAdjustment).toHaveBeenCalledTimes(1);
  });

  it('ignores a move that is not part of a press', () => {
    render(DEFAULT_PAPER_STYLE);
    const element = disc()!;
    const { cx, cy } = placeDisc(element);
    act(() => element.dispatchEvent(pointer('pointermove', cx + 20, cy)));
    expect(calls.adjustField).not.toHaveBeenCalled();
  });

  it('steps the light by arrow key, each press a write of its own', () => {
    render({
      ...DEFAULT_PAPER_STYLE,
      light: { enabled: true, azimuth: 2, elevation: 88 },
    });
    const press = (key: string) =>
      act(() => {
        disc()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    press('ArrowLeft');
    press('ArrowUp');
    press('ArrowDown');
    press('Enter');
    expect(calls.setField.mock.calls.map(([, value]) => value)).toEqual([
      { enabled: true, azimuth: 357, elevation: 88 },
      { enabled: true, azimuth: 2, elevation: 90 },
      { enabled: true, azimuth: 2, elevation: 83 },
    ]);
    expect(calls.adjustField).not.toHaveBeenCalled();
  });
});

describe('the erode close-up', () => {
  const line = (role: string) =>
    container!.querySelector<SVGLineElement>(`.settings-paper-erode line[data-role="${role}"]`);

  // Erode is a share of the whole sheet, invisible at a settings card's size;
  // the close-up shows a tenth of the sheet, so the gap is ten times its
  // share of the box, and the pens keep their own weight.
  it('pulls the aux crease back from the paper’s edge by the erode, magnified', () => {
    render({ ...DEFAULT_PAPER_STYLE, erode: 0.01 });
    const gap = erodePreviewGap(0.01);
    expect(gap).toBeCloseTo(12, 9);
    expect(Number(line('aux')!.getAttribute('y2'))).toBeCloseTo(60 - gap, 9);
    expect(Number(line('aux')!.getAttribute('stroke-width'))).toBeCloseTo(
      DEFAULT_PAPER_STYLE.auxCreases.pen.width * PT_TO_CSS_PX,
      9
    );
  });

  it('runs the valley fold to the edge whatever the erode: only aux creases erode', () => {
    render({ ...DEFAULT_PAPER_STYLE, erode: 0.01 });
    expect(Number(line('valley')!.getAttribute('x2'))).toBe(104);
    expect(Number(line('valley')!.getAttribute('stroke-width'))).toBeCloseTo(
      DEFAULT_PAPER_STYLE.valleyFolds.width * PT_TO_CSS_PX,
      9
    );
  });

  it('runs the aux crease to the edge with erode off, and follows the style it shows', () => {
    render({ ...DEFAULT_PAPER_STYLE, erode: 0 });
    expect(Number(line('aux')!.getAttribute('y2'))).toBe(60);
    rerender({
      ...DEFAULT_PAPER_STYLE,
      auxCreases: { ...DEFAULT_PAPER_STYLE.auxCreases, visible: false },
    });
    // A style that hides aux creases shows none here either.
    expect(line('aux')).toBeNull();
  });
});
