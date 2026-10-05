import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramAnnotateRail } from './DiagramAnnotateRail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
});

describe('DiagramAnnotateRail', () => {
  it('heads the rail with the line type, as Edit heads its own, then the tools in their groups', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root!.render(
        <TooltipProvider>
          <DiagramAnnotateRail tool={null} readOnly={false} onTool={() => undefined} />
        </TooltipProvider>
      )
    );
    const groups = [...container.querySelectorAll('[id^="diagram-annotate-group-"]')].map((group) =>
      group.id.replace('diagram-annotate-group-', '')
    );
    expect(groups).toEqual(['line-type', 'select', 'arrows', 'lines', 'marks', 'text']);
  });
});
