// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { createStep } from '../document/diagramDocument';
import type { PickedFile } from '../../platform/fileService';
import type { ImportTarget } from '../../store/workspaceStore/diagramBatchImport';
import { runImportJob } from './importJob';
import { useImportDialogStore } from './importDialogStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), close: vi.fn(), commit: vi.fn() }));
vi.mock('./prepareCp', () => ({
  CpImportPreparer: class {
    prepare = mocks.prepare;
    close = mocks.close;
  },
}));
vi.mock('../../store/workspaceStore/diagramBatchImport', () => ({
  commitDiagramImport: mocks.commit,
  importTarget: () => ({}),
}));
vi.mock('../../analytics', () => ({
  track: vi.fn(),
  trackDiagramPictureUploaded: vi.fn(),
  bucketCount: () => '1-10',
  COUNT_BUCKETS: [],
}));
const pictures = vi.hoisted(() => ({ importStepPicture: vi.fn() }));
vi.mock('../upload/importStepPicture', async (original) => ({
  ...(await original<typeof import('../upload/importStepPicture')>()),
  importStepPicture: pictures.importStepPicture,
}));
const target = { diagram: null, cpLoadSerial: 1 } as ImportTarget;
const options = { columns: 0, gap: 100, foldTimeoutMs: 5000 };
const file = (name: string, content = name): PickedFile => ({
  name,
  type: '',
  size: content.length,
  read: vi.fn(async () => new TextEncoder().encode(content)),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.close.mockResolvedValue(undefined);
  mocks.prepare.mockImplementation(async () => ({
    geometry: { segEndpoints: new Float64Array() },
    steps: [createStep()],
    assets: [],
    notices: [],
  }));
  mocks.commit.mockImplementation(async (groups) =>
    groups.reduce((count: number, g: { steps: unknown[] }) => count + g.steps.length, 0),
  );
});
it('prepares duplicate CP contents once but publishes distinct ordered steps in one batch', async () => {
  const result = await runImportJob(
    [file('2.cp', 'same'), file('3.cp', 'same')],
    target,
    options,
    new AbortController().signal,
    new AbortController().signal,
    () => {},
  );
  expect(result.added).toBe(2);
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.commit).toHaveBeenCalledTimes(1);
  const groups = mocks.commit.mock.calls[0]![0];
  expect(groups[0].steps[0].id).not.toBe(groups[1].steps[0].id);
  expect(mocks.close).toHaveBeenCalledOnce();
});
it('reports malformed files and imports the remaining files', async () => {
  mocks.prepare.mockRejectedValueOnce(new Error('Malformed CP'));
  const result = await runImportJob(
    [file('bad.cp'), file('good.cp')],
    target,
    options,
    new AbortController().signal,
    new AbortController().signal,
    () => {},
  );
  expect(result.added).toBe(1);
  expect(result.failures).toEqual([{ name: 'bad.cp', message: 'Malformed CP' }]);
});
it('cancelling after preparation publishes neither workspace', async () => {
  const controller = new AbortController();
  mocks.prepare.mockImplementation(async () => {
    controller.abort();
    return { geometry: { segEndpoints: new Float64Array() }, steps: [createStep()], assets: [], notices: [] };
  });
  await expect(
    runImportJob([file('2.cp')], target, options, controller.signal, new AbortController().signal, () => {}),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
});
it('Finish now leaves folding cancelled while continuing to stage every CP', async () => {
  const folds = new AbortController();
  folds.abort();
  mocks.prepare.mockImplementation(async (_text, _name, _style, signal, foldSignal) => {
    expect(signal.aborted).toBe(false);
    expect(foldSignal.aborted).toBe(true);
    return {
      geometry: { segEndpoints: new Float64Array() },
      steps: [{ ...createStep(), importStatus: 'pending' }],
      assets: [],
      notices: [],
    };
  });
  const result = await runImportJob(
    [file('2.cp'), file('3.cp')],
    target,
    options,
    new AbortController().signal,
    folds.signal,
    () => {},
  );
  expect(result.added).toBe(2);
  expect(mocks.prepare).toHaveBeenCalledTimes(2);
});

it('imports any picture the uploader takes, as an upload, and records what sanitizing changed', async () => {
  const notices = [{ kind: 'removed-external' }];
  pictures.importStepPicture
    .mockResolvedValueOnce({
      ok: true,
      content: { kind: 'raster', src: 'data:image/png;base64,AA', widthPx: 4, heightPx: 4 },
      bytes: 10,
      format: 'png',
      fileBytes: 10,
      notices: [],
    })
    .mockResolvedValueOnce({
      ok: true,
      content: { kind: 'svg', svg: '<svg/>', widthPx: 4, heightPx: 4 },
      bytes: 6,
      format: 'svg',
      fileBytes: 6,
      notices,
    })
    .mockResolvedValueOnce({ ok: false, format: 'jpeg', fileBytes: 3, reason: 'unreadable' });
  const noteDiagramPictureChanges = vi.fn();
  useWorkspaceStore.setState({ noteDiagramPictureChanges });
  const result = await runImportJob(
    [file('1.png'), file('2.svg'), file('3.jpg')],
    target,
    options,
    new AbortController().signal,
    new AbortController().signal,
    () => {},
  );
  const groups = mocks.commit.mock.calls[0]![0];
  expect(groups[0].assets[0]).toMatchObject({ kind: 'raster', widthPx: 4 });
  expect(groups[0].steps[0].picture.key).toBe(`asset:${groups[0].assets[0].id}`);
  expect(noteDiagramPictureChanges).toHaveBeenCalledWith(groups[1].assets[0].id, notices);
  expect(result.failures).toEqual([{ name: '3.jpg', message: 'the picture could not be read' }]);
});
it('lists only what an import takes when a drop opens the dialog', () => {
  useImportDialogStore.getState().open([file('a.cp'), file('notes.txt'), file('b.png')]);
  expect(useImportDialogStore.getState().files.map((f) => f.name)).toEqual(['a.cp', 'b.png']);
  useImportDialogStore.getState().close();
});
