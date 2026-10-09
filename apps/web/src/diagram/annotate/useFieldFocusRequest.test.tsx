import { act, useEffect, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelFieldFocus, pendingFieldFocus, requestFieldFocus } from './fieldFocus';
import { useFieldFocusRequest } from './useFieldFocusRequest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  cancelFieldFocus();
  vi.unstubAllGlobals();
});

function Parts({ id, disabled = false }: { id: string; disabled?: boolean }) {
  const field = useFieldFocusRequest<HTMLInputElement>(id, 'parts');
  return <input ref={field} aria-label="Parts" defaultValue="4" disabled={disabled} />;
}

/** A sheet that focuses itself as it opens, as `WorkspaceViewDrawer` does: after its content's effects. */
function Sheet({ children }: { children: ReactNode }) {
  const sheet = useRef<HTMLDivElement | null>(null);
  useEffect(() => sheet.current?.focus(), []);
  return (
    <div ref={sheet} role="dialog" tabIndex={-1}>
      {children}
    </div>
  );
}

const parts = () => host.querySelector<HTMLInputElement>('input[aria-label="Parts"]')!;

describe('useFieldFocusRequest (Revision 2)', () => {
  it('takes the focus asked for once, its contents selected, and only for its own annotation and field', () => {
    const select = vi.spyOn(HTMLInputElement.prototype, 'select');
    requestFieldFocus('other', 'parts');
    act(() => root.render(<Parts id="d-1" />));
    expect(document.activeElement).not.toBe(parts());
    expect(pendingFieldFocus()).toEqual({ annotationId: 'other', field: 'parts' });
    act(() => requestFieldFocus('d-1', 'text'));
    expect(document.activeElement).not.toBe(parts());
    act(() => requestFieldFocus('d-1', 'parts'));
    expect(document.activeElement).toBe(parts());
    expect(select.mock.contexts).toContain(parts());
    expect(pendingFieldFocus()).toBeNull();
    select.mockRestore();
  });

  it('takes the focus back from a sheet that focuses itself as it opens with the field in it, and from nothing else', () => {
    requestFieldFocus('d-1', 'parts');
    act(() =>
      root.render(
        <Sheet>
          <Parts id="d-1" />
        </Sheet>
      )
    );
    // The sheet focused itself after the field took the request.
    expect(document.activeElement?.getAttribute('role')).toBe('dialog');
    act(() => frames.splice(0).forEach((run) => run(0)));
    expect(document.activeElement).toBe(parts());
    // A field the author moved to since keeps it.
    const other = document.createElement('input');
    document.body.append(other);
    act(() => requestFieldFocus('d-1', 'parts'));
    other.focus();
    act(() => frames.splice(0).forEach((run) => run(0)));
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('leaves the request waiting while the field is disabled, and takes it as the field is enabled (review of 18e)', async () => {
    // An x-ray laid on a step whose faces are still being fetched: its Depth is held until they land.
    requestFieldFocus('d-1', 'parts');
    act(() => root.render(<Parts id="d-1" disabled />));
    expect(document.activeElement).not.toBe(parts());
    expect(pendingFieldFocus()).toEqual({ annotationId: 'd-1', field: 'parts' });
    // Heard as its attribute changes, after the render.
    await act(async () => root.render(<Parts id="d-1" />));
    expect(document.activeElement).toBe(parts());
    expect(pendingFieldFocus()).toBeNull();
  });
});
