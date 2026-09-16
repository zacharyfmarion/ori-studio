import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetCanvasSessionEndersForTests } from './canvasSessions';
import { createGestureBracket, type GestureBracket } from './gestureBracket';
import { usePaneGesture, type PaneGesture } from './usePaneGesture';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
/** The hook's latest return, handed out through a ref-like holder rather than a render-time write. */
const probe: { latest: PaneGesture | null } = { latest: null };
let list: readonly string[] = [];
let recorded: string[] = [];
let bracket: GestureBracket;

function Probe({ bracket, onRender }: { bracket: GestureBracket; onRender: (gesture: PaneGesture) => void }) {
  const gesture = usePaneGesture(bracket);
  useEffect(() => {
    onRender(gesture);
  });
  return <span data-held={gesture.held || undefined} />;
}

function mount() {
  act(() =>
    root?.render(
      <Probe
        bracket={bracket}
        onRender={(gesture) => {
          probe.latest = gesture;
        }}
      />
    )
  );
}

beforeEach(() => {
  resetCanvasSessionEndersForTests();
  list = ['a'];
  recorded = [];
  bracket = createGestureBracket<readonly string[]>({
    layer: 'test',
    snapshot: () => list,
    unchanged: (before, now) => before === now,
    record: (_before, label) => recorded.push(label),
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  probe.latest = null;
  resetCanvasSessionEndersForTests();
});

describe('usePaneGesture', () => {
  it('opens, updates while open, and records once on end', async () => {
    mount();
    expect(probe.latest?.begin('opacity')).toBe(true);
    expect(probe.latest?.isOpen()).toBe(true);
    expect(bracket.openOwner()).toBe('pane:opacity');
    list = ['a', 'b'];
    await act(async () => probe.latest?.end('Adjust opacity'));
    expect(recorded).toEqual(['Adjust opacity']);
    expect(probe.latest?.isOpen()).toBe(false);
    expect(bracket.openOwner()).toBeNull();
  });

  it('re-enters for the same field without a new baseline', async () => {
    mount();
    probe.latest?.begin('frontColor');
    list = ['a', 'moved'];
    expect(probe.latest?.begin('frontColor')).toBe(true);
    list = ['a', 'moved', 'again'];
    await act(async () => probe.latest?.end('Change colour'));
    expect(recorded).toEqual(['Change colour']);
  });

  it('is refused while another surface holds the layer, and reports held', () => {
    mount();
    expect(probe.latest?.held).toBe(false);
    let token: ReturnType<GestureBracket['begin']> = null;
    act(() => {
      token = bracket.begin('canvas');
    });
    expect(host?.querySelector('[data-held]')).not.toBeNull();
    expect(probe.latest?.begin('opacity')).toBe(false);
    act(() => bracket.abort(token!));
    expect(host?.querySelector('[data-held]')).toBeNull();
    expect(probe.latest?.begin('opacity')).toBe(true);
  });

  it('does not count its own open gesture as held', () => {
    mount();
    act(() => {
      probe.latest?.begin('opacity');
    });
    expect(host?.querySelector('[data-held]')).toBeNull();
  });

  it('keeps the open token through a refused begin for another field', async () => {
    mount();
    probe.latest?.begin('opacity');
    expect(probe.latest?.begin('rotation')).toBe(false);
    expect(probe.latest?.isOpen()).toBe(true);
    list = ['a', 'b'];
    await act(async () => probe.latest?.end('Adjust opacity'));
    expect(recorded).toEqual(['Adjust opacity']);
  });

  it('reports not open once aborted underneath, and begins afresh', async () => {
    mount();
    probe.latest?.begin('opacity');
    bracket.abortAll();
    expect(probe.latest?.isOpen()).toBe(false);
    await act(async () => probe.latest?.end('Adjust opacity'));
    expect(recorded).toEqual([]);
    expect(probe.latest?.begin('opacity')).toBe(true);
  });

  it('aborts whatever is open when it unmounts', () => {
    mount();
    probe.latest?.begin('opacity');
    expect(bracket.openOwner()).toBe('pane:opacity');
    act(() => root?.unmount());
    root = createRoot(host!);
    expect(bracket.openOwner()).toBeNull();
  });
});
