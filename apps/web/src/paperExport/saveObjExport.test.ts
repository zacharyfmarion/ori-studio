import { strFromU8, unzipSync } from 'fflate';
import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveBinaryFileOptions } from '../platform/fileService';
import type { PaperExportTarget, PaperObjExport } from './paperExportTarget';
import { paperObjExportPlan, paperObjExportUnavailable, savePaperObjExport } from './saveObjExport';

const service = vi.hoisted(() => ({
  saveTextFile: vi.fn(async () => ({ name: 'Crane step 2.obj', path: null })),
  saveBinaryFile: vi.fn(async (_options: SaveBinaryFileOptions) => ({ name: 'Crane steps.zip', path: null })),
}));
vi.mock('../platform/fileService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/fileService')>()),
  getFileService: () => service,
}));

const t = ((_key: string, english: string, values?: Record<string, unknown>) =>
  english.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))) as unknown as TFunction;

const mesh = (contents: string): PaperObjExport => ({ unavailableReason: null, build: vi.fn(async () => contents) });
const AFFINE: PaperObjExport = { unavailableReason: 'picture-only-spread', build: vi.fn(async () => null) };

function steps(objs: (PaperObjExport | undefined)[]): Pick<PaperExportTarget, 'obj' | 'fileStem' | 'pages'> {
  return {
    obj: objs[1],
    fileStem: 'Crane step 2',
    pages: {
      list: objs.map((obj, index) => ({
        label: `Step ${index + 1}`,
        fileStem: `${index + 1} step ${index + 1}`,
        ...(obj ? { obj } : {}),
      })),
      current: 1,
      title: 'Export all steps',
      zipStem: 'Crane steps',
    },
  };
}

beforeEach(() => {
  service.saveTextFile.mockClear();
  service.saveBinaryFile.mockClear();
});

describe('paperObjExportPlan', () => {
  it('writes the page on show’s mesh for one step, and every page’s for all of them', () => {
    const objs = [mesh('a'), mesh('b'), mesh('c')];
    const target = steps(objs);
    expect(paperObjExportPlan(target, false)).toEqual({ kind: 'one', obj: objs[1], fileStem: 'Crane step 2' });
    expect(paperObjExportPlan(target, true)).toEqual({
      kind: 'all',
      pages: objs.map((obj, index) => ({ obj, fileStem: `${index + 1} step ${index + 1}`, label: `Step ${index + 1}` })),
      zipStem: 'Crane steps',
    });
  });

  it('has nothing to write for a target with no mesh, or a set with a page that has none', () => {
    expect(paperObjExportPlan({ fileStem: 'Crane', pages: null }, false)).toBeNull();
    expect(paperObjExportPlan(steps([mesh('a'), mesh('b'), undefined]), true)).toBeNull();
    // One picture, no pages: its own mesh, whatever the scope.
    const only = mesh('a');
    expect(paperObjExportPlan({ obj: only, fileStem: 'Crane', pages: null }, true)).toEqual({
      kind: 'one',
      obj: only,
      fileStem: 'Crane',
    });
  });
});

describe('paperObjExportUnavailable', () => {
  it('says why one mesh cannot be written, and names the step that stands in the way of the set', () => {
    const target = steps([mesh('a'), AFFINE, mesh('c')]);
    const reason = 'An Affine or Depth spread only moves the picture, so a 3D mesh can’t carry it. Set Spread by to Default to lift the layers apart.';
    expect(paperObjExportUnavailable(paperObjExportPlan(target, false)!, t)).toBe(reason);
    expect(paperObjExportUnavailable(paperObjExportPlan(target, true)!, t)).toBe(`Step 2: ${reason}`);
    expect(paperObjExportUnavailable(paperObjExportPlan(steps([mesh('a'), mesh('b')]), true)!, t)).toBeNull();
  });
});

describe('savePaperObjExport', () => {
  it('writes every step’s mesh into one ZIP, in order, deflated, saved once', async () => {
    const objs = [mesh('o step 1'), mesh('o step 2'), mesh('o step 3')];
    const progress = vi.fn();
    await expect(savePaperObjExport(paperObjExportPlan(steps(objs), true)!, t, undefined, progress)).resolves.toBe(
      'Crane steps.zip'
    );
    expect(service.saveTextFile).not.toHaveBeenCalled();
    expect(service.saveBinaryFile).toHaveBeenCalledOnce();
    const options = service.saveBinaryFile.mock.calls[0]![0];
    expect(options).toMatchObject({ suggestedName: 'Crane-steps.zip', extensions: ['zip'], mimeType: 'application/zip' });
    const compression: Record<string, number> = {};
    const files = unzipSync(options.bytes, {
      filter: (file) => {
        compression[file.name] = file.compression;
        return true;
      },
    });
    const names = ['1-step-1.obj', '2-step-2.obj', '3-step-3.obj'];
    expect(Object.keys(files)).toEqual(names);
    expect(names.map((name) => strFromU8(files[name]!))).toEqual(['o step 1', 'o step 2', 'o step 3']);
    expect(names.map((name) => compression[name])).toEqual([8, 8, 8]);
    expect(progress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('writes the step on show as one OBJ', async () => {
    const objs = [mesh('o step 1'), mesh('o step 2')];
    await expect(savePaperObjExport(paperObjExportPlan(steps(objs), false)!, t)).resolves.toBe('Crane step 2.obj');
    expect(service.saveTextFile).toHaveBeenCalledWith(
      expect.objectContaining({ contents: 'o step 2', suggestedName: 'Crane-step-2.obj', extensions: ['obj'] })
    );
    expect(objs[0]!.build).not.toHaveBeenCalled();
  });

  it('builds nothing for a set a step stands in the way of', async () => {
    const objs = [mesh('o step 1'), AFFINE];
    await expect(savePaperObjExport(paperObjExportPlan(steps(objs), true)!, t)).rejects.toThrow(/^Step 2: An Affine/);
    expect(objs[0]!.build).not.toHaveBeenCalled();
    expect(service.saveBinaryFile).not.toHaveBeenCalled();
  });

  it('offers no save once the dialog has gone, and refuses a mesh that expired', async () => {
    const controller = new AbortController();
    const first: PaperObjExport = {
      unavailableReason: null,
      build: vi.fn(async () => {
        controller.abort();
        return 'o step 1';
      }),
    };
    const rest = mesh('o step 2');
    await expect(
      savePaperObjExport(paperObjExportPlan(steps([first, rest]), true)!, t, controller.signal)
    ).resolves.toBeNull();
    expect(rest.build).not.toHaveBeenCalled();
    expect(service.saveBinaryFile).not.toHaveBeenCalled();

    const expired: PaperObjExport = { unavailableReason: null, build: async () => null };
    await expect(savePaperObjExport(paperObjExportPlan(steps([expired, mesh('b')]), true)!, t)).rejects.toThrow(
      'no longer available'
    );
  });
});
