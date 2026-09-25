import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreaseExportPaperOptions } from '../lib/creaseExport';
import { builtInPaperPreset } from '../lib/paper/paperPresets';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../lib/paper/paperStyle';
import { PAPER_EXPORT_STYLE_SLOT, type PaperExportStyleChoice } from '../lib/paperExportSettings';
import { DEFAULT_PAPER_STYLE_SETTINGS, type PaperStyleSettings } from '../lib/paperStyleSettings';
import { useSettingsStore } from '../store/settingsStore';
import {
  creaseExportFigureColours,
  creaseExportFigureStyle,
  openingCreaseExportFigure,
  useCreaseExportPaper,
} from './useCreaseExportPaper';

const DIAGRAM = builtInPaperPreset('diagram').style;
const EXPORT_SLOT: PaperStyle = { ...DEFAULT_PAPER_STYLE, paper: { front: '#123456', back: '#654321' } };
const RED: PaperStyle = { ...DEFAULT_PAPER_STYLE, paper: { front: '#ff0000', back: '#00ff00' } };
const MINE = { version: 1 as const, name: 'Mine', style: RED };
const SETTINGS: PaperStyleSettings = { ...DEFAULT_PAPER_STYLE_SETTINGS, export: EXPORT_SLOT, presets: [MINE] };

const initialSettingsState = useSettingsStore.getInitialState();
const unmounts: Array<() => void> = [];

/** Mount the hook and hand back a reader for what it last returned. */
function renderPaper(choice: PaperExportStyleChoice): () => CreaseExportPaperOptions {
  let latest: CreaseExportPaperOptions | null = null;
  function Probe() {
    latest = useCreaseExportPaper(choice);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Probe)));
  unmounts.push(() => act(() => root.unmount()));
  return () => latest!;
}

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  useSettingsStore.setState(initialSettingsState, true);
});

describe('creaseExportFigureStyle', () => {
  it('draws the export slot in the slot’s own style once it is set apart', () => {
    expect(creaseExportFigureStyle(SETTINGS, PAPER_EXPORT_STYLE_SLOT)).toEqual(EXPORT_SLOT);
  });

  it('draws the export slot in display’s style while it follows display', () => {
    const following = { ...DEFAULT_PAPER_STYLE_SETTINGS, display: DIAGRAM, export: null };
    expect(creaseExportFigureStyle(following, PAPER_EXPORT_STYLE_SLOT)).toEqual(DIAGRAM);
  });

  it('draws a built-in preset in its style, not the slot’s', () => {
    expect(creaseExportFigureStyle(SETTINGS, 'builtin:diagram')).toEqual(DIAGRAM);
  });

  it('draws a saved preset in its style', () => {
    expect(creaseExportFigureStyle(SETTINGS, 'user:Mine')).toEqual(RED);
  });

  it('falls back to the export slot for a preset that is gone', () => {
    expect(creaseExportFigureStyle(SETTINGS, 'user:Gone')).toEqual(EXPORT_SLOT);
  });
});

describe('creaseExportFigureColours', () => {
  it('seeds Front and Back from the style’s paper', () => {
    expect(creaseExportFigureColours(DIAGRAM)).toEqual({ frontColor: '#ffffff', backColor: '#b3b3b3' });
  });
});

describe('openingCreaseExportFigure', () => {
  it('opens on the remembered pick, with its paper colours', () => {
    useSettingsStore.setState({ paperStyle: SETTINGS, creasePatternFoldedFigureStyle: 'user:Mine' });
    expect(openingCreaseExportFigure()).toEqual({
      style: 'user:Mine',
      colours: { frontColor: '#ff0000', backColor: '#00ff00' },
    });
  });

  it('opens on the export slot when the remembered preset is gone', () => {
    useSettingsStore.setState({ paperStyle: SETTINGS, creasePatternFoldedFigureStyle: 'user:Gone' });
    expect(openingCreaseExportFigure()).toEqual({
      style: PAPER_EXPORT_STYLE_SLOT,
      colours: { frontColor: '#123456', backColor: '#654321' },
    });
  });
});

describe('useCreaseExportPaper', () => {
  it('hands the painter the picked style and nothing else', () => {
    useSettingsStore.setState({ paperStyle: SETTINGS });
    const paper = renderPaper('builtin:diagram');
    expect(paper()).toEqual({ style: DIAGRAM });
  });

  it('follows the export slot as Settings changes it', () => {
    useSettingsStore.setState({ paperStyle: SETTINGS });
    const paper = renderPaper(PAPER_EXPORT_STYLE_SLOT);
    expect(paper().style).toEqual(EXPORT_SLOT);
    act(() => {
      useSettingsStore.setState({ paperStyle: { ...SETTINGS, export: RED } });
    });
    expect(paper().style).toEqual(RED);
  });
});
