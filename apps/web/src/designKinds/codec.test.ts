import { describe, expect, it, vi } from 'vitest';
import type { EngineClient } from '../store/workspaceStore/engineRuntime';
import type { OristudioBpClient } from '../store/workspaceStore/oristudioBpRuntime';
import { createBoxPleatCodec, createBoxPleatSendToEdit } from './boxPleat';
import { createTreemakerCodec, createTreemakerSendToEdit } from './treemaker';

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
  };
}

function fakeBoxPleatClient(sheet = { width: 16, height: 12 }) {
  return {
    newSampleProject: vi.fn(async () => 21),
    loadProject: vi.fn(async () => 22),
    exportBps: vi.fn(async () => 'bps-text'),
    freeProject: vi.fn(async () => undefined),
    snapshot: vi.fn(async () => ({ design: { layout: { sheet } } })),
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
    const failing = { ...fakeTreemakerClient(), freeTree: vi.fn(async () => { throw new Error('gone'); }) };
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
      client.exportFold.mock.invocationCallOrder[0]
    );
    expect(payload).toMatchObject({ format: 'fold', filename: 'Crane.fold' });
  });

  it('falls back to a generic filename for an untitled design', async () => {
    const client = fakeTreemakerClient();
    const sendToEdit = createTreemakerSendToEdit(async () => client as unknown as EngineClient);
    const payload = await sendToEdit(7, { editGridDivisions: 16, title: '' });
    expect(payload.filename).toBe('design.fold');
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
});
