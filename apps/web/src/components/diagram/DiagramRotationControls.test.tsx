import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagramRotation } from '../../diagram/document/diagramDocument';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramRotationControls } from './DiagramRotationControls';

const analytics = vi.hoisted(() => ({ trackDiagramRotationCustomized: vi.fn() }));
vi.mock('../../analytics/trackDiagram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics/trackDiagram')>()),
  trackDiagramRotationCustomized: analytics.trackDiagramRotationCustomized,
}));

/**
 * A rotation's Amount, Angle and Direction rows (the Step pane's for a turn,
 * the Layers pane's for a rotate mark), found by role and name as a person
 * reads them.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let changes: DiagramRotation[] = [];

beforeEach(() => {
  changes = [];
  analytics.trackDiagramRotationCustomized.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

/** The rows over a rotation that changes as they change it, as the store would. */
function Harness({ initial, disabled = false }: { initial: DiagramRotation; disabled?: boolean }) {
  const [rotation, setRotation] = useState(initial);
  return (
    <DiagramRotationControls
      rotation={rotation}
      amountLabel="Amount"
      target="turn"
      disabled={disabled}
      onChange={(next) => {
        changes.push(next);
        setRotation(next);
      }}
    />
  );
}

function show(initial: DiagramRotation, disabled = false) {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  act(() =>
    root!.render(
      <TooltipProvider>
        <Harness initial={initial} disabled={disabled} />
      </TooltipProvider>
    )
  );
}

const group = (name: string) => host!.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"]`)!;
const option = (groupName: string, label: string) =>
  [...group(groupName).querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((button) => button.textContent === label)!;
const pressed = (groupName: string) =>
  [...group(groupName).querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]')].map((button) => button.textContent);
const angleField = () => host!.querySelector<HTMLInputElement>('input[aria-label="Angle"]');

function type(field: HTMLInputElement, value: string, commit: 'Enter' | 'blur' = 'Enter') {
  act(() => field.focus());
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    if (commit === 'Enter') field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    else field.blur();
  });
}

describe('DiagramRotationControls', () => {
  it('offers the three presets and Custom, with no Angle while a preset is chosen', () => {
    show({ amount: 'quarter', direction: 'cw' });
    expect([...group('Amount').querySelectorAll('button')].map((button) => button.textContent)).toEqual(['1/8', '1/4', '1/2', 'Custom']);
    expect(pressed('Amount')).toEqual(['1/4']);
    expect(angleField()).toBeNull();
    expect(pressed('Direction')).toEqual(['Clockwise']);
  });

  it('starts Custom from the preset it was, shows its Angle under Amount, and says so once', () => {
    show({ amount: 'half', direction: 'ccw' });
    act(() => option('Amount', 'Custom').click());
    expect(changes).toEqual([{ amount: 'degrees', degrees: 180, direction: 'ccw' }]);
    expect(pressed('Amount')).toEqual(['Custom']);
    const field = angleField()!;
    expect(field.value).toBe('180');
    // Under the Amount row, over Direction: nothing above the control pressed moves.
    expect(group('Amount').compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(field.compareDocumentPosition(group('Direction')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(analytics.trackDiagramRotationCustomized).toHaveBeenCalledExactlyOnceWith('turn');
    // Custom pressed again changes nothing and sends nothing.
    act(() => option('Amount', 'Custom').click());
    expect(changes).toHaveLength(1);
    expect(analytics.trackDiagramRotationCustomized).toHaveBeenCalledOnce();
  });

  it('commits an angle on Enter or blur, to a tenth, within a turn', () => {
    show({ amount: 'degrees', degrees: 90, direction: 'cw' });
    type(angleField()!, '135');
    expect(changes.at(-1)).toEqual({ amount: 'degrees', degrees: 135, direction: 'cw' });
    type(angleField()!, '22.54', 'blur');
    expect(changes.at(-1)).toEqual({ amount: 'degrees', degrees: 22.5, direction: 'cw' });
    expect(angleField()!.value).toBe('22.5');
    type(angleField()!, '400');
    expect(changes.at(-1)).toEqual({ amount: 'degrees', degrees: 359.9, direction: 'cw' });
    type(angleField()!, '-30');
    expect(changes.at(-1)).toEqual({ amount: 'degrees', degrees: 0.1, direction: 'cw' });
    // Typing what it already is commits nothing.
    const count = changes.length;
    type(angleField()!, '0.1');
    expect(changes).toHaveLength(count);
    expect(analytics.trackDiagramRotationCustomized).not.toHaveBeenCalled();
  });

  it('keeps the angle as the direction changes, and drops it for a preset chosen again', () => {
    show({ amount: 'degrees', degrees: 135, direction: 'cw' });
    act(() => option('Direction', 'Counterclockwise').click());
    expect(changes.at(-1)).toEqual({ amount: 'degrees', degrees: 135, direction: 'ccw' });
    expect(angleField()!.value).toBe('135');
    act(() => option('Amount', '1/8').click());
    expect(changes.at(-1)).toEqual({ amount: 'eighth', direction: 'ccw' });
    expect(Object.keys(changes.at(-1)!)).toEqual(['amount', 'direction']);
    expect(angleField()).toBeNull();
  });

  it('changes nothing while the diagram is read-only', () => {
    show({ amount: 'degrees', degrees: 135, direction: 'cw' }, true);
    expect(angleField()!.disabled).toBe(true);
    expect([...group('Amount').querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
  });
});
