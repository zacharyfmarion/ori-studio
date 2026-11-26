import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_STORED_STROKES } from '../../cp-workspace/sheets/sheetThumbnail';
import { cpDocument, type FixtureLine } from '../capture/capture.fixtures';
import { thumbnailJson } from '../document/diagramFile';
import { creasePatternAsset, patternFileFormat, readPatternFile } from './titleBlockPatternFile';

/**
 * A crease pattern read from a file for the title block
 * (`implementation-plans/diagram-title-block-final-cp.md`): the lines kept as
 * the asset, and the file loaded by its format in a task session of its own.
 */

const api = vi.hoisted(() => ({
  loadCp: vi.fn(async (_text: string, _title?: string) => 1),
  loadFoldFile: vi.fn(async (_text: string) => 2),
  loadOri: vi.fn(async (_text: string, _acceptUnknownVersion?: boolean) => 3),
  loadOrh: vi.fn(async (_text: string) => 4),
  documentGeometry: vi.fn(async (_handle: number) => ({})),
}));
const session = vi.hoisted(() => ({ closed: 0 }));
const decoded = vi.hoisted(() => ({ document: null as unknown }));
vi.mock('../../engines/cpTaskSession', () => ({
  createCpTaskSession: async () => ({
    client: api,
    runId: 1,
    run: (work: () => Promise<unknown>) => work(),
    close: async () => {
      session.closed += 1;
    },
  }),
}));
vi.mock('../../engine/oristudioCpGeometry', async (original) => ({
  ...(await original<typeof import('../../engine/oristudioCpGeometry')>()),
  decodeCpGeometryToSnapshot: () => decoded.document,
}));

/** A waterbomb base on a 400-unit sheet: its edge, two valley diagonals, two mountain midlines, and an aux line. */
const WATERBOMB = cpDocument([
  [0, 0, 400, 0, 'Black0'],
  [400, 0, 400, 400, 'Black0'],
  [400, 400, 0, 400, 'Black0'],
  [0, 400, 0, 0, 'Black0'],
  [0, 0, 400, 400, 'Blue2'],
  [400, 0, 0, 400, 'Blue2'],
  [200, 0, 200, 400, 'Red1'],
  [0, 200, 400, 200, 'Red1'],
  [0, 100, 400, 100, 'Cyan3'],
]);

const bytes = (text: string) => new TextEncoder().encode(text);

beforeEach(() => {
  vi.clearAllMocks();
  session.closed = 0;
  decoded.document = WATERBOMB;
});

describe('creasePatternAsset', () => {
  it('keeps every line of the file in its role, fitted to a 1000-unit box, and names it after the file', () => {
    const made = creasePatternAsset(WATERBOMB, 'waterbomb.cp', 'asset-1');
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const { asset, trimmed } = made;
    expect(trimmed).toBe(false);
    expect([asset.id, asset.kind, asset.name]).toEqual(['asset-1', 'crease-pattern', 'waterbomb.cp']);
    expect(asset.pattern.viewBox).toBe('0 0 1000 1000');
    expect(asset.pattern.strokes.map((stroke) => stroke.role).sort()).toEqual(
      ['aux', 'edge', 'edge', 'edge', 'edge', 'mountain', 'mountain', 'valley', 'valley'].sort()
    );
    // The diagonal across the whole sheet, at the box's size.
    expect(asset.pattern.strokes).toContainEqual({ x1: 0, y1: 0, x2: 1000, y2: 1000, role: 'valley' });
    expect(asset.bytes).toBe(thumbnailJson(asset.pattern).length);
  });

  it('refuses a file with no mountain or valley fold: the block draws the final folds', () => {
    const plain = cpDocument([
      [0, 0, 100, 0, 'Black0'],
      [0, 0, 100, 100, 'Cyan3'],
    ]);
    expect(creasePatternAsset(plain, 'aux.cp', 'asset-1')).toEqual({ ok: false, reason: 'no-folds' });
    expect(creasePatternAsset(cpDocument([]), 'empty.cp', 'asset-1')).toEqual({ ok: false, reason: 'no-folds' });
  });

  it('keeps one line of its name, and says when it left lines out to stay within what a file keeps', () => {
    expect(creasePatternAsset(WATERBOMB, 'two\nlines.cp', 'asset-1')).toMatchObject({ ok: true, asset: { name: 'two lines.cp' } });
    // More distinct creases than a file keeps: short mountains on a grid.
    const dense = cpDocument(
      Array.from({ length: MAX_STORED_STROKES + 5 }, (_, index): FixtureLine => {
        const [x, y] = [index % 997, Math.floor(index / 997)];
        return [x, y, x, y + 0.5, 'Red1'];
      })
    );
    const made = creasePatternAsset(dense, 'dense.fold', 'asset-1');
    expect(made).toMatchObject({ ok: true, trimmed: true });
    if (made.ok) expect(made.asset.pattern.strokes.length).toBeLessThanOrEqual(MAX_STORED_STROKES);
  });
});

describe('patternFileFormat', () => {
  it('reads the four formats Edit opens from the extension, and refuses any other rather than guess', () => {
    expect(['a.cp', 'b.FOLD', 'c.ori', 'd.orh'].map(patternFileFormat)).toEqual(['cp', 'fold', 'ori', 'orh']);
    expect(['crane.osf', 'crane.svg', 'crane'].map(patternFileFormat)).toEqual([null, null, null]);
  });
});

describe('readPatternFile', () => {
  it('loads each file by its format, as Edit does, and closes its session', async () => {
    for (const [name, loader] of [
      ['crane.cp', api.loadCp],
      ['crane.fold', api.loadFoldFile],
      ['crane.ori', api.loadOri],
      ['crane.orh', api.loadOrh],
    ] as const) {
      vi.clearAllMocks();
      const read = await readPatternFile(bytes('file text'), name, 'asset-9');
      expect(read, name).toMatchObject({ ok: true, format: name.split('.')[1], asset: { id: 'asset-9', name } });
      expect(loader, name).toHaveBeenCalledOnce();
      expect(loader.mock.calls[0]![0], name).toBe('file text');
    }
    // A `.cp` is titled as Edit titles it; an `.ori` of a version the kernel does not know is not forced.
    expect(api.loadCp).not.toHaveBeenCalled();
    await readPatternFile(bytes('x'), 'crane.cp', 'asset-9');
    expect(api.loadCp).toHaveBeenCalledWith('x', 'crane');
    await readPatternFile(bytes('x'), 'crane.ori', 'asset-9');
    expect(api.loadOri).toHaveBeenLastCalledWith('x', false);
    expect(session.closed).toBe(6);
  });

  it('refuses a file the kernel refuses, or a name no loader takes, without a session for the second', async () => {
    api.loadCp.mockRejectedValueOnce(new Error('bad file'));
    expect(await readPatternFile(bytes('nonsense'), 'bad.cp', 'asset-9')).toEqual({ ok: false, reason: 'unreadable' });
    expect(session.closed).toBe(1);
    expect(await readPatternFile(bytes('<svg/>'), 'picture.svg', 'asset-9')).toEqual({ ok: false, reason: 'unreadable' });
    expect(session.closed).toBe(1);
  });

  it('refuses a file whose lines hold no fold', async () => {
    decoded.document = cpDocument([[0, 0, 100, 0, 'Black0']]);
    expect(await readPatternFile(bytes('x'), 'square.fold', 'asset-9')).toEqual({ ok: false, reason: 'no-folds' });
    expect(session.closed).toBe(1);
  });
});
