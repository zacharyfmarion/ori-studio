import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from './Tooltip';
import { WorkspaceTab, WorkspaceTabClose, WorkspaceTabStrip } from './WorkspaceTabStrip';

/**
 * What its two owners ask of the strip — Design's open designs and References'
 * two jobs — and the rules its hit area depends on.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Partial<Parameters<typeof WorkspaceTabStrip>[0]> = {}) {
  act(() =>
    root.render(
      <TooltipProvider>
        <WorkspaceTabStrip value="a" onValueChange={() => undefined} label="Open things" {...props}>
          <WorkspaceTab value="a" title="Alpha" close={<WorkspaceTabClose aria-label="Close Alpha" />} />
          <WorkspaceTab value="b" title="Beta" />
        </WorkspaceTabStrip>
      </TooltipProvider>
    )
  );
  return container.firstElementChild as HTMLElement;
}

describe('WorkspaceTabStrip', () => {
  it('is a named tablist of its tabs', () => {
    render();
    const list = container.querySelector('[role="tablist"]');
    expect(list?.getAttribute('aria-label')).toBe('Open things');
    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      'Alpha',
      'Beta',
    ]);
  });

  it('keeps a close button out of the tab it closes', () => {
    // A focusable control inside `role="tab"` is invalid ARIA and unreachable by
    // keyboard.
    render();
    const close = container.querySelector('button[aria-label="Close Alpha"]');
    expect(close).not.toBeNull();
    expect(close?.closest('[role="tab"]')).toBeNull();
  });

  it('offers a new-tab button only when asked', () => {
    render();
    expect(container.querySelector('button[aria-label="New"]')).toBeNull();

    const onAdd = vi.fn();
    render({ onAdd, addLabel: 'New' });
    act(() => (container.querySelector('button[aria-label="New"]') as HTMLButtonElement).click());
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('takes its variations as props, on its root', () => {
    expect(render().dataset).toMatchObject({ tone: 'documents' });
    const strip = render({ embedded: true, tone: 'peers', fill: true, className: 'placed' });
    expect(strip.dataset).toMatchObject({ embedded: 'true', tone: 'peers', fill: 'true' });
    expect(strip.classList.contains('placed')).toBe(true);
  });
});

/**
 * A tab that only responds where its label is.
 *
 * The trigger was sized to its content inside a 32px tab, so the strips above
 * and below the text — and the gap beside the close button — hit the wrapper
 * instead and did nothing. jsdom does no layout, so a rendered click cannot
 * catch this; what is checkable is the rule the hit area depends on: **the
 * element carrying `role="tab"` fills its wrapper, and nothing else in the tab
 * takes flow space away from it except the close button.**
 */
const moduleCss = readFileSync(
  resolve(process.cwd(), 'src/components/ui/WorkspaceTabStrip.module.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

/** The declaration block of the rule whose selector is exactly `selector`. */
function declarations(selector: string): string {
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(moduleCss)) !== null) {
    if (match[1].trim() === selector) return match[2];
  }
  throw new Error(`no rule for ${selector}`);
}

describe('the tab hit area', () => {
  it('stretches the trigger over the whole tab', () => {
    const trigger = declarations('.trigger');

    // Vertically: the tab is taller than a 12px line of text.
    expect(trigger).toMatch(/align-self:\s*stretch/);
    // Horizontally: any width the wrapper has and the trigger does not want.
    expect(trigger).toMatch(/flex:\s*1\b/);
  });

  it('floats the close button over the trigger instead of beside it', () => {
    // As a flex sibling the close was an 18px box in a 32px tab, carving dead
    // strips directly above and below itself. Out of flow, the trigger runs the
    // full height underneath it and only the button itself is not the tab.
    expect(declarations('.close')).toMatch(/position:\s*absolute/);
    // Which only lands inside the tab if the tab is its containing block.
    expect(declarations('.tab')).toMatch(/position:\s*relative/);
  });
});

/**
 * The tab's two ends.
 *
 * Nothing here is visible to jsdom — it does no layout, so the only thing a test
 * can hold is the shape of the rules the spacing comes out of. Both regressions
 * these cover were invisible in code review and obvious on screen.
 */
describe('the horizontal gutter', () => {
  it('insets both ends of the trigger from one value', () => {
    // Written as two literals, the sides drifted: the label sat 12px from the
    // tab's left edge and 4px from its right.
    expect(declarations('.trigger')).toMatch(/padding:\s*0\s+var\(--tab-pad-x\)\s*;/);
    // And the close button is the right end of that same gutter, not its own
    // spacing decision.
    expect(declarations('.close')).toMatch(/right:\s*var\(--close-inset\)/);
    expect(declarations('.tab')).toMatch(/--close-inset:\s*calc\(/);
  });

  it('reserves room for the close button at its real inset', () => {
    // The label is ellipsized against this padding, so it has to cover where the
    // button actually sits. Reserving only the button's own width let a long
    // title run under it once the inset grew.
    expect(declarations('.tab:has(.close) .trigger')).toMatch(
      /padding-right:\s*calc\(\s*var\(--close-inset\)\s*\+\s*var\(--close-size\)/
    );
  });

  it('zeroes the close button so its glyph can centre', () => {
    // Not redundant with `place-items: center`. A button carries `padding: 1px
    // 6px` from the UA sheet, which under `border-box` leaves the 18px box a 6px
    // content box; the 12px icon overflows it, and Chrome resolves that overflow
    // to one side — the X rendered flush against the button's right edge.
    expect(declarations('.close')).toMatch(/padding:\s*0\s*;/);
  });
});
