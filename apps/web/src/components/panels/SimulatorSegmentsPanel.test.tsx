import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FoldDocument } from '../../engine/types';
import { segmentFoldDocument } from '../../lib/creasePatternSegmentation';
import { useSettingsStore } from '../../store/settingsStore';
import { SimulatorSegmentsSidebar } from './SimulatorSegmentsPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const paperStyle = useSettingsStore.getState().paperStyle;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  useSettingsStore.setState({ paperStyle });
});

/** Two disjoint squares, each split by an aux diagonal (`F`). */
function twoSquares(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [20, 0],
      [30, 0],
      [30, 10],
      [20, 10],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 2],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [4, 6],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'F', 'B', 'B', 'B', 'B', 'F'],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
      [4, 5, 6],
      [4, 6, 7],
    ],
  };
}

describe('SimulatorSegmentsSidebar', () => {
  it('draws each pattern’s aux lines whatever the paper style says of them', () => {
    // The style's switch is the simulation's: a flat pattern on the rail is
    // drawn as main's rail drew it, aux lines and all.
    useSettingsStore.setState({
      paperStyle: {
        ...paperStyle,
        display: {
          ...paperStyle.display,
          auxCreases: { ...paperStyle.display.auxCreases, visible: false },
        },
      },
    });
    const fold = twoSquares();
    const segments = segmentFoldDocument(fold);
    act(() =>
      root?.render(
        <SimulatorSegmentsSidebar fold={fold} segments={segments} selected={0} onSelect={() => {}} />
      )
    );
    const cards = [...(container?.querySelectorAll('.sheet-card') ?? [])];
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.querySelectorAll('.sheet-card__stroke--aux')).toHaveLength(1);
      expect(card.querySelectorAll('.sheet-card__stroke--edge')).toHaveLength(4);
    }
  });
});
