import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFoldedModelWriteQueueForTests } from '../../cp-workspace/folded/foldedModelWriteQueue';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
} from '../../engine/oristudioCpTypes';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { useSettingsStore } from '../settingsStore';
import { foldedFigureModelMirror, installFoldedFigurePaperMirror } from './foldedFigurePaperMirror';
import { useWorkspaceStore } from './store';

/**
 * The kernel model's colours are a mirror of the figure's effective paper
 * style: the display style with its own pins on top. The mirror writes what
 * differs, as a `mirror` write, for figures that have a kernel to write to.
 */

const MODEL: OristudioCpFoldedFigureModel = {
  front_color: { red: 255, green: 255, blue: 50 },
  back_color: { red: 233, green: 233, blue: 233 },
  line_color: { red: 0, green: 0, blue: 0 },
  scale: 1,
  rotation: 0,
  anti_alias: true,
  display_shadows: false,
  state: 'Front0',
  folded_cases: 1,
  transparent_transparency: 16,
  transparency_color: false,
};

function flat(overrides: Partial<OristudioCpFoldedFigureEntry> = {}): OristudioCpFoldedFigureEntry {
  return {
    id: 'flat-1',
    title: 'Folded model 1',
    handle: 7,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: { model: MODEL } as OristudioCpFoldedFigureEntry['snapshot'],
    renderSnapshot: null,
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    error: null,
    ...overrides,
  };
}

function spatial(overrides: Partial<OristudioCpFoldedFigureEntry> = {}): OristudioCpFoldedFigureEntry {
  return flat({
    id: 'spatial-1',
    handle: 8,
    sourceKind: 'generated-3d',
    snapshot: null,
    folded3d: { model: MODEL } as NonNullable<OristudioCpFoldedFigureEntry['folded3d']>,
    ...overrides,
  });
}

const RED = { red: 255, green: 0, blue: 0 };

describe('foldedFigureModelMirror', () => {
  it('is null while the model already shows the effective style', () => {
    expect(foldedFigureModelMirror(flat(), DEFAULT_PAPER_STYLE)).toBeNull();
    expect(foldedFigureModelMirror(spatial(), DEFAULT_PAPER_STYLE)).toBeNull();
  });

  it('patches only the colours that differ, from the display style', () => {
    const display = { ...DEFAULT_PAPER_STYLE, paper: { front: '#ff0000', back: '#e9e9e9' } };
    expect(foldedFigureModelMirror(flat(), display)).toEqual({ front_color: RED });
    expect(foldedFigureModelMirror(spatial(), display)).toEqual({ front_color: RED });
  });

  it('lets a figure’s own pin win over the display style, edge pen included', () => {
    const display = { ...DEFAULT_PAPER_STYLE, paper: { front: '#ff0000', back: '#e9e9e9' } };
    const pinned = flat({
      appearance: {
        'paper.front': '#ffff32',
        edges: { ...DEFAULT_PAPER_STYLE.edges, color: '#0000ff' },
      },
    });
    expect(foldedFigureModelMirror(pinned, display)).toEqual({
      line_color: { red: 0, green: 0, blue: 255 },
    });
  });

  it('has nothing to mirror for a figure saved mid-fold', () => {
    expect(
      foldedFigureModelMirror(flat({ snapshot: null }), {
        ...DEFAULT_PAPER_STYLE,
        paper: { front: '#ff0000', back: '#e9e9e9' },
      })
    ).toBeNull();
  });
});

describe('installFoldedFigurePaperMirror', () => {
  const initialSettings = useSettingsStore.getInitialState();
  const initialWorkspace = useWorkspaceStore.getInitialState();
  let update: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetFoldedModelWriteQueueForTests();
    useSettingsStore.setState(initialSettings, true);
    update = vi.fn(
      (id: string, patch: Partial<OristudioCpFoldedFigureModel>, options?: { mirror?: boolean }) => {
        // Land the patch on the figure the way the store's action does once the
        // kernel answers, so the fixed point is reachable.
        useWorkspaceStore.setState({
          oristudioCpFoldedFigures: useWorkspaceStore.getState().oristudioCpFoldedFigures.map(
            (figure) =>
              figure.id !== id
                ? figure
                : figure.folded3d
                  ? { ...figure, folded3d: { ...figure.folded3d, model: { ...figure.folded3d.model, ...patch } } }
                  : {
                      ...figure,
                      snapshot: {
                        ...figure.snapshot!,
                        model: { ...figure.snapshot!.model, ...patch },
                      },
                    }
          ),
        });
        void options;
        return Promise.resolve(true);
      }
    );
    // The mirror under test is the one the store installs at module load; a
    // second would ask once more for every write, with bookkeeping of its own.
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [flat(), spatial(), flat({ id: 'reopened', handle: null })],
      updateOristudioCpFoldedFigureModel: update as never,
    });
    update.mockClear();
  });

  afterEach(() => {
    resetFoldedModelWriteQueueForTests();
    useWorkspaceStore.setState(initialWorkspace, true);
    useSettingsStore.setState(initialSettings, true);
  });

  const written = () =>
    update.mock.calls.map(([id, patch, options]) => ({ id, patch, options }));

  it('writes nothing while every figure already agrees with the style', () => {
    expect(update).not.toHaveBeenCalled();
  });

  it('carries a display-style change into every figure with a kernel, as a mirror write', async () => {
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#ff0000');
    await Promise.resolve();
    // Both kinds, once each; the reopened figure has no handle and is left as
    // saved until a rehydrate gives it one.
    expect(written().map((call) => call.id).sort()).toEqual(['flat-1', 'spatial-1']);
    for (const call of written()) {
      expect(call.patch).toEqual({ front_color: RED });
      expect(call.options).toEqual({ mirror: true });
    }
    const figures = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    expect(figures[0]?.snapshot?.model.front_color).toEqual(RED);
    expect(figures[1]?.folded3d?.model.front_color).toEqual(RED);
    expect(figures[2]?.snapshot?.model.front_color).toEqual(MODEL.front_color);
  });

  it('carries a figure’s own pin into its model, and its reset back out', async () => {
    const store = useWorkspaceStore.getState();
    expect(store.setOristudioCpFoldedFigureAppearance('flat-1', 'paper.back', '#0000ff')).toBe(
      true
    );
    await Promise.resolve();
    expect(written()).toEqual([
      { id: 'flat-1', patch: { back_color: { red: 0, green: 0, blue: 255 } }, options: { mirror: true } },
    ]);
    update.mockClear();
    expect(
      useWorkspaceStore.getState().setOristudioCpFoldedFigureAppearance('flat-1', 'paper.back', undefined)
    ).toBe(true);
    await Promise.resolve();
    expect(written()).toEqual([
      { id: 'flat-1', patch: { back_color: MODEL.back_color }, options: { mirror: true } },
    ]);
  });

  it('picks a reopened figure up once a rehydrate hands it a handle', async () => {
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#ff0000');
    await Promise.resolve();
    update.mockClear();
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: useWorkspaceStore
        .getState()
        .oristudioCpFoldedFigures.map((figure) =>
          figure.id === 'reopened' ? { ...figure, handle: 9 } : figure
        ),
    });
    await Promise.resolve();
    expect(written()).toEqual([
      { id: 'reopened', patch: { front_color: RED }, options: { mirror: true } },
    ]);
  });

  it('reaches its fixed point in one write per figure', async () => {
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#ff0000');
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    // Every landing changes the list, which runs another pass; each finds the
    // model agreeing with the style and asks nothing more.
    expect(written().map((call) => call.id).sort()).toEqual(['flat-1', 'spatial-1']);
    expect(
      foldedFigureModelMirror(
        useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!,
        useSettingsStore.getState().paperStyle.display
      )
    ).toBeNull();
  });

  it('asks once for a write the kernel refuses, and leaves the figure in error alone', async () => {
    // What the store's action does when the kernel throws: the figure goes to
    // `error`, its model stays as it was, and the write resolves false.
    update.mockImplementation((id: string) => {
      useWorkspaceStore.setState({
        oristudioCpFoldedFigures: useWorkspaceStore
          .getState()
          .oristudioCpFoldedFigures.map((figure) =>
            figure.id === id ? { ...figure, status: 'error', error: 'refused' } : figure
          ),
      });
      return Promise.resolve(false);
    });
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#ff0000');
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(written().filter((call) => call.id === 'flat-1')).toEqual([
      { id: 'flat-1', patch: { front_color: RED }, options: { mirror: true } },
    ]);

    // Re-pinned: a figure in `error` is skipped outright — a further style
    // change is not a new question to a kernel that has already refused one.
    update.mockClear();
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#00ff00');
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(written().filter((call) => call.id === 'flat-1')).toEqual([]);

    // A rehydrate that hands the figure a new handle and a ready status is.
    update.mockClear();
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: useWorkspaceStore
        .getState()
        .oristudioCpFoldedFigures.map((figure) =>
          figure.id === 'flat-1' ? { ...figure, handle: 11, status: 'ready' } : figure
        ),
    });
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(written().filter((call) => call.id === 'flat-1')).toEqual([
      {
        id: 'flat-1',
        patch: { front_color: { red: 0, green: 255, blue: 0 } },
        options: { mirror: true },
      },
    ]);
  });

  it('asks once for a write that fails without marking the figure, and again once something changes', async () => {
    // A write that rejects and leaves the entry untouched — no `error` status
    // to skip on — so only the memory of the write itself stops the re-ask.
    const land = update.getMockImplementation()!;
    update.mockImplementationOnce(() => Promise.reject(new Error('lost')));
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#ff0000');
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(written().filter((call) => call.id === 'flat-1')).toEqual([
      { id: 'flat-1', patch: { front_color: RED }, options: { mirror: true } },
    ]);
    expect(
      useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.snapshot?.model.front_color
    ).toEqual(MODEL.front_color);

    // The effective style changing is a new question, and this one lands.
    update.mockClear();
    update.mockImplementation(land);
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#00ff00');
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(written().filter((call) => call.id === 'flat-1')).toEqual([
      {
        id: 'flat-1',
        patch: { front_color: { red: 0, green: 255, blue: 0 } },
        options: { mirror: true },
      },
    ]);
    expect(
      useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.snapshot?.model.front_color
    ).toEqual({ red: 0, green: 255, blue: 0 });
  });

  it('asks again once a superseded write’s reconcile replaces the entry', async () => {
    // An undo taken while a mirror write is in flight supersedes it: the write
    // resolves without touching the model, and the reconcile then puts a new
    // entry — same id, same model — in the list. That entry is a new question.
    update.mockImplementationOnce(() => Promise.resolve(true));
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#ff0000');
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(written().filter((call) => call.id === 'flat-1')).toHaveLength(1);

    update.mockClear();
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: useWorkspaceStore
        .getState()
        .oristudioCpFoldedFigures.map((figure) => (figure.id === 'flat-1' ? { ...figure } : figure)),
    });
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(written().filter((call) => call.id === 'flat-1')).toEqual([
      { id: 'flat-1', patch: { front_color: RED }, options: { mirror: true } },
    ]);
  });

  it('forgets a failed write once the figure has left the list', async () => {
    update.mockImplementationOnce(() => Promise.reject(new Error('lost')));
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#ff0000');
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(written().filter((call) => call.id === 'flat-1')).toHaveLength(1);

    // Gone, then back with the same id, handle and model: a new figure.
    update.mockClear();
    const figures = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: figures.filter((figure) => figure.id !== 'flat-1'),
    });
    useWorkspaceStore.setState({ oristudioCpFoldedFigures: figures });
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(written().filter((call) => call.id === 'flat-1')).toEqual([
      { id: 'flat-1', patch: { front_color: RED }, options: { mirror: true } },
    ]);
  });

  it('stops listening once uninstalled', async () => {
    const uninstall = installFoldedFigurePaperMirror(useWorkspaceStore);
    uninstall();
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#ff0000');
    await Promise.resolve();
    // The store's own subscription still mirrors — once per figure, and the
    // uninstalled one adds nothing to that.
    expect(written().filter((call) => call.id === 'flat-1')).toHaveLength(1);
  });
});
