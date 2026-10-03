import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PickedFile } from '../../platform/fileService';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { stepAsset } from '../document/diagramDocument';
import { addStepPictures } from './addStepPictures';
import { browserSanitizeEnv } from './svgSanitize';

const analytics = vi.hoisted(() => ({
  trackDiagramPictureUploaded: vi.fn(),
  trackDiagramStepAdded: vi.fn(),
}));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));
const toasts = vi.hoisted(() => ({ error: vi.fn(), loading: vi.fn(() => 'progress'), dismiss: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();

beforeEach(() => {
  useWorkspaceStore.setState(initialState, true);
  vi.clearAllMocks();
});

function svgFile(name: string, side = 10): PickedFile {
  const bytes = new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}"/>`
  );
  return { name, type: 'image/svg+xml', size: bytes.length, read: async () => bytes };
}

function textFile(name: string, text: string): PickedFile {
  const bytes = new TextEncoder().encode(text);
  return { name, type: '', size: bytes.length, read: async () => bytes };
}

function sequentialIds() {
  let next = 0;
  return (prefix: string) => `${prefix}-${++next}`;
}

const dependencies = () => ({
  encodeRaster: vi.fn(async () => ({ src: 'data:image/png;base64,AAAA', width: 4, height: 2 })),
  env: browserSanitizeEnv(),
});

const stepSides = () =>
  state().diagram!.steps.map((step) => stepAsset(state().diagram!, step)?.widthPx ?? null);

describe('addStepPictures', () => {
  it('adds a batch in natural name order, as one undo step, and counts each step', async () => {
    const result = await addStepPictures(
      [svgFile('step-10.svg', 10), svgFile('step-2.svg', 2), svgFile('step-1.svg', 1)],
      { via: 'pick', dependencies: dependencies(), newId: sequentialIds() }
    );

    expect(result?.failures).toEqual([]);
    expect(stepSides()).toEqual([1, 2, 10]);
    expect(state().diagramHistory.past).toHaveLength(1);
    expect(analytics.trackDiagramStepAdded).toHaveBeenCalledTimes(3);
    expect(analytics.trackDiagramStepAdded).toHaveBeenCalledWith('svg', 'batch');
    expect(analytics.trackDiagramPictureUploaded).toHaveBeenCalledWith('svg', 'ok', expect.any(Number), 3);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('names the files it could not add in one toast, and adds the rest', async () => {
    const result = await addStepPictures(
      [svgFile('a.svg'), textFile('notes.txt', 'hello'), textFile('broken.svg', '<html/>')],
      { via: 'drop', dependencies: dependencies(), newId: sequentialIds() }
    );

    expect(result?.failures).toEqual([
      { name: 'broken.svg', reason: 'rejected' },
      { name: 'notes.txt', reason: 'unsupported' },
    ]);
    expect(stepSides()).toEqual([10]);
    expect(analytics.trackDiagramStepAdded).toHaveBeenCalledWith('svg', 'drop');
    expect(analytics.trackDiagramPictureUploaded).toHaveBeenCalledWith('other', 'unsupported', 5, 3);
    expect(toasts.error).toHaveBeenCalledOnce();
    const [title, options] = toasts.error.mock.calls[0] as unknown as [string, { description: string }];
    expect(title).toBe('2 pictures couldn’t be added');
    expect(options.description).toContain('broken.svg');
    expect(options.description).toContain('notes.txt');
  });

  it('fills the selected empty step with one picture, which adds no step', async () => {
    const stepId = state().addDiagramStep()!;
    await addStepPictures([svgFile('a.svg')], { via: 'pick', dependencies: dependencies() });
    expect(state().diagram?.steps.map((step) => step.id)).toEqual([stepId]);
    expect(stepSides()).toEqual([10]);
    expect(analytics.trackDiagramStepAdded).not.toHaveBeenCalled();
    expect(analytics.trackDiagramPictureUploaded).toHaveBeenCalledOnce();
  });

  it('replaces one step’s picture with the first file', async () => {
    const stepId = state().addDiagramStep()!;
    state().selectDiagramStep(null);
    const result = await addStepPictures([svgFile('b.svg', 7), svgFile('c.svg', 8)], {
      via: 'pick',
      replaceStepId: stepId,
      dependencies: dependencies(),
    });
    expect(result?.stepIds).toEqual([stepId]);
    expect(stepSides()).toEqual([7]);
    expect(analytics.trackDiagramPictureUploaded).toHaveBeenCalledOnce();
  });

  it('drops what it read when the project is replaced while it reads', async () => {
    state().addDiagramStep();
    const slow: PickedFile = {
      ...svgFile('slow.svg'),
      read: async () => {
        // A project opened while the file was being read.
        state().installDiagram(null);
        return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="3"/>');
      },
    };
    expect(await addStepPictures([slow], { via: 'pick', dependencies: dependencies() })).toBeNull();
    expect(state().diagram).toBeNull();
  });

  it('does nothing to a read-only diagram', async () => {
    useWorkspaceStore.setState({ diagramReadOnly: true });
    expect(await addStepPictures([svgFile('a.svg')], { via: 'pick', dependencies: dependencies() })).toBeNull();
    expect(analytics.trackDiagramPictureUploaded).not.toHaveBeenCalled();
  });

  it('records what sanitizing changed, for the Step pane', async () => {
    const flowed = textFile(
      'flowed.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><flowRoot><flowPara>Hi</flowPara></flowRoot></svg>'
    );
    await addStepPictures([flowed], { via: 'pick', dependencies: dependencies(), newId: sequentialIds() });
    expect(state().diagramPictureNotices).toEqual({ 'asset-1': ['flowed-text'] });
    expect(analytics.trackDiagramPictureUploaded).toHaveBeenCalledWith('svg', 'flattened', expect.any(Number), 1);
  });
});
