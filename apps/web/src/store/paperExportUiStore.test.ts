import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaperExportTarget } from '../paperExport/paperExportTarget';
import { usePaperExportUiStore } from './paperExportUiStore';

function target(): PaperExportTarget {
  return { release: vi.fn() } as unknown as PaperExportTarget;
}

afterEach(() => usePaperExportUiStore.setState({ request: null }));

describe('usePaperExportUiStore', () => {
  it('opens on a target, and gives each opening its own id', () => {
    const store = usePaperExportUiStore.getState();
    store.open({ target: target(), format: 'png', returnFocus: null });
    const first = usePaperExportUiStore.getState().request;
    expect(first?.format).toBe('png');
    usePaperExportUiStore.getState().open({ target: target(), format: null, returnFocus: null });
    expect(usePaperExportUiStore.getState().request?.id).not.toBe(first?.id);
  });

  it('releases the capture it replaces, and the one it closes', () => {
    const replaced = target();
    const kept = target();
    usePaperExportUiStore.getState().open({ target: replaced, format: null, returnFocus: null });
    usePaperExportUiStore.getState().open({ target: kept, format: null, returnFocus: null });
    expect(replaced.release).toHaveBeenCalledTimes(1);
    expect(kept.release).not.toHaveBeenCalled();
    usePaperExportUiStore.getState().close();
    expect(kept.release).toHaveBeenCalledTimes(1);
    expect(usePaperExportUiStore.getState().request).toBeNull();
    // Closing twice releases nothing twice.
    usePaperExportUiStore.getState().close();
    expect(kept.release).toHaveBeenCalledTimes(1);
  });
});
