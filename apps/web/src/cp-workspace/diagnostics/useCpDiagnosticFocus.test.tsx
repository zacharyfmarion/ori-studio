import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { CpDiagnosticBounds } from './geometry';
import { useCpDiagnosticFocus } from './useCpDiagnosticFocus';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

const ENTRY: OristudioCpDiagnosticEntry = {
  id: 'CheckCamv-1',
  kind: 'CheckCamv',
  severity: 'error',
  message: 'Maekawa violated',
  point: { x: 10, y: 20 },
};
const OTHER_ENTRY: OristudioCpDiagnosticEntry = { ...ENTRY, id: 'CheckCamv-2' };

/**
 * Mount the hook over an entry list the test can swap, standing in for the panel's
 * `latestDiagnosticEntries` — which is exactly what the "Foldability issues" toggle
 * empties and refills.
 */
function mountFocus(entries: readonly OristudioCpDiagnosticEntry[]) {
  const frameBounds = vi.fn<(bounds: CpDiagnosticBounds) => void>();
  function Host({ entries: current }: { entries: readonly OristudioCpDiagnosticEntry[] }) {
    useCpDiagnosticFocus(current, frameBounds);
    return null;
  }
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const render = (next: readonly OristudioCpDiagnosticEntry[]) =>
    act(() => root?.render(<Host entries={next} />));
  render(entries);
  return { frameBounds, render };
}

const activate = (id: string | null) =>
  act(() => useWorkspaceStore.getState().setOristudioCpActiveDiagnostic(id));

describe('useCpDiagnosticFocus', () => {
  it('frames the diagnostic that was just activated', () => {
    const { frameBounds } = mountFocus([ENTRY]);
    expect(frameBounds).not.toHaveBeenCalled();

    activate(ENTRY.id);

    expect(frameBounds).toHaveBeenCalledTimes(1);
    expect(frameBounds.mock.calls[0][0]).toMatchObject({ minX: 10, minY: 20, maxX: 10, maxY: 20 });
    // Consumed: the request must not be left standing to fire again later.
    expect(useWorkspaceStore.getState().oristudioCpDiagnosticFocusRequest).toBeNull();
  });

  it('does not re-frame when the entry list is re-derived', () => {
    // The reported bug: click an issue, zoom out, toggle "Foldability issues" off and
    // back on — and the camera jumped back to the issue. Hiding the overlay drops the
    // entries and showing it rebuilds them, which must not read as a new instruction.
    const { frameBounds, render } = mountFocus([ENTRY]);
    activate(ENTRY.id);
    frameBounds.mockClear();

    render([]);
    render([{ ...ENTRY }]);

    expect(frameBounds).not.toHaveBeenCalled();
    // The diagnostic stays selected the whole time — only the framing is one-shot.
    expect(useWorkspaceStore.getState().oristudioCpActiveDiagnosticId).toBe(ENTRY.id);
  });

  it('frames again when the same diagnostic is activated again', () => {
    const { frameBounds } = mountFocus([ENTRY]);
    activate(ENTRY.id);
    frameBounds.mockClear();

    activate(ENTRY.id);

    expect(frameBounds).toHaveBeenCalledTimes(1);
  });

  it('drops a request for an entry that is not listed', () => {
    // A check that adopts a hidden issue frames nothing — and does not lie in wait
    // for the entry to reappear.
    const { frameBounds, render } = mountFocus([OTHER_ENTRY]);

    activate(ENTRY.id);
    expect(frameBounds).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().oristudioCpDiagnosticFocusRequest).toBeNull();

    render([ENTRY, OTHER_ENTRY]);
    expect(frameBounds).not.toHaveBeenCalled();
  });

  it('deselecting frames nothing', () => {
    const { frameBounds } = mountFocus([ENTRY]);

    activate(null);

    expect(frameBounds).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().oristudioCpDiagnosticFocusRequest).toBeNull();
  });
});
