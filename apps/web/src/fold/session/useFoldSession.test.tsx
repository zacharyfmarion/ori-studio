import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import { sequenceOf, step, valleyAt } from '../document/foldSequence.fixtures';
import { createFoldSession, type FoldSession, type FoldStateCall } from './foldSession';
import { fakeFoldEngine, inProcessFoldRuntime, memoryFoldDocument, settle } from './foldSession.fixtures';
import type { FoldStateSummary } from '../engine/foldEngineWire';
import {
  useFoldActivePath,
  useFoldNode,
  useFoldNodeQuery,
  useFoldReplayProgress,
  useFoldSession,
  type FoldSessionSurface,
} from './useFoldSession';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The app's session is the store-bound one; these tests hand the hooks one over the fakes. */
const app = vi.hoisted(() => ({ session: null as FoldSession | null }));
vi.mock('../../store/workspaceStore/foldSession', () => ({
  foldSession: () => {
    if (!app.session) throw new Error('no session');
    return app.session;
  },
}));

const summaryOf: FoldStateCall<FoldStateSummary> = (engine, state) => engine.summary(state);

interface Seen {
  surface: FoldSessionSurface;
  progress: ReturnType<typeof useFoldReplayProgress>;
  activePath: readonly string[];
  b: ReturnType<typeof useFoldNode>;
  summary: FoldStateSummary | null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let seen: Seen[] = [];
let runtime: ReturnType<typeof inProcessFoldRuntime>;

/** Declared once, so a render does not remount it. Captured in an effect, which `act` flushes. */
function Probe({ retain }: { retain: boolean }) {
  const surface = useFoldSession({ retain });
  const progress = useFoldReplayProgress();
  const activePath = useFoldActivePath();
  const b = useFoldNode('b');
  const summary = useFoldNodeQuery(surface.cursorId, summaryOf);
  useEffect(() => {
    seen.push({ surface, progress, activePath, b, summary });
  });
  return null;
}

const latest = () => seen[seen.length - 1]!;

beforeEach(() => {
  const document = sequenceOf([step('a', null, valleyAt(0.5)), step('b', 'a', valleyAt(0.25))]);
  runtime = inProcessFoldRuntime(() => fakeFoldEngine());
  app.session = createFoldSession({
    document: memoryFoldDocument({
      held: { document, readOnlyRaw: null },
      reader: withFoldCursor(initialFoldReaderState(document.id), document, 'b'),
    }),
    runtime,
  });
  container = window.document.createElement('div');
  window.document.body.appendChild(container);
  root = createRoot(container);
  seen = [];
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  app.session?.dispose();
  app.session = null;
});

describe('useFoldSession', () => {
  it('holds the engine while mounted, and shows the replay as it lands', async () => {
    act(() => root?.render(<Probe retain />));
    expect(runtime.holders()).toBe(1);
    expect(latest().surface.cursor.status).toBe('pending');

    await act(async () => settle());
    expect(latest().surface).toMatchObject({ cursorId: 'b', readOnly: false, error: null });
    expect(latest().surface.cursor.status).toBe('ok');
    expect(latest().progress).toMatchObject({ done: true, settled: 2, total: 2 });
    expect(latest().activePath).toEqual(['a', 'b']);
    expect(latest().b).toBe(latest().surface.cursor);
    // The query on the state on screen, asked once it landed.
    expect(latest().summary).toEqual(latest().surface.cursor.summary);
    // The verbs are the session's own, the same on every render.
    expect(latest().surface.commitStep).toBe(app.session!.commitStep);

    act(() => root?.unmount());
    root = null;
    expect(runtime.holders()).toBe(0);
  });

  it('reads without holding for a surface that only reads', async () => {
    act(() => root?.render(<Probe retain={false} />));
    await act(async () => settle());
    expect(runtime.holders()).toBe(0);
    expect(latest().surface.cursor.status).toBe('pending');
    expect(latest().summary).toBeNull();
  });

  it('asks again when the state on screen changes, and never shows another state’s answer', async () => {
    act(() => root?.render(<Probe retain />));
    await act(async () => settle());
    const before = latest().summary;
    expect(before).not.toBeNull();

    await act(async () => {
      runtime.lose('crashed');
      await settle();
    });
    // A new engine landed the same state under a new handle: the query was asked of it.
    expect(latest().surface.cursor.state?.generation).toBe(1);
    expect(latest().summary).toEqual(before);
    // While the state was gone, no answer about the old one was shown for it.
    const lost = seen.filter((each) => each.surface.cursor.state === null);
    expect(lost.length).toBeGreaterThan(0);
    expect(lost.every((each) => each.summary === null)).toBe(true);
  });
});
