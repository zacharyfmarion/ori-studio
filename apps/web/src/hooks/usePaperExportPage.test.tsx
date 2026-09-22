import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PAPER_SHEET_MM_RANGE } from '../lib/paper/paperPage';
import { DEFAULT_PAPER_EXPORT_SETTINGS } from '../lib/paperExportSettings';
import { useSettingsStore } from '../store/settingsStore';
import {
  DEFAULT_PAPER_SHEET_MM,
  sheetMmOf,
  usePaperExportPage,
  type PaperExportPageBinding,
} from './usePaperExportPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialSettings = useSettingsStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const binding: { current: PaperExportPageBinding | null } = { current: null };

function Probe(): null {
  const page = usePaperExportPage();
  useEffect(() => {
    binding.current = page;
  }, [page]);
  return null;
}

function current(): PaperExportPageBinding {
  if (!binding.current) throw new Error('hook not mounted');
  return binding.current;
}

const stored = () => useSettingsStore.getState().paperExport;

beforeEach(() => {
  useSettingsStore.setState(initialSettings, true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Probe />));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  binding.current = null;
  useSettingsStore.setState(initialSettings, true);
});

describe('usePaperExportPage', () => {
  it('reads the export page', () => {
    expect(current().page).toEqual(DEFAULT_PAPER_EXPORT_SETTINGS);
  });

  it('writes the background, the hidden-faces switch and the density to the store', () => {
    act(() => current().setBackground('#ffffff'));
    expect(stored().background).toBe('#ffffff');
    act(() => current().setBackground(null));
    expect(stored().background).toBeNull();
    act(() => current().setKeepHiddenFaces(false));
    expect(stored().keepHiddenFaces).toBe(false);
    act(() => current().setPngDpi(300));
    expect(stored().pngDpi).toBe(300);
    act(() => current().setPaddingMm(2));
    expect(stored().paddingMm).toBe(2);
    // The binding follows the store, so a later read sees every write.
    expect(current().page).toEqual({
      ...DEFAULT_PAPER_EXPORT_SETTINGS,
      keepHiddenFaces: false,
      pngDpi: 300,
      paddingMm: 2,
    });
  });

  it('switches the sheet between as-shown and a size in mm, keeping the size across the switch', () => {
    act(() => current().setSheetAsShown(false));
    expect(stored().sheet).toEqual({ mm: DEFAULT_PAPER_SHEET_MM });
    act(() => current().setSheetMm(210));
    expect(stored().sheet).toEqual({ mm: 210 });
    act(() => current().setSheetAsShown(true));
    expect(stored().sheet).toBe('as-shown');
    // The field keeps showing the last size while the page is as shown.
    expect(sheetMmOf(stored().sheet)).toBe(DEFAULT_PAPER_SHEET_MM);
    expect(sheetMmOf({ mm: 210 })).toBe(210);
  });

  it('holds a sheet size to the range', () => {
    act(() => current().setSheetMm(1));
    expect(stored().sheet).toEqual({ mm: PAPER_SHEET_MM_RANGE.min });
    act(() => current().setSheetMm(99_999));
    expect(stored().sheet).toEqual({ mm: PAPER_SHEET_MM_RANGE.max });
  });
});
