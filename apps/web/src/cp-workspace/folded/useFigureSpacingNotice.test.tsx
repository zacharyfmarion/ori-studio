import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { TFunction } from 'i18next';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { initSync, solve_layer_spread } from '../../generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm';
import { equalOpeningGain } from '../../layer-spread/equalOpening';
import type { PreparedConnectedSpread } from '../../layer-spread/connectedScene';
import { FIGURE } from '../canvasObjects/canvasObjectKinds.fixtures';
import { connectedSpreadSource } from './connectedSpreadSource';
import { plainBook } from './foldedPrecrease.fixtures';
import { DEFAULT_CONNECTED_SPREAD } from './layerSpreadSettings';
import { useFigureSpacingNotice } from './useFigureSpacingNotice';

const worker = vi.hoisted(() => ({ promise: null as Promise<PreparedConnectedSpread> | null }));
vi.mock('../../layer-spread/prepareConnected', () => ({
  prepareConnected: () => ({ promise: worker.promise, release: () => {} }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('updates a reopened Edit figure only after its scene is measured and its button clicked', async () => {
  initSync({ module: readFileSync(resolve('src/generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm_bg.wasm')) });
  const scene = plainBook();
  const source = connectedSpreadSource(scene);
  const prepared = { source, solution: solve_layer_spread(source.input) };
  const gain = equalOpeningGain(prepared);
  const saved = { ...DEFAULT_CONNECTED_SPREAD, amount: Math.min(gain * 0.5, 0.5) };
  const entry: OristudioCpFoldedFigureEntry = {
    ...FIGURE, handle: null, snapshot: null, status: 'ready', displayStyle: 'Paper5',
    spreadScene: scene, spread: { kind: 'record', spread: saved },
  };
  let finish!: (value: PreparedConnectedSpread) => void;
  worker.promise = new Promise(resolve => { finish = resolve; });
  const set = vi.fn(async () => true);
  const t = ((_key: string, fallback: string) => fallback) as TFunction;
  function Properties({ figure }: { figure: OristudioCpFoldedFigureEntry }) {
    const notice = useFigureSpacingNotice(figure, null, false, set, t);
    const update = notice?.actions?.[0];
    return update ? <button disabled={update.disabled} onClick={() => update.run()}>{update.label}</button> : null;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Properties figure={entry} />));
    expect(host.querySelector('button')?.disabled).toBe(true);
    await act(async () => finish(prepared));
    expect(host.querySelector('button')?.disabled).toBe(false);
    expect(set).not.toHaveBeenCalled();
    await act(async () => host.querySelector('button')!.click());
    expect(set).toHaveBeenCalledOnce();
    const amount = Math.round(saved.amount / gain * 1e4) / 1e4;
    expect(set).toHaveBeenCalledWith({ kind: 'record', spread: { ...saved, amount, version: 3 } });
    await act(async () => root.render(<Properties figure={{ ...entry, spreadScene: null }} />));
    expect(host.querySelector('button')).toBeNull();
  } finally {
    act(() => root.unmount());
  }
});
