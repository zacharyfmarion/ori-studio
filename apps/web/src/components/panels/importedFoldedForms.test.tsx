import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { FoldDocument } from '../../engine/types';
import type { ImportedCreasePatternDocument } from '../../lib/creasePatternImport';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { CreasePatternPanel } from './CreasePatternPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  useWorkspaceStore.setState({ importedCreasePattern: null });
});

describe('a .fold with a folded form', () => {
  it('draws one with more vertices than a call can take as arguments', async () => {
    // The folded form of a large pattern: a vertex for every one of its own.
    const count = 500_000;
    const frame: FoldDocument = {
      frame_classes: ['foldedForm'],
      vertices_coords: Array.from({ length: count }, (_, i) => [i % 1000, Math.floor(i / 1000)]),
      edges_vertices: [[0, count - 1]],
      faces_vertices: [],
    };
    useWorkspaceStore.setState({
      activePanelId: 'crease-pattern',
      importedCreasePattern: {
        sourceFold: { file_frames: [frame] },
      } as unknown as ImportedCreasePatternDocument,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () =>
      root?.render(
        <TooltipProvider>
          <CreasePatternPanel />
        </TooltipProvider>
      )
    );

    expect(container.querySelector('section')).not.toBeNull();
  });
});
