import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioBpFlap, OristudioBpSheet } from '../../engine/oristudioBpTypes';
import { BpFlapEditor } from './BpFlapEditor';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = window.document.createElement('div');
  window.document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function flap(overrides: Partial<OristudioBpFlap> = {}): OristudioBpFlap {
  return {
    id: 1,
    vertexId: 10,
    name: 'A',
    anchor: { x: 5, y: 5 },
    width: 2,
    height: 2,
    radius: 4,
    constrained: false,
    ...overrides,
  };
}

const sheet: OristudioBpSheet = {
  kind: 'rectangular',
  width: 10,
  height: 10,
  grid: { kind: 'rectangular', interval: 1, snap: true },
};

interface RenderProps {
  flap: OristudioBpFlap;
  radiusEditable: boolean;
  onResize: (width: number, height: number) => Promise<boolean>;
  onRadius: (length: number) => Promise<boolean>;
  onRename: (name: string) => void;
}

function renderEditor(props: Partial<RenderProps> = {}) {
  const spies = {
    onResize: props.onResize ?? vi.fn(async () => true),
    onRadius: props.onRadius ?? vi.fn(async () => true),
    onRename: props.onRename ?? vi.fn(),
  };
  act(() => {
    root.render(
      <BpFlapEditor
        flap={props.flap ?? flap()}
        namePlaceholder="1"
        nameAriaLabel="Name of flap 1"
        sheet={sheet}
        maxDimension={10}
        radiusValue={props.flap?.radius ?? 4}
        radiusMax={12}
        radiusEditable={props.radiusEditable ?? true}
        onRename={spies.onRename}
        onResize={spies.onResize}
        onRadius={spies.onRadius}
      />,
    );
  });
  return spies;
}

function field(label: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`no field labelled ${label}`);
  return input;
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// Commit via Enter: the field's onKeyDown handler calls commit() directly. (A
// dispatched 'blur' event does not trigger React's onBlur, which listens on
// 'focusout' — Enter is the reliable commit path in jsdom.)
function commitField(input: HTMLInputElement) {
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
}

describe('BpFlapEditor', () => {
  it('shows Radius, Width and Height fields for a flap with a source edge', () => {
    renderEditor({ radiusEditable: true });
    expect(container.querySelector('input[aria-label="Flap radius"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Flap width"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Flap height"]')).toBeTruthy();
  });

  it('hides the radius field when the flap has no source edge', () => {
    renderEditor({ radiusEditable: false });
    expect(container.querySelector('input[aria-label="Flap radius"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Flap width"]')).toBeTruthy();
  });

  it('never steals focus on mount', () => {
    renderEditor();
    expect(window.document.activeElement).not.toBe(field('Flap width'));
  });

  it('commits a valid width as an integer', () => {
    const { onResize } = renderEditor();
    const input = field('Flap width');
    setValue(input, '4');
    commitField(input);
    expect(onResize).toHaveBeenCalledWith(4, 2);
  });

  it('clamps a width above the sheet maximum before committing', () => {
    // maxDimension is 10; a 99 entry clamps to 10. The footprint (anchor 5,5,
    // width 10, height 2) pushes only the two right corners off — that is 2
    // corners, so it is actually rejected; use a shorter case for the clamp.
    const { onResize } = renderEditor({ flap: flap({ anchor: { x: 0, y: 0 }, height: 0 }) });
    const input = field('Flap width');
    setValue(input, '99');
    commitField(input);
    // width 10, height 0 at origin: dots collapse onto the bottom/top edge, all
    // within the 10x10 sheet -> accepted at the clamped value.
    expect(onResize).toHaveBeenCalledWith(10, 0);
  });

  it('snaps back a resize that would push more than one corner off the sheet', () => {
    const { onResize } = renderEditor();
    const input = field('Flap width');
    // anchor (5,5), height 2, width 8 -> right corners (13,7) and (13,5) both
    // off the 10x10 sheet: rejected, so the field reverts and nothing commits.
    setValue(input, '8');
    commitField(input);
    expect(onResize).not.toHaveBeenCalled();
    expect(input.value).toBe('2');
  });

  it('snaps back when the engine rejects the resize asynchronously', async () => {
    const onResize = vi.fn(async () => false);
    renderEditor({ onResize });
    const input = field('Flap width');
    setValue(input, '4');
    // The commit awaits onResize; flush the microtasks so the revert runs.
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });
    expect(onResize).toHaveBeenCalledWith(4, 2);
    expect(input.value).toBe('2');
  });

  it('reverts the draft on Escape without committing', () => {
    const { onResize } = renderEditor();
    const input = field('Flap height');
    setValue(input, '5');
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));
    expect(onResize).not.toHaveBeenCalled();
    expect(input.value).toBe('2');
  });

  it('commits the radius through the radius callback', () => {
    const { onRadius } = renderEditor();
    const input = field('Flap radius');
    setValue(input, '6');
    commitField(input);
    expect(onRadius).toHaveBeenCalledWith(6);
  });

  it('clamps the radius to a minimum of 1', () => {
    const { onRadius } = renderEditor();
    const input = field('Flap radius');
    setValue(input, '0');
    commitField(input);
    expect(onRadius).toHaveBeenCalledWith(1);
  });
});
