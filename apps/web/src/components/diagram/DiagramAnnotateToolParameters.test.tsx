import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storageKey, STORAGE_KEYS } from '../../lib/storage';
import { useSettingsStore } from '../../store/settingsStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramAnnotateToolParameters } from './DiagramAnnotateToolParameters';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DiagramAnnotateToolParameters', () => {
  it('offers star fill only for Star and keeps it for the next mark', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    useSettingsStore.setState({ diagramAnnotateStarFill: 'black' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const render = (tool: 'star' | 'circle' | null) =>
      act(() =>
        root!.render(
          <TooltipProvider>
            <DiagramAnnotateToolParameters tool={tool} />
          </TooltipProvider>
        )
      );
    const group = () => container!.querySelector('fieldset[aria-label="Star Fill"]');
    render(null);
    expect(group()).toBeNull();
    render('circle');
    expect(group()).toBeNull();
    render('star');
    const options = () => [...group()!.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Star Fill"] button')];
    // Filled, then Outline, each a small star; Filled until one is chosen.
    expect(options().map((each) => each.textContent)).toEqual(['Filled', 'Outline']);
    expect(options().map((each) => each.querySelector('[data-glyph-fill]')!.getAttribute('data-glyph-fill'))).toEqual(['black', 'white']);
    expect(options().map((each) => each.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    act(() => options()[1]!.click());
    expect(useSettingsStore.getState().diagramAnnotateStarFill).toBe('white');
  });

  it('leaves line type to the permanent rail', () => {
    container = document.createElement('div'); root = createRoot(container);
    act(() => root!.render(<TooltipProvider><DiagramAnnotateToolParameters tool="line" /></TooltipProvider>));
    expect(container.querySelector('[aria-label="Line Type"]')).toBeNull();
  });

  it('offers text defaults only for Text and keeps them for the next label', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.releasePointerCapture ??= () => undefined;
    Element.prototype.scrollIntoView ??= () => undefined;
    useSettingsStore.setState({ diagramAnnotateTextStyle: { color: null, bold: false, halo: false, sizePt: null } });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const render = (tool: 'label' | null) =>
      act(() =>
        root!.render(
          <TooltipProvider>
            <DiagramAnnotateToolParameters tool={tool} />
          </TooltipProvider>
        )
      );
    const group = () => container!.querySelector('fieldset[aria-label="Text Style"]');
    render(null);
    expect(group()).toBeNull();
    render('label');
    const color = () => group()!.querySelector<HTMLButtonElement>('button[aria-label="Text Color"]')!;
    const size = () => group()!.querySelector<HTMLButtonElement>('button[aria-label="Size"]')!;
    const bold = () => group()!.querySelector<HTMLButtonElement>('[aria-label="Bold"]')!;
    const halo = () => group()!.querySelector<HTMLButtonElement>('[aria-label="Halo"]')!;
    // Today's look until one is chosen.
    expect([color().textContent, size().textContent]).toEqual(['Ink', 'With the picture']);
    expect([bold().getAttribute('aria-checked'), halo().getAttribute('aria-checked')]).toEqual(['false', 'false']);
    const choose = (select: HTMLButtonElement, name: string) => {
      act(() => select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) => each.textContent === name)!;
      act(() => option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    };
    choose(color(), 'Reference');
    act(() => bold().click());
    act(() => halo().click());
    choose(size(), '9 pt');
    expect(useSettingsStore.getState().diagramAnnotateTextStyle).toEqual({ color: '#c91d87', bold: true, halo: true, sizePt: 9 });
    expect([bold().getAttribute('aria-checked'), halo().getAttribute('aria-checked')]).toEqual(['true', 'true']);
    expect(size().textContent).toBe('9 pt');
  });


  it('shares a persisted circle mode across circular tools without changing existing marks', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    useSettingsStore.setState({ diagramAnnotateCircleMode: 'bounds' });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    const render = (tool: 'circle' | 'close-up' | 'enlarge' | 'x-ray' | 'enlarge-frame') => act(() => root!.render(
      <TooltipProvider><DiagramAnnotateToolParameters tool={tool} /></TooltipProvider>
    ));
    render('circle');
    act(() => container!.querySelector<HTMLButtonElement>('button[title="Center"]')!.click());
    expect(useSettingsStore.getState().diagramAnnotateCircleMode).toBe('center');
    expect(localStorage.getItem(storageKey(STORAGE_KEYS.diagramAnnotateCircleMode))).toBe('center');
    for (const tool of ['close-up', 'enlarge', 'x-ray'] as const) {
      render(tool);
      expect(container!.querySelector('button[title="Center"]')!.getAttribute('aria-pressed')).toBe('true');
    }
    render('enlarge-frame');
    expect(container!.textContent).toBe('');
  });
});
