import { describe, expect, it, vi } from 'vitest';
import { builtInPaperPreset } from '../lib/paper/paperPresets';
import type { PaperScene } from '../lib/paper/paperScene';
import { DEFAULT_PAPER_PAGE } from '../lib/paper/paperPage';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../lib/paper/paperStyle';
import { paperSceneToSvg } from '../lib/paper/paperSvg';
import { DEFAULT_PAPER_EXPORT_SETTINGS } from '../lib/paperExportSettings';
import { paperPresetRows } from '../lib/paperPresetRows';
import {
  createPaperExportSession,
  paperExportKeepsHiddenFaces,
  paperExportPage,
  paperExportSceneInput,
  paperExportStyle,
  paperSceneHiddenFaces,
  paperScenesOnOneCrop,
  resolvePaperExportStyleChoice,
} from './paperExportSession';

const MINE = { version: 1 as const, name: 'Mine', style: { ...DEFAULT_PAPER_STYLE, erode: 0.01 } };
const ROWS = paperPresetRows([MINE]);
const EXPORT_STYLE: PaperStyle = { ...DEFAULT_PAPER_STYLE, paper: { front: '#123456', back: '#654321' } };

const SCENE: PaperScene = {
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  sheet: 10,
  items: [
    { kind: 'face', face: 0, side: 'front', rings: [[[0, 0], [10, 0], [10, 10]]], shade: 1, hidden: false },
    { kind: 'face', face: 1, side: 'back', rings: [[[0, 0], [10, 0], [10, 10]]], shade: 1, hidden: true },
    { kind: 'face', face: 2, side: 'back', rings: [[[0, 0], [10, 0], [10, 10]]], shade: 1, hidden: true },
  ],
};

describe('resolvePaperExportStyleChoice', () => {
  it('keeps the export slot and any preset that still exists', () => {
    expect(resolvePaperExportStyleChoice('export-style', ROWS)).toBe('export-style');
    expect(resolvePaperExportStyleChoice('builtin:diagram', ROWS)).toBe('builtin:diagram');
    expect(resolvePaperExportStyleChoice('user:Mine', ROWS)).toBe('user:Mine');
  });

  it('reads a preset that is gone — deleted, or renamed — as the export slot', () => {
    expect(resolvePaperExportStyleChoice('user:Gone', ROWS)).toBe('export-style');
  });
});

describe('paperExportStyle', () => {
  it('is the target’s export style for the slot', () => {
    expect(paperExportStyle({ exportStyle: EXPORT_STYLE, pins: null }, 'export-style', ROWS)).toBe(
      EXPORT_STYLE
    );
  });

  it('is the preset, with the object’s own pins still on top', () => {
    const style = paperExportStyle(
      { exportStyle: EXPORT_STYLE, pins: { 'paper.front': '#ff0000' } },
      'builtin:diagram',
      ROWS
    );
    const diagram = builtInPaperPreset('diagram').style;
    expect(style.paper.front).toBe('#ff0000');
    expect(style.paper.back).toBe(diagram.paper.back);
    expect(style.edges).toEqual(diagram.edges);
  });

  it('falls back to the export style for a preset that is gone', () => {
    expect(paperExportStyle({ exportStyle: EXPORT_STYLE, pins: null }, 'user:Gone', ROWS)).toBe(
      EXPORT_STYLE
    );
  });
});

describe('hidden faces', () => {
  it('drops them only from an SVG of a surface that can bury any, when asked', () => {
    const drop = { ...DEFAULT_PAPER_EXPORT_SETTINGS, keepHiddenFaces: false };
    expect(paperExportKeepsHiddenFaces({ buriesFaces: true }, { ...drop, format: 'svg' })).toBe(false);
    // A PNG has no faces to delete; a References step has nothing buried.
    expect(paperExportKeepsHiddenFaces({ buriesFaces: true }, { ...drop, format: 'png' })).toBe(true);
    expect(paperExportKeepsHiddenFaces({ buriesFaces: false }, { ...drop, format: 'svg' })).toBe(true);
  });

  it('asks the producer for the hidden test only when the page drops them', () => {
    const drop = { ...DEFAULT_PAPER_EXPORT_SETTINGS, keepHiddenFaces: false };
    expect(paperExportSceneInput({ buriesFaces: true }, EXPORT_STYLE, drop).markHidden).toBe(true);
    expect(
      paperExportSceneInput({ buriesFaces: true }, EXPORT_STYLE, DEFAULT_PAPER_EXPORT_SETTINGS).markHidden
    ).toBe(false);
    expect(paperExportPage({ buriesFaces: true }, { ...drop, format: 'png' }).keepHiddenFaces).toBe(true);
  });

  it('counts the faces a scene marks hidden', () => {
    expect(paperSceneHiddenFaces(SCENE)).toBe(2);
  });
});

describe('paperExportSceneInput', () => {
  it('hands the target the marks the options carry', () => {
    const marks = { letters: false, highlights: true };
    const options = { ...DEFAULT_PAPER_EXPORT_SETTINGS, marks };
    expect(paperExportSceneInput({ buriesFaces: false }, EXPORT_STYLE, options, 2)).toEqual({
      page: 2,
      style: EXPORT_STYLE,
      markHidden: false,
      background: null,
      marks,
    });
  });

  it('carries every mark for options without any', () => {
    const { format, keepHiddenFaces, background } = DEFAULT_PAPER_EXPORT_SETTINGS;
    const input = paperExportSceneInput({ buriesFaces: false }, EXPORT_STYLE, {
      format,
      keepHiddenFaces,
      background,
    });
    expect(input.marks).toEqual({ letters: true, highlights: true });
  });
});

describe('paperScenesOnOneCrop', () => {
  it('crops every scene to the union of their bounds, so each page is the same size', () => {
    const left = { ...SCENE, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 } };
    const right = { ...SCENE, bounds: { minX: 40, minY: -10, maxX: 160, maxY: 30 } };
    const cropped = paperScenesOnOneCrop([left, right]);
    expect(cropped.map((scene) => scene.bounds)).toEqual([
      { minX: 0, minY: -10, maxX: 160, maxY: 50 },
      { minX: 0, minY: -10, maxX: 160, maxY: 50 },
    ]);
    const pages = cropped.map((scene) => paperSceneToSvg(scene, EXPORT_STYLE, DEFAULT_PAPER_PAGE));
    expect(pages[1]!.widthPt).toBe(pages[0]!.widthPt);
    expect(pages[1]!.heightPt).toBe(pages[0]!.heightPt);
    // A single page keeps its own crop.
    expect(paperScenesOnOneCrop([right])[0]!.bounds).toEqual(right.bounds);
  });
});

describe('createPaperExportSession', () => {
  const input = (background: string | null) => ({
    page: 0,
    style: EXPORT_STYLE,
    markHidden: false,
    background,
  });

  it('builds a scene once per key, and again only when the key changes', async () => {
    const buildScene = vi.fn(async () => SCENE);
    const session = createPaperExportSession({ sceneKey: (value) => value.background ?? '', buildScene });
    await session.scene(input(null));
    await session.scene(input(null));
    expect(buildScene).toHaveBeenCalledTimes(1);
    await session.scene(input('#000000'));
    expect(buildScene).toHaveBeenCalledTimes(2);
  });

  it('forgets a failed build, so the next ask tries again', async () => {
    const buildScene = vi
      .fn<() => Promise<PaperScene | null>>()
      .mockRejectedValueOnce(new Error('worker gone'))
      .mockResolvedValueOnce(SCENE);
    const session = createPaperExportSession({ sceneKey: () => 'one', buildScene });
    await expect(session.scene(input(null))).rejects.toThrow('worker gone');
    await expect(session.scene(input(null))).resolves.toBe(SCENE);
  });

  it('keeps only the most recently used scenes', async () => {
    const buildScene = vi.fn(async () => SCENE);
    const session = createPaperExportSession(
      { sceneKey: (value) => value.background ?? '', buildScene },
      2
    );
    await session.scene(input('#000001'));
    await session.scene(input('#000002'));
    // Asked for again, the first is now the most recent; the second goes next.
    await session.scene(input('#000001'));
    await session.scene(input('#000003'));
    expect(buildScene).toHaveBeenCalledTimes(3);
    await session.scene(input('#000001'));
    expect(buildScene).toHaveBeenCalledTimes(3);
    await session.scene(input('#000002'));
    expect(buildScene).toHaveBeenCalledTimes(4);
  });
});
