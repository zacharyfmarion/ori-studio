import { describe, expect, it, vi } from 'vitest';
import type { EngineClient } from '../store/workspaceStore/engineRuntime';
import type { OristudioBpClient } from '../store/workspaceStore/oristudioBpRuntime';
import { createBoxPleatCodec, createBoxPleatSendToEdit } from './boxPleat';
import { createTreemakerCodec, createTreemakerSendToEdit } from './treemaker';
import { createExploriSendToEdit } from './explori';
import { createExploriCodec, replaceExploriDocument } from '../explori/handles';
import { createExploriDocument } from '../explori/document';

/**
 * The codecs take their client by injection, so they can be exercised without a
 * wasm worker — and, more importantly, so they carry no ambient "current
 * document" state. Every call names its handle. That is the property Phase 1's
 * document registry depends on, so it is worth asserting directly rather than
 * inferring from the types.
 */

function fakeTreemakerClient() {
  return {
    newDesign: vi.fn(async () => 11),
    loadTmd: vi.fn(async () => 12),
    saveTmd5: vi.fn(async () => 'tmd5-text'),
    freeTree: vi.fn(async () => undefined),
    buildCreasePattern: vi.fn(async () => undefined),
    exportFold: vi.fn(async () => '{"fold":true}'),
    snapshot: vi.fn(async () => ({
      paper: { width: 1, height: 1, scale: 0.1 },
      nodes: [
        { id: 1, loc: { x: 0.2, y: 0.3 }, is_leaf: true },
        { id: 2, loc: { x: 0.5, y: 0.5 }, is_leaf: false },
      ],
      edges: [{ nodes: [1, 2], length: 2, strain: 0 }],
    })),
  };
}

function fakeBoxPleatClient(
  sheet: { width: number; height: number; type?: 'rect' | 'diag' } = { width: 16, height: 12 },
  layout: { flaps?: { id: number; x: number; y: number; width: number; height: number }[] } = {},
) {
  const flaps = layout.flaps ?? [{ id: 1, x: 8, y: 7, width: 0, height: 0 }];
  return {
    newSampleProject: vi.fn(async () => 21),
    loadProject: vi.fn(async () => 22),
    exportBps: vi.fn(async () => 'bps-text'),
    freeProject: vi.fn(async () => undefined),
    snapshot: vi.fn(async () => ({
      design: {
        layout: { sheet, flaps },
        tree: { edges: flaps.map((flap) => ({ n1: 0, n2: flap.id, length: 1 })) },
      },
    })),
    exportCp: vi.fn(async () => '1 0 0 1 1\n2 0 0 1 1\n3 0 0 1 1\n4 0 0 1 1'),
  };
}

describe('treemaker codec', () => {
  const client = fakeTreemakerClient();
  const codec = createTreemakerCodec(async () => client as unknown as EngineClient);

  it('creates a blank unit-square design', async () => {
    await expect(codec.create()).resolves.toBe(11);
    expect(client.newDesign).toHaveBeenCalledWith({ paper_width: 1, paper_height: 1 });
  });

  it('hydrates from tmd5 text and serializes back', async () => {
    await expect(codec.hydrate('some tmd5')).resolves.toBe(12);
    expect(client.loadTmd).toHaveBeenCalledWith('some tmd5');
    await expect(codec.serialize(12)).resolves.toBe('tmd5-text');
    expect(client.saveTmd5).toHaveBeenCalledWith(12);
  });

  it('frees the named handle, and swallows a double free', async () => {
    const failing = {
      ...fakeTreemakerClient(),
      freeTree: vi.fn(async () => {
        throw new Error('gone');
      }),
    };
    const failingCodec = createTreemakerCodec(async () => failing as unknown as EngineClient);
    await expect(failingCodec.free(12)).resolves.toBeUndefined();
    expect(failing.freeTree).toHaveBeenCalledWith(12);
  });
});

describe('treemaker sendToEdit', () => {
  it('builds creases before exporting, and reports FOLD', async () => {
    const client = fakeTreemakerClient();
    const sendToEdit = createTreemakerSendToEdit(async () => client as unknown as EngineClient);
    const payload = await sendToEdit(7, { editGridDivisions: 16, title: 'Crane' });

    expect(client.buildCreasePattern).toHaveBeenCalledWith(7);
    expect(client.exportFold).toHaveBeenCalledWith(7);
    // Ordering matters: exporting without building hands over a stale CP.
    expect(client.buildCreasePattern.mock.invocationCallOrder[0]).toBeLessThan(
      client.exportFold.mock.invocationCallOrder[0],
    );
    expect(payload).toMatchObject({ format: 'fold', filename: 'Crane.fold' });
  });

  it('falls back to a generic filename for an untitled design', async () => {
    const client = fakeTreemakerClient();
    const sendToEdit = createTreemakerSendToEdit(async () => client as unknown as EngineClient);
    const payload = await sendToEdit(7, { editGridDivisions: 16, title: '' });
    expect(payload.filename).toBe('design.fold');
  });

  it('carries no circles, and reads no snapshot, unless asked', async () => {
    const client = fakeTreemakerClient();
    const sendToEdit = createTreemakerSendToEdit(async () => client as unknown as EngineClient);
    const payload = await sendToEdit(7, { editGridDivisions: 16, title: 'Crane' });

    expect(payload.circles).toBeUndefined();
    expect(payload.circleSourceBounds).toBeUndefined();
    expect(client.snapshot).not.toHaveBeenCalled();
  });

  it('carries the leaf circles, in the FOLD export’s own space, when asked', async () => {
    const client = fakeTreemakerClient();
    const sendToEdit = createTreemakerSendToEdit(async () => client as unknown as EngineClient);
    const payload = await sendToEdit(7, {
      editGridDivisions: 16,
      title: 'Crane',
      includeCircles: true,
    });

    // One leaf, at (0.2, 0.3) with a length-2 edge and scale 0.1. The FOLD
    // export flips Y against the paper height, so the circle does too.
    expect(payload.circles).toEqual([{ cx: 0.2, cy: 0.7, r: 0.2 }]);
    expect(payload.circleSourceBounds).toEqual([0, 0, 1, 1]);
    expect(payload.label).toBe('Sent design to Edit with circles');
  });
});

describe('box-pleat codec', () => {
  const client = fakeBoxPleatClient();
  const codec = createBoxPleatCodec(async () => client as unknown as OristudioBpClient);

  it('creates upstream’s sample project', async () => {
    await expect(codec.create()).resolves.toBe(21);
    expect(client.newSampleProject).toHaveBeenCalled();
  });

  it('hydrates from bps text and serializes back', async () => {
    await expect(codec.hydrate('bps in')).resolves.toBe(22);
    expect(client.loadProject).toHaveBeenCalledWith('bps in');
    await expect(codec.serialize(22)).resolves.toBe('bps-text');
    expect(client.exportBps).toHaveBeenCalledWith(22);
  });
});

describe('box-pleat sendToEdit', () => {
  it('scales so one BP cell maps onto one Edit cell', async () => {
    const client = fakeBoxPleatClient({ width: 16, height: 12 });
    const sendToEdit = createBoxPleatSendToEdit(async () => client as unknown as OristudioBpClient);
    await sendToEdit(3, { editGridDivisions: 8, title: 'whatever' });

    // bpCells = max(16, 12) = 16; editDivisions = 8 -> scale 2.
    expect(client.exportCp).toHaveBeenCalledWith(3, false, true, 2);
  });

  it('reads the sheet from the handle, not from store state', async () => {
    // This is what lets a design that is not on screen be sent to Edit.
    const client = fakeBoxPleatClient({ width: 24, height: 24 });
    const sendToEdit = createBoxPleatSendToEdit(async () => client as unknown as OristudioBpClient);
    await sendToEdit(9, { editGridDivisions: 24, title: 'x' });
    expect(client.snapshot).toHaveBeenCalledWith(9);
    expect(client.exportCp).toHaveBeenCalledWith(9, false, true, 1);
  });

  it('swaps BP mountain/valley into the CP editor convention', async () => {
    const client = fakeBoxPleatClient();
    const sendToEdit = createBoxPleatSendToEdit(async () => client as unknown as OristudioBpClient);
    const payload = await sendToEdit(3, { editGridDivisions: 16, title: 'x' });

    // BP writes M=2, V=3; the editor reads 2=valley, 3=mountain. Border(1) and
    // auxiliary(4) are shared and must pass through untouched.
    expect(payload.text.split('\n').map((line) => line[0])).toEqual(['1', '3', '2', '4']);
    expect(payload.format).toBe('cp');
  });

  it('carries no circles unless asked', async () => {
    const client = fakeBoxPleatClient();
    const sendToEdit = createBoxPleatSendToEdit(async () => client as unknown as OristudioBpClient);
    const payload = await sendToEdit(3, { editGridDivisions: 16, title: 'x' });
    expect(payload.circles).toBeUndefined();
  });

  it('carries the flap circles, flipped into the .cp export’s space, when asked', async () => {
    const client = fakeBoxPleatClient({ width: 16, height: 16 });
    const sendToEdit = createBoxPleatSendToEdit(async () => client as unknown as OristudioBpClient);
    const payload = await sendToEdit(3, {
      editGridDivisions: 16,
      title: 'x',
      includeCircles: true,
    });

    // The one flap sits at (8, 7) with a length-1 tree edge, so radius 1. The
    // .cp export flips Y against the sheet.
    expect(payload.circles).toEqual([{ cx: 8, cy: 9, r: 1 }]);
    expect(payload.circleSourceBounds).toEqual([0, 0, 16, 16]);
    expect(payload.label).toBe('Sent BP to Edit with circles');
  });

  it('sends no circles for a layout whose flaps all have width or height', async () => {
    // A rounded flap has no honest representation in the Edit document, so the
    // payload is the plain one rather than something approximate.
    const client = fakeBoxPleatClient(
      { width: 16, height: 16 },
      { flaps: [{ id: 1, x: 2, y: 2, width: 3, height: 2 }] },
    );
    const sendToEdit = createBoxPleatSendToEdit(async () => client as unknown as OristudioBpClient);
    const payload = await sendToEdit(3, {
      editGridDivisions: 16,
      title: 'x',
      includeCircles: true,
    });

    expect(payload.circles).toBeUndefined();
    expect(payload.label).toBe('Sent BP to Edit');
  });
});

describe('explori sendToEdit', () => {
  it('ignores includeCircles — an archive lookup has no packing', async () => {
    // Asserted rather than left to the types, so a later caller cannot ask a
    // kind with no circles for circles and quietly get a payload without them.
    // An ExplOri result is a lookup into a tiling archive: it carries a `cp` and
    // a `packing`, both plain vertex/edge lists, and no radius or scale anywhere
    // to derive a circle from.
    const handle = await createExploriCodec().create();
    replaceExploriDocument(handle, {
      ...createExploriDocument(),
      selected: {
        rank: 1,
        distance: 0.1,
        N: 4,
        symmetry: 'book',
        topologyId: 1,
        tilingId: 61865,
        cp: { vertices: [], edges: [] },
        packing: { vertices: [], edges: [] },
        fold: null,
        tree: null,
        refs: {},
      },
    });

    const payload = await createExploriSendToEdit()(handle, {
      editGridDivisions: 16,
      title: 'x',
      includeCircles: true,
    });

    expect(payload.circles).toBeUndefined();
    expect(payload.circleSourceBounds).toBeUndefined();
  });
});
