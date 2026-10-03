import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import { useSettingsStore } from '../../store/settingsStore';
import type { PostHogClientLike } from '../bootstrap';
import { paperDisplayStyleName, paperExportStyleName } from '../paperStyleProperties';
import { AnalyticsRuntimeProvider } from '../runtime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialSettings = useSettingsStore.getInitialState();
const store = () => useSettingsStore.getState();
const names = () => ({
  display: paperDisplayStyleName(store().paperStyle),
  export: paperExportStyleName(store().paperStyle),
});

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState(initialSettings, true);
});

afterEach(() => {
  useSettingsStore.setState(initialSettings, true);
});

describe('the paper style a person runs', () => {
  it('reads a first run as Default, with exports following it', () => {
    expect(names()).toEqual({ display: 'default', export: 'linked' });
  });

  it('names a built-in by its id, and a preset of the user’s own as custom, never by name', () => {
    store().applyPaperPreset('display', builtInPaperPreset('diagram'));
    expect(names().display).toBe('diagram');
    store().setPaperStyleField('display', 'paper.front', '#123456');
    store().savePaperPreset('My crane');
    expect(names().display).toBe('custom');
  });

  it('reads an edited preset, or a style no preset holds, as unsaved', () => {
    store().setPaperStyleField('display', 'erode', 0.02);
    expect(names().display).toBe('unsaved');
    store().savePaperPreset('Mine');
    store().setPaperStyleField('display', 'erode', 0.03);
    expect(names().display).toBe('unsaved');
  });

  it('names the export slot’s own style once it is detached', () => {
    store().setExportPaperStyleFollowsDisplay(false);
    expect(names().export).toBe('default');
    store().applyPaperPreset('export', builtInPaperPreset('diagram'));
    expect(names()).toEqual({ display: 'default', export: 'diagram' });
    store().setPaperStyleField('export', 'paper.back', '#654321');
    expect(names().export).toBe('unsaved');
    store().setExportPaperStyleFollowsDisplay(true);
    expect(names().export).toBe('linked');
  });
});

describe('AnalyticsRuntimeProvider paper style sync', () => {
  let container: HTMLElement;
  let root: Root;

  function makeFakeClient() {
    return {
      init: vi.fn(),
      register: vi.fn(),
      opt_in_capturing: vi.fn(),
      opt_out_capturing: vi.fn(),
      identify: vi.fn(),
      capture: vi.fn(),
      reset: vi.fn(),
    } satisfies PostHogClientLike;
  }

  /** Every paper style registration, in order. */
  function registered(client: ReturnType<typeof makeFakeClient>) {
    return client.register.mock.calls
      .map(([props]) => props as Record<string, unknown>)
      .filter((props) => 'paper_display_style' in props);
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('registers both on mount, and again only when a name changes', () => {
    const client = makeFakeClient();
    act(() => root.render(createElement(AnalyticsRuntimeProvider, { client, children: null })));
    expect(registered(client)).toEqual([{ paper_display_style: 'default', paper_export_style: 'linked' }]);

    // A colour drag writes the store per move; while the name holds, nothing
    // is registered again.
    act(() => store().applyPaperPreset('display', builtInPaperPreset('diagram')));
    act(() => store().setPaperStyleField('display', 'paper.front', '#111111'));
    act(() => store().setPaperStyleField('display', 'paper.front', '#222222'));
    act(() => store().setExportPaperStyleFollowsDisplay(false));
    expect(registered(client)).toEqual([
      { paper_display_style: 'default', paper_export_style: 'linked' },
      { paper_display_style: 'diagram', paper_export_style: 'linked' },
      { paper_display_style: 'unsaved', paper_export_style: 'linked' },
      { paper_display_style: 'unsaved', paper_export_style: 'unsaved' },
    ]);
  });

  it('is inert when analytics never initialized', () => {
    act(() =>
      root.render(createElement(AnalyticsRuntimeProvider, { client: null, children: null }))
    );
    expect(() =>
      act(() => store().applyPaperPreset('display', builtInPaperPreset('diagram')))
    ).not.toThrow();
  });
});
