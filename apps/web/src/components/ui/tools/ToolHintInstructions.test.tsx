import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolHintInstructions } from './ToolHintInstructions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const render = (node: ReactNode) => act(() => root.render(node));
const items = () => [...host.querySelectorAll('li')];
/** Each item's line, where it stands, and whether it is the step in hand. */
const progress = () =>
  items().map((item) => [item.textContent, item.dataset.progress, item.getAttribute('aria-current')]);

const STEPS = ['Pick a line', 'Pick the flaps', 'Choose the direction'];

describe('ToolHintInstructions', () => {
  it('lays out a heading, an intro and bullets with no progress, as Simulate and Annotate have them', () => {
    render(<ToolHintInstructions heading="Instructions" intro="Drag a face." items={['Shift: constrain']} />);
    expect(host.textContent).toBe('InstructionsDrag a face.Shift: constrain');
    expect(host.querySelector('ol')).toBeNull();
    expect(host.querySelector('ul')?.hasAttribute('data-ordered')).toBe(false);
    expect(progress()).toEqual([['Shift: constrain', undefined, null]]);
  });

  it('numbers ordered steps, showing no progress until there is a step in hand', () => {
    render(<ToolHintInstructions heading="Instructions" items={STEPS} ordered />);
    expect(host.querySelector('ul')).toBeNull();
    expect(host.querySelector('ol')?.hasAttribute('data-ordered')).toBe(true);
    expect(progress()).toEqual(STEPS.map((step) => [step, undefined, null]));
  });

  it('reads the steps before the current one as done, marks it, and leaves the rest to do', () => {
    render(<ToolHintInstructions heading="Instructions" items={STEPS} ordered current={1} />);
    expect(progress()).toEqual([
      ['Pick a line', 'done', null],
      ['Pick the flaps', 'current', 'step'],
      ['Choose the direction', 'todo', null],
    ]);

    render(<ToolHintInstructions heading="Instructions" items={STEPS} ordered current={0} />);
    expect(progress().map(([, state]) => state)).toEqual(['current', 'todo', 'todo']);
  });

  it('reads every step as done once the last is past', () => {
    render(<ToolHintInstructions heading="Instructions" items={STEPS} ordered current={STEPS.length} />);
    expect(progress().map(([, state, step]) => [state, step])).toEqual([
      ['done', null],
      ['done', null],
      ['done', null],
    ]);
  });

  it('keeps two steps that say the same thing apart', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ToolHintInstructions heading="Instructions" items={['Pick a point', 'Pick a point']} ordered current={1} />);
    expect(progress()).toEqual([
      ['Pick a point', 'done', null],
      ['Pick a point', 'current', 'step'],
    ]);
    // React reports a duplicate key through console.error.
    expect(error).not.toHaveBeenCalled();
  });

  it('accepts a step in hand only on an ordered list, and shows none on bullets', () => {
    // @ts-expect-error: progress has nothing to say on a bulleted list.
    render(<ToolHintInstructions heading="Instructions" items={STEPS} current={1} />);
    expect(host.querySelector('ul')).not.toBeNull();
    expect(progress()).toEqual(STEPS.map((step) => [step, undefined, null]));
  });
});
