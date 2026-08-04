import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCpDocumentCamera, type CpDocumentCamera } from './useCpDocumentCamera';
import { useWorkspaceStore } from '../../store/workspaceStore';

const CAMERA = { centerX: 5, centerY: 6, zoom: 2, rotation: 0.25 };

describe('useCpDocumentCamera', () => {
  let host: HTMLElement;
  let root: Root;
  let seen: CpDocumentCamera;
  let metadata: Record<string, unknown>;

  function Probe() {
    seen = useCpDocumentCamera(metadata);
    return null;
  }

  const render = () => act(() => root.render(<Probe />));

  /** Open a document carrying `camera`, the way the load path does. */
  const openDocument = (camera: typeof CAMERA | null) =>
    act(() => {
      useWorkspaceStore.setState({
        oristudioCpCamera: camera,
        projectLoadId: useWorkspaceStore.getState().projectLoadId + 1,
      });
    });

  beforeEach(() => {
    vi.useFakeTimers();
    metadata = {};
    useWorkspaceStore.setState({ oristudioCpCamera: null });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it('offers the camera the open document was saved with', () => {
    openDocument(CAMERA);
    render();
    expect(seen.initialCamera).toEqual(CAMERA);
  });

  it('records a moved camera once the view settles, not per frame', () => {
    render();
    act(() => {
      // A drag reports every frame.
      for (let i = 0; i < 20; i++) seen.onCameraChange({ ...CAMERA, centerX: i });
    });
    expect(useWorkspaceStore.getState().oristudioCpCamera).toBeNull();
    act(() => void vi.advanceTimersByTime(500));
    expect(useWorkspaceStore.getState().oristudioCpCamera).toMatchObject({ centerX: 19 });
  });

  it('does not hand its own write-back back as the document camera', () => {
    // The regression this exists for. A file with no saved camera opens fit to
    // content; the canvas reports that fit and a settle records it. The canvas
    // re-frames more than once per open — its framing key carries the wasm
    // handle, which lands after the document — and reading the store live would
    // hand the recorded fit to that second re-frame as if the file had supplied
    // it, pinning the view to whatever had loaded by then instead of re-fitting
    // against the whole document.
    openDocument(null);
    render();
    expect(seen.initialCamera).toBeNull();

    act(() => seen.onCameraChange({ ...CAMERA, zoom: 40 }));
    act(() => void vi.advanceTimersByTime(500));
    expect(useWorkspaceStore.getState().oristudioCpCamera).toMatchObject({ zoom: 40 });

    render();
    expect(seen.initialCamera).toBeNull();
  });

  it('picks up the next document’s camera', () => {
    openDocument(null);
    render();
    expect(seen.initialCamera).toBeNull();

    openDocument(CAMERA);
    render();
    expect(seen.initialCamera).toEqual(CAMERA);
  });

  it('reads an imported Oriedita camera angle from the document metadata', () => {
    metadata = { 'oriedita:ori:creasePatternCamera': { cameraAngle: -22.5 } };
    render();
    expect(seen.initialRotation).toBeCloseTo(Math.PI / 8);
    expect(seen.initialCamera).toBeNull();
  });

  it('has no rotation to restore for a document that names none', () => {
    render();
    expect(seen.initialRotation).toBeNull();
  });
});
