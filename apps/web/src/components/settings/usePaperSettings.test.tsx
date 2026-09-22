import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_PAPER_PRESETS, serializePaperStylePreset } from '../../lib/paper/paperPresets';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import type { FileService } from '../../platform/fileService';
import { useSettingsStore } from '../../store/settingsStore';
import { usePaperSettings, type PaperSettingsBinding } from './usePaperSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tracked: { event: string; properties?: Record<string, unknown> }[] = [];
vi.mock('../../analytics', () => ({
  ANALYTICS_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  track: (event: string, properties?: Record<string, unknown>) => {
    tracked.push(properties ? { event, properties } : { event });
  },
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const initialSettings = useSettingsStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const binding: { current: PaperSettingsBinding | null } = { current: null };

const openTextFile = vi.fn<FileService['openTextFile']>();
const saveTextFile = vi.fn<FileService['saveTextFile']>();
const fileService: FileService = {
  surface: 'web',
  supportsNativeDialogs: false,
  openTextFile,
  openBinaryFile: async () => null,
  saveTextFile,
  saveBinaryFile: async () => null,
};

function Probe(): null {
  const paper = usePaperSettings({ fileService });
  useEffect(() => {
    binding.current = paper;
  }, [paper]);
  return null;
}

function current(): PaperSettingsBinding {
  if (!binding.current) throw new Error('hook not mounted');
  return binding.current;
}

const stored = () => useSettingsStore.getState().paperStyle;
const userPreset = (name: string) => ({
  version: 1 as const,
  name,
  style: { ...DEFAULT_PAPER_STYLE, paper: { front: '#111111', back: '#222222' } },
});

beforeEach(() => {
  tracked.length = 0;
  toast.success.mockReset();
  toast.error.mockReset();
  openTextFile.mockReset();
  saveTextFile.mockReset();
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

describe('usePaperSettings', () => {
  it('opens on the display slot, editable, with the export slot following', () => {
    expect(current().slot).toBe('display');
    expect(current().editable).toBe(true);
    expect(current().exportFollowsDisplay).toBe(true);
    expect(current().style).toBe(DEFAULT_PAPER_STYLE);
  });

  it('shows the display style on the export slot while it follows, and refuses edits there', () => {
    act(() => current().setField('paper.front', '#abcdef'));
    act(() => current().setSlot('export'));
    expect(current().style.paper.front).toBe('#abcdef');
    expect(current().editable).toBe(false);

    act(() => current().setExportFollowsDisplay(false));
    expect(current().editable).toBe(true);
    expect(stored().export?.paper.front).toBe('#abcdef');

    act(() => current().setField('paper.front', '#fedcba'));
    expect(stored().export?.paper.front).toBe('#fedcba');
    expect(stored().display.paper.front).toBe('#abcdef');
    expect(tracked).toContainEqual({
      event: 'paperStyleChanged',
      properties: { slot: 'export', field: 'paper.front' },
    });
  });

  it('lists the built-ins first, then the saved presets in order', () => {
    act(() => {
      current().savePreset('Zed');
      current().savePreset('Alpha');
    });
    expect(current().presets.map((row) => row.builtIn ?? row.preset.name)).toEqual([
      ...BUILT_IN_PAPER_PRESETS.map((preset) => preset.id),
      'Zed',
      'Alpha',
    ]);
  });

  it('applies a preset to the slot and counts it by id, or as custom', () => {
    const oriedita = current().presets.find((row) => row.builtIn === 'oriedita')!;
    act(() => current().applyPreset(oriedita));
    expect(stored().display).toEqual(oriedita.preset.style);
    expect(tracked).toEqual([
      { event: 'paperPresetApplied', properties: { slot: 'display', preset: 'oriedita' } },
    ]);

    act(() => current().savePreset('Mine'));
    const mine = current().presets.find((row) => row.preset.name === 'Mine')!;
    act(() => current().applyPreset(mine));
    expect(tracked.at(-1)).toEqual({
      event: 'paperPresetApplied',
      properties: { slot: 'display', preset: 'custom' },
    });
  });

  it('saves the slot it is showing, and removes by name', () => {
    act(() => current().setExportFollowsDisplay(false));
    act(() => current().setSlot('export'));
    act(() => current().setField('paper.back', '#010203'));
    act(() => current().savePreset('Print'));
    expect(stored().presets).toEqual([
      { version: 1, name: 'Print', style: { ...DEFAULT_PAPER_STYLE, paper: { ...DEFAULT_PAPER_STYLE.paper, back: '#010203' } } },
    ]);
    act(() => current().removePreset('Print'));
    expect(stored().presets).toEqual([]);
  });

  it('counts a continuous adjustment once per field until it is settled', () => {
    act(() => {
      current().adjustField('paper.front', '#000001');
      current().adjustField('paper.front', '#000002');
      current().adjustField('paper.back', '#000003');
    });
    expect(tracked.map((entry) => entry.properties?.field)).toEqual(['paper.front', 'paper.back']);
    act(() => current().endAdjustment());
    act(() => current().adjustField('paper.front', '#000004'));
    expect(tracked).toHaveLength(3);
    expect(stored().display.paper).toEqual({ front: '#000004', back: '#000003' });
  });

  it('imports a preset file, adds it and applies it as custom', async () => {
    openTextFile.mockResolvedValue({
      text: serializePaperStylePreset(userPreset('Shared')),
      name: 'shared.json',
      path: null,
    });
    await act(() => current().importPreset());
    expect(openTextFile).toHaveBeenCalledWith(expect.objectContaining({ extensions: ['json'] }));
    expect(stored().presets.map((preset) => preset.name)).toEqual(['Shared']);
    expect(stored().display.paper).toEqual({ front: '#111111', back: '#222222' });
    expect(tracked).toEqual([
      { event: 'paperPresetApplied', properties: { slot: 'display', preset: 'custom' } },
    ]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says why a file did not import, and changes nothing', async () => {
    openTextFile.mockResolvedValueOnce({ text: '{not json', name: 'a.json', path: null });
    await act(() => current().importPreset());
    expect(toast.error).toHaveBeenCalledWith('That file is not JSON');

    openTextFile.mockResolvedValueOnce({ text: '{"name":"x"}', name: 'b.json', path: null });
    await act(() => current().importPreset());
    expect(toast.error).toHaveBeenLastCalledWith(
      'That file is not a paper style: it needs a name and a style'
    );

    openTextFile.mockResolvedValueOnce(null);
    await act(() => current().importPreset());
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(stored().presets).toEqual([]);
    expect(tracked).toEqual([]);
  });

  it('exports a preset as its own file, named after it', async () => {
    saveTextFile.mockResolvedValue({ name: 'origami-house.json', path: null });
    const row = current().presets.find((preset) => preset.builtIn === 'origami-house')!;
    await act(() => current().exportPreset(row));
    expect(saveTextFile).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: 'Origami-House.json',
        extensions: ['json'],
        contents: serializePaperStylePreset(row.preset),
      })
    );
    expect(toast.success).toHaveBeenCalledWith('Exported origami-house.json');
  });
});
